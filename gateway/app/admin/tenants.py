from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.customer_auth.service import consume_pending_password, strip_pending_password
from app.db import get_session
from app.dograh_client import DograhClient, DograhError
from app.tenants.models import Tenant, TenantMember

import structlog

log = structlog.get_logger()

router = APIRouter(prefix="/tenants", tags=["admin:tenants"])


class TenantOut(BaseModel):
    id: int
    dograh_org_id: int | None
    name: str
    slug: str
    owner_email: str
    status: str
    created_at: str
    # Surfaced from migration 0013 so super-admins can mirror the tenant-
    # side toggle on /console/settings/organization without context-
    # switching. PATCH /api/admin/tenants/{id} accepts these too.
    logo_url: str | None = None
    favicon_url: str | None = None
    concurrent_calls_limit: int | None = None
    auto_fallback_enabled: bool = False


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
        logo_url=t.logo_url,
        favicon_url=t.favicon_url,
        concurrent_calls_limit=t.concurrent_calls_limit,
        auto_fallback_enabled=t.auto_fallback_enabled,
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


class TenantPatchIn(BaseModel):
    """Subset of fields admins can flip without touching status.
    Status changes still go through PATCH /status because they have
    their own audit + side-effect story (Activate / Suspend buttons)."""

    auto_fallback_enabled: bool | None = None
    concurrent_calls_limit: int | None = None
    logo_url: str | None = None
    favicon_url: str | None = None


@router.patch("/{tenant_id}", response_model=TenantOut)
async def update_tenant(
    tenant_id: int,
    body: TenantPatchIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TenantOut:
    """Mirror of /api/tenant/settings/organization PATCH for super-
    admins. Unlike the tenant-side endpoint we don't enforce the
    package concurrency ceiling here — admins can set whatever they
    want on behalf of a tenant (e.g. emergency throttle). Audit row
    captures the diff so the change is traceable."""
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant not found")

    changes: dict[str, object] = {}
    if body.auto_fallback_enabled is not None and body.auto_fallback_enabled != tenant.auto_fallback_enabled:
        tenant.auto_fallback_enabled = body.auto_fallback_enabled
        changes["auto_fallback_enabled"] = body.auto_fallback_enabled
    if body.concurrent_calls_limit is not None:
        tenant.concurrent_calls_limit = body.concurrent_calls_limit
        changes["concurrent_calls_limit"] = body.concurrent_calls_limit
    if body.logo_url is not None:
        tenant.logo_url = body.logo_url.strip() or None
        changes["logo_url"] = tenant.logo_url
    if body.favicon_url is not None:
        tenant.favicon_url = body.favicon_url.strip() or None
        changes["favicon_url"] = tenant.favicon_url

    if changes:
        await record_audit(
            session,
            actor_kind="platform",
            actor_user_id=_actor_id(claims),
            action="admin.tenant.update",
            target_kind="tenant",
            target_id=str(tenant.id),
            payload=changes,
        )
        await session.commit()
        await session.refresh(tenant)
    return _serialize(tenant)


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


@router.post("/{tenant_id}/complete-signup", response_model=TenantOut)
async def complete_signup(
    tenant_id: int,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TenantOut:
    """Force-verify a tenant on its operator's behalf.

    Use case: dev environments where the verification email never
    actually delivered, or any production case where a user signed
    up but never clicked the link and the operator needs to unblock
    them manually. Same effect as GET /api/auth/verify but
    triggered by a super-admin.

    Idempotent guard rails:
      - 409 if the tenant already has dograh_org_id (the Dograh user
        was created already — don't double-signup).
      - 400 if there's no stashed password to consume (signup either
        never ran or already cleared it via /verify).

    Mirrors the verify endpoint's flow: consume password →
    DograhClient.signup() → set dograh_org_id + status='active' →
    create TenantMember row. Audited as admin.tenant.complete_signup.
    """
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant not found")
    if tenant.dograh_org_id is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "tenant already has a Dograh org — signup already completed",
        )
    try:
        password, full_name = consume_pending_password(tenant)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "no pending password on this tenant — signup metadata missing or already consumed",
        ) from None

    client = DograhClient()
    try:
        dograh_user = await client.signup(
            email=tenant.owner_email, password=password, name=full_name
        )
    except DograhError as e:
        log.warning(
            "complete_signup.dograh_signup_failed",
            tenant_id=tenant_id,
            error=e.detail,
            status_code=e.status_code,
        )
        if e.status_code == 409:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "email already registered in Dograh",
            ) from None
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "could not create user in Dograh"
        ) from None

    tenant.dograh_org_id = dograh_user.organization_id
    tenant.status = "active"
    strip_pending_password(tenant)

    member = TenantMember(
        tenant_id=tenant.id,
        dograh_user_id=dograh_user.id,
        email=dograh_user.email,
        role="org_owner",
    )
    session.add(member)

    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.tenant.complete_signup",
        target_kind="tenant",
        target_id=str(tenant.id),
        payload={
            "dograh_org_id": dograh_user.organization_id,
            "dograh_user_id": dograh_user.id,
        },
    )
    await session.commit()
    await session.refresh(tenant)
    log.info(
        "complete_signup.ok",
        tenant_id=tenant.id,
        dograh_user_id=dograh_user.id,
    )
    return _serialize(tenant)


