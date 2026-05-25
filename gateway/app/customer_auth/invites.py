"""Invite create / list / revoke / accept.

Create + list + revoke are tenant-scoped (org admin only). Accept is public
(the invitee is signing up via a token they received in email).

The accept flow: validate token → call Dograh signup (creates user + a
throwaway personal org) → write the membership row + flip selected org in
Dograh's DB → record the invite as accepted and insert tenant_members.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.service import issue_customer_token
from app.auth.tokens import InvalidToken, TokenExpired
from app.auth.tokens import issue as issue_token
from app.auth.tokens import verify as verify_token
from app.config import settings
from app.customer_auth.deps import require_org_admin
from app.db import get_session
from app.dograh_client import DograhClient, DograhError
from app.dograh_client.db import move_user_to_org
from app.email.service import send_template
from app.tenants.models import Invite, Tenant, TenantMember

log = structlog.get_logger()

INVITE_TTL_SECONDS = 7 * 24 * 3600

# Split: tenant-side (auth) lives at /api/tenant/invites, public at /api/auth.
tenant_router = APIRouter(tags=["customer-auth:invites"])
public_router = APIRouter(tags=["customer-auth:invites"])


# --- Schemas ---------------------------------------------------------------


class InviteIn(BaseModel):
    email: EmailStr
    role: str = Field(default="org_member", pattern="^(org_admin|org_member)$")


class InviteOut(BaseModel):
    id: int
    tenant_id: int
    email: str
    role: str
    expires_at: str
    accepted_at: str | None
    created_at: str


class InvitePreviewOut(BaseModel):
    email: str
    role: str
    tenant_name: str
    invited_by_email: str | None


class AcceptInviteIn(BaseModel):
    token: str
    password: str = Field(min_length=8)
    full_name: str = Field(min_length=1, max_length=128)


class AcceptInviteOut(BaseModel):
    access_token: str
    expires_in: int
    role: str
    redirect: str


# --- Helpers ---------------------------------------------------------------


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _serialize(i: Invite) -> InviteOut:
    return InviteOut(
        id=i.id,
        tenant_id=i.tenant_id,
        email=i.email,
        role=i.role,
        expires_at=i.expires_at.isoformat(),
        accepted_at=i.accepted_at.isoformat() if i.accepted_at else None,
        created_at=i.created_at.isoformat(),
    )


def _build_accept_url(token: str) -> str:
    base = settings.public_base_url.rstrip("/")
    return f"{base}/accept-invite?token={token}"


# --- Create / list / revoke (org admin) ------------------------------------


@tenant_router.post("/invites", response_model=InviteOut, status_code=status.HTTP_201_CREATED)
async def create_invite(
    body: InviteIn,
    request: Request,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> InviteOut:
    tenant_id = await _tenant_id_for_claims(session, claims)
    email = body.email.lower()

    # Block if email is already a member of this tenant.
    existing = await session.execute(
        select(TenantMember.id)
        .where(TenantMember.tenant_id == tenant_id)
        .where(TenantMember.email == email)
    )
    if existing.first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "email is already a member")

    # Reuse an unaccepted, unexpired invite for the same address if present —
    # just bump the token + expiry and resend.
    now = datetime.now(UTC)
    existing_invite_q = await session.execute(
        select(Invite)
        .where(Invite.tenant_id == tenant_id)
        .where(Invite.email == email)
        .where(Invite.accepted_at.is_(None))
    )
    invite = existing_invite_q.scalars().first()

    raw_token = issue_token(
        {"purpose": "invite", "tenant_id": tenant_id, "email": email},
        ttl_seconds=INVITE_TTL_SECONDS,
    )
    if invite is None:
        invite = Invite(
            tenant_id=tenant_id,
            email=email,
            role=body.role,
            token_hash=_hash_token(raw_token),
            expires_at=now + timedelta(seconds=INVITE_TTL_SECONDS),
            invited_by_user_id=_actor_dograh_user_id(claims),
        )
        session.add(invite)
        await session.flush()
    else:
        invite.role = body.role
        invite.token_hash = _hash_token(raw_token)
        invite.expires_at = now + timedelta(seconds=INVITE_TTL_SECONDS)

    tenant = await session.get(Tenant, tenant_id)
    accept_url = _build_accept_url(raw_token)
    await send_template(
        session,
        tenant_id=tenant_id,
        to=[email],
        subject=f"You're invited to {tenant.name} on SalesChimp",
        template="invite",
        context={
            "inviter_email": claims.get("email"),
            "tenant_name": tenant.name,
            "role": body.role,
            "accept_url": accept_url,
            "ttl_days": INVITE_TTL_SECONDS // 86400,
            "product_name": "SalesChimp",
        },
    )

    await record_audit(
        session,
        actor_kind="tenant",
        actor_user_id=_actor_dograh_user_id(claims),
        action="invite.created",
        target_kind="invite",
        target_id=str(invite.id),
        request=request,
        payload={"email": email, "role": body.role, "tenant_id": tenant_id},
    )
    await session.commit()
    await session.refresh(invite)
    return _serialize(invite)


@tenant_router.get("/invites", response_model=list[InviteOut])
async def list_invites(
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[InviteOut]:
    tenant_id = await _tenant_id_for_claims(session, claims)
    rows = (
        await session.execute(
            select(Invite)
            .where(Invite.tenant_id == tenant_id)
            .order_by(Invite.created_at.desc())
        )
    ).scalars().all()
    return [_serialize(r) for r in rows]


@tenant_router.delete("/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(
    invite_id: int,
    request: Request,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    tenant_id = await _tenant_id_for_claims(session, claims)
    invite = await session.get(Invite, invite_id)
    if invite is None or invite.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invite not found")
    if invite.accepted_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "invite already accepted")
    await session.delete(invite)
    await record_audit(
        session,
        actor_kind="tenant",
        actor_user_id=_actor_dograh_user_id(claims),
        action="invite.revoked",
        target_kind="invite",
        target_id=str(invite_id),
        request=request,
        payload={"email": invite.email, "tenant_id": tenant_id},
    )
    await session.commit()


# --- Accept (public) -------------------------------------------------------


@public_router.get("/invites/{token}/preview", response_model=InvitePreviewOut)
async def preview_invite(
    token: str,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> InvitePreviewOut:
    """Return non-secret info about an invite so the accept page can render
    'Join Acme as Admin' before the user submits a password."""
    invite = await _resolve_invite(token, session)
    tenant = await session.get(Tenant, invite.tenant_id)
    inviter_email: str | None = None
    if invite.invited_by_user_id is not None:
        inviter = await session.execute(
            select(TenantMember.email).where(
                TenantMember.dograh_user_id == invite.invited_by_user_id
            )
        )
        inviter_email = inviter.scalar_one_or_none()
    return InvitePreviewOut(
        email=invite.email,
        role=invite.role,
        tenant_name=tenant.name if tenant else "",
        invited_by_email=inviter_email,
    )


@public_router.post("/accept-invite", response_model=AcceptInviteOut)
async def accept_invite(
    body: AcceptInviteIn,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AcceptInviteOut:
    invite = await _resolve_invite(body.token, session)
    tenant = await session.get(Tenant, invite.tenant_id)
    if tenant is None or tenant.dograh_org_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "tenant not fully provisioned — owner must verify their email first",
        )

    client = DograhClient()
    try:
        dograh_user = await client.signup(
            email=invite.email, password=body.password, name=body.full_name
        )
    except DograhError as e:
        if e.status_code == 409:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "email already has a Dograh account — sign in instead",
            ) from None
        log.warning("invite.accept.dograh_signup_failed", invite_id=invite.id, error=e.detail)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "could not create user in Dograh") from None

    # Move the freshly-created user into the inviter's existing org.
    await move_user_to_org(dograh_user.id, tenant.dograh_org_id)

    member = TenantMember(
        tenant_id=tenant.id,
        dograh_user_id=dograh_user.id,
        email=invite.email,
        role=invite.role,
        invited_by=invite.invited_by_user_id,
    )
    session.add(member)
    invite.accepted_at = datetime.now(UTC)

    token, expires_in = issue_customer_token(
        dograh_user_id=dograh_user.id,
        email=invite.email,
        org_id=tenant.dograh_org_id,
        role=invite.role,
    )

    await record_audit(
        session,
        actor_kind="tenant",
        actor_user_id=dograh_user.id,
        action="invite.accepted",
        target_kind="invite",
        target_id=str(invite.id),
        request=request,
        payload={
            "tenant_id": tenant.id,
            "dograh_org_id": tenant.dograh_org_id,
            "role": invite.role,
        },
    )
    await session.commit()

    log.info(
        "invite.accepted",
        invite_id=invite.id,
        dograh_user_id=dograh_user.id,
        dograh_org_id=tenant.dograh_org_id,
    )
    return AcceptInviteOut(
        access_token=token,
        expires_in=expires_in,
        role=invite.role,
        redirect=settings.post_verify_redirect,
    )


# --- internal helpers ------------------------------------------------------


async def _resolve_invite(token: str, session: AsyncSession) -> Invite:
    """Validate the signed token + match it to a live Invite row."""
    try:
        payload = verify_token(token)
    except TokenExpired:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invite expired") from None
    except InvalidToken:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid invite") from None
    if payload.get("purpose") != "invite":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "wrong token purpose")

    invite = (
        await session.execute(
            select(Invite).where(Invite.token_hash == _hash_token(token))
        )
    ).scalar_one_or_none()
    if invite is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invite not found or revoked")
    if invite.accepted_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "invite already accepted")
    if invite.expires_at < datetime.now(UTC):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invite expired")
    return invite


async def _tenant_id_for_claims(session: AsyncSession, claims: dict) -> int:
    """Resolve the tenant the caller belongs to via dograh_user_id → tenant_members."""
    sub = claims.get("sub", "")
    try:
        dograh_user_id = int(sub)
    except (ValueError, TypeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad sub claim") from None
    row = (
        await session.execute(
            select(TenantMember.tenant_id).where(
                TenantMember.dograh_user_id == dograh_user_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "caller is not a tenant member")
    return int(row)


def _actor_dograh_user_id(claims: dict) -> int | None:
    sub = claims.get("sub", "")
    try:
        return int(sub)
    except (ValueError, TypeError):
        return None
