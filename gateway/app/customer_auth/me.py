"""Customer self-service: /me + branding + onboarding state.

These power the post-verify wizard and any future tenant settings UI.
"""

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.customer_auth.deps import require_customer, require_org_admin
from app.db import get_session
from app.tenants.models import Tenant, TenantMember

log = structlog.get_logger()

router = APIRouter(tags=["customer-auth:me"])


class MemberOut(BaseModel):
    id: int
    email: str
    role: str
    dograh_user_id: int | None
    joined_at: str


class TenantOut(BaseModel):
    id: int
    name: str
    slug: str
    owner_email: str
    status: str
    dograh_org_id: int | None
    onboarding_completed: bool
    created_at: str


class MeOut(BaseModel):
    user: dict
    tenant: TenantOut
    members: list[MemberOut]


class BrandingIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)


class OnboardingCompleteIn(BaseModel):
    completed: bool = True


def _tenant_out(t: Tenant) -> TenantOut:
    completed = bool((t.signup_metadata or {}).get("onboarding_completed"))
    return TenantOut(
        id=t.id,
        name=t.name,
        slug=t.slug,
        owner_email=t.owner_email,
        status=t.status,
        dograh_org_id=t.dograh_org_id,
        onboarding_completed=completed,
        created_at=t.created_at.isoformat(),
    )


async def _resolve(session: AsyncSession, claims: dict) -> tuple[Tenant, TenantMember]:
    sub = claims.get("sub", "")
    try:
        dograh_user_id = int(sub)
    except (ValueError, TypeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad sub claim") from None
    member = (
        await session.execute(
            select(TenantMember).where(TenantMember.dograh_user_id == dograh_user_id)
        )
    ).scalar_one_or_none()
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "caller is not a tenant member")
    tenant = await session.get(Tenant, member.tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant missing")
    return tenant, member


@router.get("/me", response_model=MeOut)
async def me(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MeOut:
    tenant, member = await _resolve(session, claims)
    members = (
        await session.execute(
            select(TenantMember)
            .where(TenantMember.tenant_id == tenant.id)
            .order_by(TenantMember.joined_at)
        )
    ).scalars().all()
    return MeOut(
        user={
            "id": member.dograh_user_id,
            "email": claims.get("email"),
            "role": member.role,
            "org_id": tenant.dograh_org_id,
        },
        tenant=_tenant_out(tenant),
        members=[
            MemberOut(
                id=m.id,
                email=m.email,
                role=m.role,
                dograh_user_id=m.dograh_user_id,
                joined_at=m.joined_at.isoformat(),
            )
            for m in members
        ],
    )


@router.patch("/me/branding", response_model=TenantOut)
async def update_branding(
    body: BrandingIn,
    request: Request,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TenantOut:
    tenant, _member = await _resolve(session, claims)
    if body.name is not None and body.name != tenant.name:
        prev = tenant.name
        tenant.name = body.name
        await record_audit(
            session,
            actor_kind="tenant",
            actor_user_id=int(claims["sub"]),
            action="tenant.branding.update",
            target_kind="tenant",
            target_id=str(tenant.id),
            request=request,
            payload={"from": prev, "to": body.name},
        )
    await session.commit()
    await session.refresh(tenant)
    return _tenant_out(tenant)


@router.post("/me/onboarding/complete", response_model=TenantOut)
async def complete_onboarding(
    body: OnboardingCompleteIn,
    request: Request,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TenantOut:
    """Mark the wizard as done. The customer app reads
    `tenant.onboarding_completed` to decide whether to show the wizard or
    hand straight off to Dograh."""
    tenant, _member = await _resolve(session, claims)
    meta = dict(tenant.signup_metadata or {})
    if meta.get("onboarding_completed") != body.completed:
        meta["onboarding_completed"] = body.completed
        tenant.signup_metadata = meta
        await record_audit(
            session,
            actor_kind="tenant",
            actor_user_id=int(claims["sub"]),
            action="tenant.onboarding.complete" if body.completed else "tenant.onboarding.reset",
            target_kind="tenant",
            target_id=str(tenant.id),
            request=request,
        )
    await session.commit()
    await session.refresh(tenant)
    return _tenant_out(tenant)
