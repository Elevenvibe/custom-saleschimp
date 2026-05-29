"""Tenant Organization Settings — GET / PATCH / DELETE + password change.

GET   /api/tenant/settings/organization        full org snapshot
PATCH /api/tenant/settings/organization        update mutable fields
POST  /api/tenant/settings/organization/password   proxy → Dograh
DELETE /api/tenant/settings/organization       mark cancelled + audit

The page that consumes this lives at /console/settings/organization
(iframed via /console-bridge/settings/organization from Dograh's chrome).

What's writable:
  - name (display)
  - logo_url, favicon_url (branding overrides)
  - concurrent_calls_limit (must be 1..package.concurrency_included)
  - auto_fallback_enabled (boolean)

What's read-only (returned by GET but not patchable):
  - owner_email, status, dograh_org_id, created_at, current_package

Delete requires the caller to type the org name into a confirmation
field — same UX pattern Stripe / GitHub use for destructive actions.
This route does NOT physically delete the tenant from the DB; it
flips status='cancelled' and writes an audit row. A super-admin can
review and hard-delete via the admin console later if needed.
"""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.customer_auth.deps import require_customer, require_org_admin, require_org_owner
from app.customer_auth.plans import _tenant_id_for
from app.db import get_session
from app.dograh_client import DograhClient, DograhError
from app.packages.models import Package
from app.storage.branding import StorageError, upload_branding
from app.tenants.models import Tenant

router = APIRouter(prefix="/settings/organization", tags=["customer-auth:org-settings"])


# ----- IO shapes -----------------------------------------------------------


class OrgPackageInfo(BaseModel):
    """Just enough package metadata for the UI to render the concurrency
    bounds + show which plan is in effect. Full plan details live on the
    /api/tenant/plans page."""

    id: int
    slug: str
    name: str
    concurrency_included: int


class OrgSettingsOut(BaseModel):
    id: int
    name: str
    slug: str
    owner_email: str
    status: str
    dograh_org_id: int | None
    created_at: str
    logo_url: str | None
    favicon_url: str | None
    # Effective concurrency the org runs at. If concurrent_calls_limit is
    # set we honour it; otherwise we report the package's ceiling.
    concurrent_calls_limit: int | None
    concurrent_calls_effective: int
    auto_fallback_enabled: bool
    package: OrgPackageInfo | None
    # Organization profile (0024).
    company_phone: str | None = None
    website: str | None = None
    industry: str | None = None
    company_size: str | None = None
    country: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    about: str | None = None


class OrgSettingsPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    logo_url: str | None = Field(default=None, max_length=512)
    favicon_url: str | None = Field(default=None, max_length=512)
    concurrent_calls_limit: int | None = Field(default=None, ge=1, le=1000)
    auto_fallback_enabled: bool | None = None
    # Organization profile (0024).
    company_phone: str | None = Field(default=None, max_length=32)
    website: str | None = Field(default=None, max_length=255)
    industry: str | None = Field(default=None, max_length=64)
    company_size: str | None = Field(default=None, max_length=32)
    country: str | None = Field(default=None, max_length=64)
    address: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=120)
    zip_code: str | None = Field(default=None, max_length=20)
    about: str | None = Field(default=None, max_length=4000)


# Org-profile string fields with identical "trim, empty→NULL" save handling.
_PROFILE_TEXT_FIELDS = (
    "company_phone",
    "website",
    "industry",
    "company_size",
    "country",
    "address",
    "city",
    "state",
    "zip_code",
    "about",
)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=512)
    new_password: str = Field(min_length=8, max_length=512)


class DeleteIn(BaseModel):
    # Caller must echo the org name exactly. Catches "I clicked the wrong
    # button" mistakes the way GitHub's repo-delete confirmation does.
    confirm_name: str = Field(min_length=1, max_length=255)


# ----- Helpers -------------------------------------------------------------


async def _load_package(session: AsyncSession, tenant_id: int) -> Package | None:
    """Look up the package currently active for this tenant via the
    tenant_packages join table that P2.A2c set up."""
    from sqlalchemy import text

    res = await session.execute(
        text("SELECT package_id FROM tenant_packages WHERE tenant_id = :tid"),
        {"tid": tenant_id},
    )
    row = res.first()
    if not row:
        return None
    return await session.get(Package, int(row[0]))


