"""Cross-tenant invites view for super-admin.

Lets platform operators inspect every invite across the system and revoke
problem ones. Tenant-side invite management (create/list-own/revoke-own)
lives in customer_auth/invites.py.
"""

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.auth.tokens import issue as issue_token
from app.customer_auth.invites import INVITE_TTL_SECONDS, _build_accept_url
from app.db import get_session
from app.email.service import send_template
from app.tenants.models import Invite, Tenant, TenantMember

router = APIRouter(prefix="/invites", tags=["admin:invites"])

Status = Literal["pending", "accepted", "expired", "all"]


class InviteRow(BaseModel):
    id: int
    tenant_id: int
    tenant_name: str
    tenant_slug: str
    email: str
    role: str
    expires_at: str
    accepted_at: str | None
    created_at: str
    state: str  # pending | accepted | expired


class InvitesRes(BaseModel):
    total: int
    items: list[InviteRow]


def _row(i: Invite, t: Tenant) -> InviteRow:
    now = datetime.now(UTC)
    if i.accepted_at is not None:
        state = "accepted"
    elif i.expires_at < now:
        state = "expired"
    else:
        state = "pending"
    return InviteRow(
        id=i.id,
        tenant_id=t.id,
        tenant_name=t.name,
        tenant_slug=t.slug,
        email=i.email,
        role=i.role,
        expires_at=i.expires_at.isoformat(),
        accepted_at=i.accepted_at.isoformat() if i.accepted_at else None,
        created_at=i.created_at.isoformat(),
        state=state,
    )


@router.get("")
async def list_invites(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    state: Status = "all",
    tenant_id: int | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> InvitesRes:
    stmt = (
        select(Invite, Tenant)
        .join(Tenant, Tenant.id == Invite.tenant_id)
        .order_by(Invite.created_at.desc())
    )
    count_stmt = select(func.count()).select_from(Invite)
    if tenant_id is not None:
        stmt = stmt.where(Invite.tenant_id == tenant_id)
        count_stmt = count_stmt.where(Invite.tenant_id == tenant_id)
    if state == "pending":
        stmt = stmt.where(Invite.accepted_at.is_(None)).where(
            Invite.expires_at > func.now()
        )
        count_stmt = count_stmt.where(Invite.accepted_at.is_(None)).where(
            Invite.expires_at > func.now()
        )
    elif state == "accepted":
        stmt = stmt.where(Invite.accepted_at.is_not(None))
        count_stmt = count_stmt.where(Invite.accepted_at.is_not(None))
    elif state == "expired":
        stmt = stmt.where(Invite.accepted_at.is_(None)).where(
            Invite.expires_at <= func.now()
        )
        count_stmt = count_stmt.where(Invite.accepted_at.is_(None)).where(
            Invite.expires_at <= func.now()
        )

    total = int((await session.execute(count_stmt)).scalar_one())
    rows = (await session.execute(stmt.limit(limit).offset(offset))).all()
    return InvitesRes(
        total=total,
        items=[_row(invite, tenant) for invite, tenant in rows],
    )


class CreateInviteIn(BaseModel):
    tenant_id: int
    email: EmailStr
    role: str = Field(default="org_member", pattern="^(org_admin|org_member)$")


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_invite(
    body: CreateInviteIn,
    request: Request,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Super-admin creates an invite on a tenant's behalf.

    Mirrors customer_auth/invites.create_invite but doesn't require an
    org-admin caller — useful when onboarding or recovering an org.
    """
    tenant = await session.get(Tenant, body.tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant not found")
    if tenant.dograh_org_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "tenant not provisioned yet (no dograh_org_id) — owner must verify first",
        )

    email = body.email.lower()

    member_exists = (
        await session.execute(
            select(TenantMember.id)
            .where(TenantMember.tenant_id == body.tenant_id)
            .where(TenantMember.email == email)
        )
    ).first()
    if member_exists is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "email is already a member")

    now = datetime.now(UTC)
    existing = (
        await session.execute(
            select(Invite)
            .where(Invite.tenant_id == body.tenant_id)
            .where(Invite.email == email)
            .where(Invite.accepted_at.is_(None))
        )
    ).scalars().first()

    raw_token = issue_token(
        {"purpose": "invite", "tenant_id": body.tenant_id, "email": email},
        ttl_seconds=INVITE_TTL_SECONDS,
    )
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

    if existing is None:
        invite = Invite(
            tenant_id=body.tenant_id,
            email=email,
            role=body.role,
            token_hash=token_hash,
            expires_at=now + timedelta(seconds=INVITE_TTL_SECONDS),
            invited_by_user_id=None,  # platform-issued; no tenant-side actor
        )
        session.add(invite)
        await session.flush()
    else:
        invite = existing
        invite.role = body.role
        invite.token_hash = token_hash
        invite.expires_at = now + timedelta(seconds=INVITE_TTL_SECONDS)

    await send_template(
        session,
        tenant_id=body.tenant_id,
        to=[email],
        subject=f"You're invited to {tenant.name} on SalesChimp",
        template="invite",
        context={
            "inviter_email": claims.get("email"),
            "tenant_name": tenant.name,
            "role": body.role,
            "accept_url": _build_accept_url(raw_token),
            "ttl_days": INVITE_TTL_SECONDS // 86400,
            "product_name": "SalesChimp",
        },
    )

    actor_id: int | None = None
    sub = claims.get("sub", "")
    if sub.startswith("p_"):
        try:
            actor_id = int(sub[2:])
        except ValueError:
            actor_id = None

    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=actor_id,
        action="admin.invite.create",
        target_kind="invite",
        target_id=str(invite.id),
        request=request,
        payload={"tenant_id": body.tenant_id, "email": email, "role": body.role},
    )
    await session.commit()
    await session.refresh(invite)
    return {
        "id": invite.id,
        "tenant_id": invite.tenant_id,
        "email": invite.email,
        "role": invite.role,
        "expires_at": invite.expires_at.isoformat(),
        "accepted_at": invite.accepted_at.isoformat() if invite.accepted_at else None,
        "created_at": invite.created_at.isoformat(),
    }


@router.delete("/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(
    invite_id: int,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    invite = await session.get(Invite, invite_id)
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invite not found")
    if invite.accepted_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "invite already accepted")

    actor_id: int | None = None
    sub = claims.get("sub", "")
    if sub.startswith("p_"):
        try:
            actor_id = int(sub[2:])
        except ValueError:
            actor_id = None

    await session.delete(invite)
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=actor_id,
        action="admin.invite.revoked",
        target_kind="invite",
        target_id=str(invite_id),
        payload={"tenant_id": invite.tenant_id, "email": invite.email},
    )
    await session.commit()