class HardDeleteIn(BaseModel):
    """Belt-and-braces destructive confirmation. Caller must echo the
    tenant slug exactly — slug rather than name because slugs are
    unique + URL-safe + can't be accidentally renamed mid-flight."""

    confirm_slug: str = Field(min_length=1, max_length=64)


@router.delete("/{tenant_id}/purge", status_code=status.HTTP_200_OK)
async def hard_delete_tenant(
    tenant_id: int,
    body: HardDeleteIn,
    request: Request,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, object]:
    """Permanent purge. ONLY safe to call after the tenant has been
    marked status='cancelled' (i.e. they've gone through the
    tenant-side delete flow and the cooling-off period). The route
    refuses any other status to make sure a super-admin can't
    accidentally nuke a live customer with one wrong click.

    Cascade behavior:
      - Postgres FK ON DELETE CASCADE handles tenant_members, invites,
        wallet, wallet_ledger, payment_methods, payment_intents,
        usage_records, tenant_plugin_installs, etc. — all of those
        carry tenant_id FKs into the tenants table.
      - Dograh user / org cleanup is INTENTIONALLY out of scope here:
        upstream Dograh doesn't expose admin destroy on /api/v1/auth/*
        and we don't want to leave half-deleted state if it fails.
        Leave the Dograh org orphaned; document the runbook step
        separately for ops to handle via Dograh's superuser CLI.

    Audit row captures the deletion with the actor + slug so
    "what happened to tenant N" is traceable forever.
    """
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant not found")
    if tenant.status != "cancelled":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "tenant must be in status='cancelled' before hard delete. "
            "Use the tenant-side delete or PATCH /status first.",
        )
    if body.confirm_slug.strip() != tenant.slug:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "confirm_slug does not match the tenant slug",
        )

    snapshot = {
        "id": tenant.id,
        "slug": tenant.slug,
        "name": tenant.name,
        "owner_email": tenant.owner_email,
        "dograh_org_id": tenant.dograh_org_id,
    }
    await session.delete(tenant)
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.tenant.purge",
        target_kind="tenant",
        target_id=str(tenant_id),
        request=request,
        payload={"deleted": snapshot},
    )
    await session.commit()
    log.warning("admin.tenant.purged", **snapshot)
    return {"purged": True, "id": tenant_id, "dograh_org_id": snapshot["dograh_org_id"]}


def _actor_id(claims: dict) -> int | None:
    sub = claims.get("sub", "")
    if sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            return None
    return None