def _serialize(tenant: Tenant, pkg: Package | None) -> OrgSettingsOut:
    pkg_info = (
        OrgPackageInfo(
            id=pkg.id,
            slug=pkg.slug,
            name=pkg.name,
            concurrency_included=pkg.concurrency_included,
        )
        if pkg is not None
        else None
    )
    # Effective concurrency: tenant override wins when set, else package
    # ceiling, else 1 (no package configured = single-concurrent fallback).
    effective = (
        tenant.concurrent_calls_limit
        if tenant.concurrent_calls_limit is not None
        else (pkg.concurrency_included if pkg else 1)
    )
    return OrgSettingsOut(
        id=tenant.id,
        name=tenant.name,
        slug=tenant.slug,
        owner_email=tenant.owner_email,
        status=tenant.status,
        dograh_org_id=tenant.dograh_org_id,
        created_at=tenant.created_at.isoformat(),
        logo_url=tenant.logo_url,
        favicon_url=tenant.favicon_url,
        concurrent_calls_limit=tenant.concurrent_calls_limit,
        concurrent_calls_effective=effective,
        auto_fallback_enabled=tenant.auto_fallback_enabled,
        package=pkg_info,
        company_phone=tenant.company_phone,
        website=tenant.website,
        industry=tenant.industry,
        company_size=tenant.company_size,
        country=tenant.country,
        address=tenant.address,
        city=tenant.city,
        state=tenant.state,
        zip_code=tenant.zip_code,
        about=tenant.about,
    )


# ----- Routes --------------------------------------------------------------


@router.get("", response_model=OrgSettingsOut)
async def get_org(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> OrgSettingsOut:
    tenant_id = await _tenant_id_for(session, claims)
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant not found")
    pkg = await _load_package(session, tenant_id)
    return _serialize(tenant, pkg)


@router.patch("", response_model=OrgSettingsOut)
async def patch_org(
    body: OrgSettingsPatch,
    request: Request,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> OrgSettingsOut:
    tenant_id = await _tenant_id_for(session, claims)
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant not found")
    pkg = await _load_package(session, tenant_id)

    changes: dict[str, Any] = {}

    if body.name is not None and body.name != tenant.name:
        tenant.name = body.name.strip()
        changes["name"] = tenant.name

    if body.logo_url is not None:
        # Treat empty string as a request to clear the field — the form
        # sends "" when the user wipes the input. Storing NULL is cleaner
        # than empty-string for "no override".
        tenant.logo_url = body.logo_url.strip() or None
        changes["logo_url"] = tenant.logo_url

    if body.favicon_url is not None:
        tenant.favicon_url = body.favicon_url.strip() or None
        changes["favicon_url"] = tenant.favicon_url

    if body.concurrent_calls_limit is not None:
        # Enforce the package ceiling — tenants can dial DOWN but never
        # above what they're paying for.
        ceiling = pkg.concurrency_included if pkg else 1
        if body.concurrent_calls_limit > ceiling:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"concurrent_calls_limit cannot exceed your package's limit ({ceiling})",
            )
        tenant.concurrent_calls_limit = body.concurrent_calls_limit
        changes["concurrent_calls_limit"] = body.concurrent_calls_limit

    if body.auto_fallback_enabled is not None:
        tenant.auto_fallback_enabled = body.auto_fallback_enabled
        changes["auto_fallback_enabled"] = body.auto_fallback_enabled

    for field in _PROFILE_TEXT_FIELDS:
        val = getattr(body, field)
        if val is not None:
            cleaned = val.strip() or None
            setattr(tenant, field, cleaned)
            changes[field] = cleaned

    if changes:
        sub = claims.get("sub", "")
        actor_user_id = int(sub) if sub.isdigit() else None
        await record_audit(
            session,
            actor_kind="tenant",
            actor_user_id=actor_user_id,
            action="tenant.org.update",
            target_kind="tenant",
            target_id=str(tenant.id),
            request=request,
            payload=changes,
        )
        await session.commit()
        await session.refresh(tenant)

    return _serialize(tenant, pkg)


class BrandingUploadOut(BaseModel):
    url: str
    kind: str


@router.post("/branding", response_model=BrandingUploadOut)
async def upload_branding_asset(
    request: Request,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    kind: Annotated[Literal["logo", "favicon"], Form()],
    file: Annotated[UploadFile, File()],
) -> BrandingUploadOut:
    """Upload a logo or favicon to MinIO and persist the resulting URL
    on the tenant row. Returns the public URL so the UI can use it
    immediately without a follow-up GET.

    Object key pattern includes a millisecond timestamp so successive
    uploads don't overwrite — the browser caches forever (Cache-Control:
    immutable) and old objects can be garbage-collected later.

    Size + MIME validation lives in storage.branding so a bad upload
    fails before we ever touch MinIO.
    """
    tenant_id = await _tenant_id_for(session, claims)
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant not found")

    data = await file.read()
    try:
        url = await upload_branding(
            tenant_id=tenant_id,
            kind=kind,
            data=data,
            content_type=file.content_type or "application/octet-stream",
            filename=file.filename,
        )
    except StorageError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    except Exception as e:  # noqa: BLE001
        # MinIO outage or auth issue — surface as 502 so the UI can show a
        # network-level error instead of "validation failed".
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"storage upload failed: {e}"
        ) from None

    # Persist on the tenant row. PATCHing /api/tenant/settings/organization
    # is the alternative; doing it here is one round-trip for the browser.
    if kind == "logo":
        tenant.logo_url = url
    else:
        tenant.favicon_url = url

    sub = claims.get("sub", "")
    actor_user_id = int(sub) if sub.isdigit() else None
    await record_audit(
        session,
        actor_kind="tenant",
        actor_user_id=actor_user_id,
        action="tenant.org.branding_upload",
        target_kind="tenant",
        target_id=str(tenant.id),
        request=request,
        payload={"kind": kind, "url": url, "bytes": len(data)},
    )
    await session.commit()
    return BrandingUploadOut(url=url, kind=kind)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: PasswordChangeIn,
    request: Request,
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    """Password lives on Dograh's side (they own the auth surface). We
    proxy by:
      1. Calling Dograh's login with the current credentials to prove
         the caller actually owns this account.
      2. Once verified, hitting Dograh's password-change endpoint with
         the new password.

    Step 1 is intentionally pessimistic: even though we have a valid
    JWT, re-auth proves the request came from the real user, not a
    session that got hijacked. Matches the standard 'enter current
    password' UX everyone is used to.
    """
    email = claims.get("email")
    if not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "missing email claim")

    client = DograhClient()
    try:
        await client.login(email=email, password=body.current_password)
    except DograhError as e:
        if e.status_code == 401:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED, "current password is wrong"
            ) from None
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "could not verify current password"
        ) from None

    # Honest 501 — Dograh OSS itself doesn't ship a password-change
    # endpoint (verified by grep'ing dograh/api/routes/auth.py; only
    # /signup and /login exist). Until upstream adds one, password
    # rotation requires admin DB action. We still audit the attempt
    # so it's visible in audit_log, and the current-password check
    # above prevents brute-forcing this route as a credential oracle.
    sub = claims.get("sub", "")
    actor_user_id = int(sub) if sub.isdigit() else None
    await record_audit(
        session,
        actor_kind="tenant",
        actor_user_id=actor_user_id,
        action="tenant.org.password_change_blocked",
        target_kind="tenant",
        target_id=str(actor_user_id) if actor_user_id else "?",
        request=request,
        payload={"reason": "dograh oss has no password-change endpoint"},
    )
    await session.commit()
    raise HTTPException(
        status.HTTP_501_NOT_IMPLEMENTED,
        "Dograh OSS does not expose a password-change endpoint. "
        "Your current password was verified. Reach out to support to rotate "
        "your password until this feature ships upstream.",
    )


