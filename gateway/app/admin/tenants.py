from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.db import get_session
from app.tenants.models import Tenant, TenantMember

router = APIRouter(prefix="/tenants", tags=["admin:tenants"])


class TenantOut(BaseModel):
    id: int
    dograh_org_id: int | None
    name: str
    slug: str
    owner_email: str
    status: str
    created_at: str


class TenantCreateIn(BaseModel):
    name: str
    slug: str
    owner_email: EmailStr
    status: str = "active"


class TenantStatusIn(BaseModel):
    status: str  # active | suspended | cancelled | pending_verification


class TenantMemberOut(BaseModel):
    id: int
    email: str
    role: str
    dograh_user_id: int | None
    joined_at: str


def _serialize(t: Tenant) -> TenantOut:
    return TenantOut(
        id=t.id,
        dograh_org_id=t.dograh_org_id,
        name=t.name,
        slug=t.slug,
        owner_email=t.owner_email,
        status=t.status,
        created_at=t.created_at.isoformat(),
    )


@router.get("")
async def list_tenants(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    total = (await session.execute(select(func.count()).select_from(Tenant))).scalar_one()
    rows = (
        await session.execute(
            select(Tenant).order_by(Tenant.created_at.desc()).limit(limit).offset(offset)
        )
    ).scalars().all()
    return {
        "total": int(total),
        "items": [_serialize(t).model_dump() for t in rows],
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_tenant(
    body: TenantCreateIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TenantOut:
    tenant = Tenant(
        name=body.name,
        slug=body.slug.lower(),
        owner_email=body.owner_email.lower(),
        status=body.status,
        signup_metadata={"created_by": "super_admin", "actor": claims["email"]},
    )
    session.add(tenant)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "slug already taken") from None

    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.tenant.create",
        target_kind="tenant",
        target_id=str(tenant.id),
        payload={"slug": tenant.slug, "name": tenant.name},
    )
    await session.commit()
    return _serialize(tenant)


@router.get("/{tenant_id}")
async def get_tenant(
    tenant_id: int,
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant not found")
    members = (
        await session.execute(
            select(TenantMember)
            .where(TenantMember.tenant_id == tenant_id)
            .order_by(TenantMember.joined_at)
        )
    ).scalars().all()
    return {
        "tenant": _serialize(tenant).model_dump(),
        "members": [
            TenantMemberOut(
                id=m.id,
                email=m.email,
                role=m.role,
                dograh_user_id=m.dograh_user_id,
                joined_at=m.joined_at.isoformat(),
            ).model_dump()
            for m in members
        ],
    }


@router.patch("/{tenant_id}/status")
async def update_tenant_status(
    tenant_id: int,
    body: TenantStatusIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TenantOut:
    valid = {"active", "suspended", "cancelled", "pending_verification"}
    if body.status not in valid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"status must be one of {valid}")
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant not found")
    prev = tenant.status
    tenant.status = body.status
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.tenant.status",
        target_kind="tenant",
        target_id=str(tenant.id),
        payload={"from": prev, "to": body.status},
    )
    await session.commit()
    return _serialize(tenant)


def _actor_id(claims: dict) -> int | None:
    sub = claims.get("sub", "")
    if sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            return None
    return None
