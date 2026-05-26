"""Tenant-side marketplace surface.

  GET /api/tenant/marketplace                — browse the visible catalog
  GET /api/tenant/marketplace/installed      — list this tenant's installs
  POST /api/tenant/marketplace/{slug}/install
  POST /api/tenant/marketplace/{slug}/uninstall
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.customer_auth.deps import require_customer, require_org_admin
from app.customer_auth.plans import _tenant_id_for
from app.db import get_session
from app.marketplace import service as marketplace_service

router = APIRouter(prefix="/marketplace", tags=["customer-auth:marketplace"])


class CatalogEntryOut(BaseModel):
    slug: str
    name: str
    description: str | None
    vendor: str | None
    icon_url: str | None
    homepage_url: str | None
    pricing_kind: str
    price_micros: int
    currency: str
    hooks: list[str]
    required_scopes: list[str]


class InstallOut(BaseModel):
    slug: str
    name: str
    status: str
    settings: dict[str, Any]
    installed_at: str
    pricing_kind: str
    price_micros: int
    currency: str


class InstallIn(BaseModel):
    settings: dict[str, Any] | None = Field(default=None)


@router.get("", response_model=list[CatalogEntryOut])
async def browse(
    _claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[CatalogEntryOut]:
    rows = await marketplace_service.list_catalog(session, visible_only=True)
    return [
        CatalogEntryOut(
            slug=e.slug,
            name=e.name,
            description=e.description,
            vendor=e.vendor,
            icon_url=e.icon_url,
            homepage_url=e.homepage_url,
            pricing_kind=e.pricing_kind,
            price_micros=e.price_micros,
            currency=e.currency,
            hooks=list(e.hooks or []),
            required_scopes=list(e.required_scopes or []),
        )
        for e in rows
    ]


@router.get("/installed", response_model=list[InstallOut])
async def installed(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[InstallOut]:
    tenant_id = await _tenant_id_for(session, claims)
    rows = await marketplace_service.list_installs(session, tenant_id=tenant_id)
    return [
        InstallOut(
            slug=entry.slug,
            name=entry.name,
            status=inst.status,
            settings=inst.settings or {},
            installed_at=inst.installed_at.isoformat(),
            pricing_kind=entry.pricing_kind,
            price_micros=entry.price_micros,
            currency=entry.currency,
        )
        for inst, entry in rows
    ]


@router.post("/{slug}/install", response_model=InstallOut)
async def install(
    slug: str,
    body: InstallIn,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> InstallOut:
    tenant_id = await _tenant_id_for(session, claims)
    sub = claims.get("sub", "")
    actor_user_id = None
    try:
        actor_user_id = int(sub)
    except (TypeError, ValueError):
        actor_user_id = None
    try:
        await marketplace_service.install(
            session,
            tenant_id=tenant_id,
            plugin_slug=slug,
            settings=body.settings,
            actor_user_id=actor_user_id,
        )
    except marketplace_service.MarketplaceError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    await session.commit()
    # Return the freshly-installed row so the client doesn't need a
    # follow-up round-trip to render the post-install state.
    rows = await marketplace_service.list_installs(session, tenant_id=tenant_id)
    inst, entry = next((p for p in rows if p[1].slug == slug), (None, None))
    if inst is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "install lookup failed")
    return InstallOut(
        slug=entry.slug,
        name=entry.name,
        status=inst.status,
        settings=inst.settings or {},
        installed_at=inst.installed_at.isoformat(),
        pricing_kind=entry.pricing_kind,
        price_micros=entry.price_micros,
        currency=entry.currency,
    )


@router.post("/{slug}/uninstall", status_code=status.HTTP_204_NO_CONTENT)
async def uninstall(
    slug: str,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    tenant_id = await _tenant_id_for(session, claims)
    removed = await marketplace_service.uninstall(
        session, tenant_id=tenant_id, plugin_slug=slug
    )
    if not removed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such installed plugin")
    await session.commit()