@router.delete("", status_code=status.HTTP_202_ACCEPTED)
async def delete_org(
    body: DeleteIn,
    request: Request,
    claims: Annotated[dict, Depends(require_org_owner)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, Any]:
    """Org owner only. Flips status='cancelled' + writes an audit row.
    Physical deletion (workflows, recordings, wallet write-off) is
    intentionally NOT done here — that lands as a super-admin tool
    once we've ironed out billing reconciliation rules. The cancelled
    status alone is enough to:
      - hide the tenant from any active billing cycles
      - block /api/tenant/* via the existing status checks
      - surface the row to super-admin as 'awaiting purge'
    """
    tenant_id = await _tenant_id_for(session, claims)
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant not found")
    if body.confirm_name.strip() != tenant.name:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "confirmation name does not match the organization name",
        )
    if tenant.status == "cancelled":
        # Idempotent — clicking delete twice shouldn't re-audit.
        return {"status": tenant.status, "id": tenant.id}

    prev = tenant.status
    tenant.status = "cancelled"

    sub = claims.get("sub", "")
    actor_user_id = int(sub) if sub.isdigit() else None
    await record_audit(
        session,
        actor_kind="tenant",
        actor_user_id=actor_user_id,
        action="tenant.org.delete",
        target_kind="tenant",
        target_id=str(tenant.id),
        request=request,
        payload={"from_status": prev, "confirm_name": body.confirm_name},
    )
    await session.commit()
    return {"status": tenant.status, "id": tenant.id}
