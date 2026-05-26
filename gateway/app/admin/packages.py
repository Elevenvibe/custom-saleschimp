"""Packages CRUD.

Packages express subscription tiers. Two kinds today:
    payg    — month-to-month pre-paid bundle + per-minute overage
    annual  — yearly contract, often "contact sales"

Money: monthly_price_cents stays in cents (the existing column shape).
overage_per_minute_micros uses micros, matching the cost catalog so the
per-call billing math doesn't switch units mid-flight.

The customer-facing /api/tenant/plans endpoint reads visible=true rows
and renders the Plans page from this same data.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.db import get_session
from app.packages.models import Package, PackagePlugin

router = APIRouter(prefix="/packages", tags=["admin:packages"])

PackageKind = Literal["payg", "annual"]
BillingPeriod = Literal[
    "monthly",
    "annual",
    "usage",
    "per_sec",
    "per_min",
    "per_hour",
    "per_day",
    "per_week",
]
ProviderKindLit = Literal["llm", "tts", "stt", "embedding", "telephony", "phone_number"]


# --- Schemas --------------------------------------------------------------


class PackageIn(BaseModel):
    slug: str = Field(min_length=1, max_length=64, pattern="^[a-z0-9-]+$")
    name: str = Field(min_length=1, max_length=128)
    description: str | None = None
    kind: PackageKind = "payg"
    billing_period: BillingPeriod = "monthly"
    monthly_price_cents: int = Field(ge=0, default=0)
    bundled_minutes: int = Field(ge=0, default=0)
    overage_per_minute_micros: int = Field(ge=0, default=0)
    concurrency_included: int = Field(ge=0, default=0)
    currency: str = "USD"
    contact_sales: bool = False
    visible: bool = True
    plugin_ids: list[str] = Field(default_factory=list)
    # New in 0006_packages_advanced.
    allowed_provider_kinds: list[ProviderKindLit] = Field(default_factory=list)
    markup_rule_ids: dict[str, int] = Field(default_factory=dict)
    apply_markup: bool = False
    usage_only: bool = False
    allowed_countries: list[str] = Field(default_factory=list)


class PackagePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    kind: PackageKind | None = None
    billing_period: BillingPeriod | None = None
    monthly_price_cents: int | None = Field(default=None, ge=0)
    bundled_minutes: int | None = Field(default=None, ge=0)
    overage_per_minute_micros: int | None = Field(default=None, ge=0)
    concurrency_included: int | None = Field(default=None, ge=0)
    currency: str | None = None
    contact_sales: bool | None = None
    visible: bool | None = None
    plugin_ids: list[str] | None = None
    allowed_provider_kinds: list[ProviderKindLit] | None = None
    markup_rule_ids: dict[str, int] | None = None
    apply_markup: bool | None = None
    usage_only: bool | None = None
    allowed_countries: list[str] | None = None


class PackageOut(BaseModel):
    id: int
    slug: str
    name: str
    description: str | None
    kind: str
    billing_period: str
    monthly_price_cents: int
    bundled_minutes: int
    overage_per_minute_micros: int
    concurrency_included: int
    currency: str
    contact_sales: bool
    visible: bool
    plugins: list[str]
    allowed_provider_kinds: list[str]
    markup_rule_ids: dict[str, int]
    apply_markup: bool
    usage_only: bool
    allowed_countries: list[str]
    created_at: str


def _serialize(pkg: Package, plugin_ids: list[str]) -> PackageOut:
    return PackageOut(
        id=pkg.id,
        slug=pkg.slug,
        name=pkg.name,
        description=pkg.description,
        kind=pkg.kind,
        billing_period=pkg.billing_period,
        monthly_price_cents=pkg.monthly_price_cents,
        bundled_minutes=pkg.bundled_minutes,
        overage_per_minute_micros=pkg.overage_per_minute_micros,
        concurrency_included=pkg.concurrency_included,
        currency=pkg.currency,
        contact_sales=pkg.contact_sales,
        visible=pkg.visible,
        plugins=plugin_ids,
        allowed_provider_kinds=list(pkg.allowed_provider_kinds or []),
        markup_rule_ids=dict(pkg.markup_rule_ids or {}),
        apply_markup=pkg.apply_markup,
        usage_only=pkg.usage_only,
        allowed_countries=list(pkg.allowed_countries or []),
        created_at=pkg.created_at.isoformat(),
    )


async def _plugin_ids_for(session: AsyncSession, package_id: int) -> list[str]:
    rows = await session.execute(
        select(PackagePlugin.plugin_id).where(PackagePlugin.package_id == package_id)
    )
    return list(rows.scalars().all())


async def _replace_plugins(
    session: AsyncSession, package_id: int, plugin_ids: list[str]
) -> None:
    existing = await session.execute(
        select(PackagePlugin).where(PackagePlugin.package_id == package_id)
    )
    for row in existing.scalars().all():
        await session.delete(row)
    for pid in plugin_ids:
        session.add(PackagePlugin(package_id=package_id, plugin_id=pid))


def _actor_id(claims: dict) -> int | None:
    sub = claims.get("sub", "")
    if sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            return None
    return None


# --- Routes ----------------------------------------------------------------


@router.get("", response_model=list[PackageOut])
async def list_packages(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[PackageOut]:
    rows = (
        await session.execute(
            select(Package).order_by(Package.kind, Package.monthly_price_cents)
        )
    ).scalars().all()
    out: list[PackageOut] = []
    for pkg in rows:
        plugin_ids = await _plugin_ids_for(session, pkg.id)
        out.append(_serialize(pkg, plugin_ids))
    return out


@router.post("", response_model=PackageOut, status_code=status.HTTP_201_CREATED)
async def create_package(
    body: PackageIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PackageOut:
    pkg = Package(
        slug=body.slug.lower(),
        name=body.name,
        description=body.description,
        kind=body.kind,
        billing_period=body.billing_period,
        # When usage_only is true the recurring fee is conceptually zero —
        # store that explicitly so /tenant/plans can't render a stale price.
        monthly_price_cents=0 if body.usage_only else body.monthly_price_cents,
        bundled_minutes=body.bundled_minutes,
        overage_per_minute_micros=body.overage_per_minute_micros,
        concurrency_included=body.concurrency_included,
        currency=body.currency.upper(),
        contact_sales=body.contact_sales,
        visible=body.visible,
        allowed_provider_kinds=body.allowed_provider_kinds,
        markup_rule_ids=body.markup_rule_ids,
        apply_markup=body.apply_markup,
        usage_only=body.usage_only,
        allowed_countries=[c.upper() for c in body.allowed_countries],
        limits={},
    )
    session.add(pkg)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "slug already taken") from None
    await _replace_plugins(session, pkg.id, body.plugin_ids)
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.package.create",
        target_kind="package",
        target_id=str(pkg.id),
        payload={"slug": pkg.slug, "kind": pkg.kind},
    )
    await session.commit()
    return _serialize(pkg, body.plugin_ids)


@router.patch("/{package_id}", response_model=PackageOut)
async def update_package(
    package_id: int,
    body: PackagePatch,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PackageOut:
    pkg = await session.get(Package, package_id)
    if pkg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "package not found")
    for field in (
        "name",
        "description",
        "kind",
        "billing_period",
        "monthly_price_cents",
        "bundled_minutes",
        "overage_per_minute_micros",
        "concurrency_included",
        "currency",
        "contact_sales",
        "visible",
        "allowed_provider_kinds",
        "markup_rule_ids",
        "apply_markup",
        "usage_only",
    ):
        v = getattr(body, field)
        if v is not None:
            setattr(pkg, field, v.upper() if field == "currency" else v)
    if body.allowed_countries is not None:
        pkg.allowed_countries = [c.upper() for c in body.allowed_countries]
    if body.usage_only is True:
        # Mirror the create rule — usage_only forces the recurring fee to 0.
        pkg.monthly_price_cents = 0
    if body.plugin_ids is not None:
        await _replace_plugins(session, pkg.id, body.plugin_ids)
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.package.update",
        target_kind="package",
        target_id=str(pkg.id),
    )
    await session.commit()
    await session.refresh(pkg)
    plugin_ids = await _plugin_ids_for(session, pkg.id)
    return _serialize(pkg, plugin_ids)


@router.delete("/{package_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_package(
    package_id: int,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    pkg = await session.get(Package, package_id)
    if pkg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "package not found")
    await session.delete(pkg)
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.package.delete",
        target_kind="package",
        target_id=str(package_id),
    )
    await session.commit()
