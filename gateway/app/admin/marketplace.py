"""Admin marketplace CRUD.

Routes:
  GET    /api/admin/marketplace/plugins
  POST   /api/admin/marketplace/plugins
  PATCH  /api/admin/marketplace/plugins/{slug}
  DELETE /api/admin/marketplace/plugins/{slug}
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_super_admin
from app.db import get_session
from app.marketplace import service as marketplace_service
from app.marketplace.models import PluginCatalogEntry

router = APIRouter(prefix="/marketplace/plugins", tags=["admin:marketplace"])

PricingKind = Literal["free", "one_time", "monthly", "per_call"]


class PluginIn(BaseModel):
    slug: str = Field(min_length=1, max_length=64, pattern="^[a-z0-9-]+$")
    name: str = Field(min_length=1, max_length=128)
    description: str | None = None
    vendor: str | None = Field(default=None, max_length=128)
    icon_url: str | None = Field(default=None, max_length=512)
    homepage_url: str | None = Field(default=None, max_length=512)
    pricing_kind: PricingKind = "free"
    price_micros: int = Field(ge=0, default=0)
    currency: str = "USD"
    hooks: list[str] = Field(default_factory=list)
    required_scopes: list[str] = Field(default_factory=list)
    visible: bool = True


class PluginPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    vendor: str | None = None
    icon_url: str | None = None
    homepage_url: str | None = None
    pricing_kind: PricingKind | None = None
    price_micros: int | None = Field(default=None, ge=0)
    currency: str | None = None
    hooks: list[str] | None = None
    required_scopes: list[str] | None = None
    visible: bool | None = None


class PluginOut(BaseModel):
    id: int
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
    visible: bool
    created_at: str
    updated_at: str


def _serialize(e: PluginCatalogEntry) -> PluginOut:
    return PluginOut(
        id=e.id,
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
        visible=e.visible,
        created_at=e.created_at.isoformat(),
        updated_at=e.updated_at.isoformat(),
    )


@router.get("", response_model=list[PluginOut])
async def list_plugins(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[PluginOut]:
    rows = await marketplace_service.list_catalog(session)
    return [_serialize(e) for e in rows]


@router.post("", response_model=PluginOut, status_code=status.HTTP_201_CREATED)
async def create_plugin(
    body: PluginIn,
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PluginOut:
    entry = await marketplace_service.upsert_entry(
        session, slug=body.slug, fields=body.model_dump()
    )
    await session.commit()
    return _serialize(entry)


@router.patch("/{slug}", response_model=PluginOut)
async def patch_plugin(
    slug: str,
    body: PluginPatch,
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PluginOut:
    fields = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not fields:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no fields to update")
    entry = await marketplace_service.upsert_entry(session, slug=slug, fields=fields)
    await session.commit()
    return _serialize(entry)


@router.delete("/{slug}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plugin(
    slug: str,
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    removed = await marketplace_service.delete_entry(session, slug=slug)
    if not removed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such plugin")
    await session.commit()
