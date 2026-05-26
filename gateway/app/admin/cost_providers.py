"""Cost catalog admin CRUD.

Three resources under one prefix:
    /api/admin/cost-providers              providers themselves
    /api/admin/cost-providers/{id}/prices  prices for one provider
    /api/admin/markup-rules                tenant/kind/global markup overrides
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.billing.adapters import AdapterError, get_adapter
from app.billing.integrated_catalog import COUNTRIES, INTEGRATED_PROVIDERS, find_provider
from app.billing.models import CostProvider, CostProviderPrice, MarkupRule
from app.db import get_session
from app.email.crypto import decrypt_dict, encrypt_dict

router = APIRouter(prefix="/cost-providers", tags=["admin:billing"])
markup_router = APIRouter(prefix="/markup-rules", tags=["admin:billing"])

ProviderKind = Literal["llm", "tts", "stt", "embedding", "telephony", "phone_number"]
PriceUnit = Literal[
    "per_minute",
    "per_input_token",
    "per_output_token",
    "per_character",
    "per_call",
    "per_request",
    "per_1k_tokens",
    "per_1k_chars",
    "per_month",
]


# --- Schemas --------------------------------------------------------------


class ProviderIn(BaseModel):
    kind: ProviderKind
    slug: str = Field(min_length=1, max_length=64, pattern="^[a-z0-9-]+$")
    name: str = Field(min_length=1, max_length=128)
    currency: str = "USD"
    notes: str | None = None
    active: bool = True


class ProviderPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    notes: str | None = None
    active: bool | None = None
    currency: str | None = None


class ProviderOut(BaseModel):
    id: int
    kind: str
    slug: str
    name: str
    currency: str
    notes: str | None
    active: bool
    created_at: str
    updated_at: str


class PriceIn(BaseModel):
    unit: PriceUnit
    variant: str | None = Field(default=None, max_length=128)
    price_micros: int = Field(ge=0)
    currency: str = "USD"
    notes: str | None = None


class PriceOut(BaseModel):
    id: int
    cost_provider_id: int
    unit: str
    variant: str | None
    price_micros: int
    currency: str
    effective_at: str
    notes: str | None


class MarkupIn(BaseModel):
    scope_kind: Literal["global", "kind", "tenant"]
    scope_value: str | None = None
    markup_kind: Literal["percentage", "fixed_per_minute", "fixed_per_unit"]
    value_micros: int = Field(ge=0)
    currency: str = "USD"
    priority: int = 0
    active: bool = True
    notes: str | None = None


class MarkupPatch(BaseModel):
    value_micros: int | None = Field(default=None, ge=0)
    priority: int | None = None
    active: bool | None = None
    notes: str | None = None


class MarkupOut(BaseModel):
    id: int
    scope_kind: str
    scope_value: str | None
    markup_kind: str
    value_micros: int
    currency: str
    priority: int
    active: bool
    notes: str | None
    created_at: str
    updated_at: str


def _provider_out(p: CostProvider) -> ProviderOut:
    return ProviderOut(
        id=p.id,
        kind=p.kind,
        slug=p.slug,
        name=p.name,
        currency=p.currency,
        notes=p.notes,
        active=p.active,
        created_at=p.created_at.isoformat(),
        updated_at=p.updated_at.isoformat(),
    )


def _price_out(p: CostProviderPrice) -> PriceOut:
    return PriceOut(
        id=p.id,
        cost_provider_id=p.cost_provider_id,
        unit=p.unit,
        variant=p.variant,
        price_micros=p.price_micros,
        currency=p.currency,
        effective_at=p.effective_at.isoformat(),
        notes=p.notes,
    )


def _markup_out(m: MarkupRule) -> MarkupOut:
    return MarkupOut(
        id=m.id,
        scope_kind=m.scope_kind,
        scope_value=m.scope_value,
        markup_kind=m.markup_kind,
        value_micros=m.value_micros,
        currency=m.currency,
        priority=m.priority,
        active=m.active,
        notes=m.notes,
        created_at=m.created_at.isoformat(),
        updated_at=m.updated_at.isoformat(),
    )


def _actor_id(claims: dict) -> int | None:
    sub = claims.get("sub", "")
    if sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            return None
    return None


# --- Providers ------------------------------------------------------------


@router.get("")
async def list_providers(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[ProviderOut]:
    rows = (
        await session.execute(
            select(CostProvider).order_by(CostProvider.kind, CostProvider.name)
        )
    ).scalars().all()
    return [_provider_out(p) for p in rows]


@router.get("/integrated")
async def list_integrated_providers(
    _claims: Annotated[dict, Depends(require_super_admin)],
) -> dict:
    """The hand-curated catalog of providers Dograh can speak to today.

    The admin UI uses this to populate the "New provider" dropdown — picking
    from a known list (slug + name + suggested models) cuts the typo risk
    that would otherwise cause missed cost lookups at billing time. Update
    app/billing/integrated_catalog.py whenever a new integration ships.
    """
    return INTEGRATED_PROVIDERS


@router.get("/countries")
async def list_countries(
    _claims: Annotated[dict, Depends(require_super_admin)],
) -> list[dict]:
    """ISO 3166-1 alpha-2 country list used by the telephony AddPriceDialog's
    multi-select. Telephony prices a per-destination-country, so variant is a
    country code rather than a model name."""
    return [{"code": c, "name": n} for c, n in COUNTRIES]


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ProviderOut)
async def create_provider(
    body: ProviderIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProviderOut:
    row = CostProvider(
        kind=body.kind,
        slug=body.slug.lower(),
        name=body.name,
        currency=body.currency.upper(),
        notes=body.notes,
        active=body.active,
    )
    session.add(row)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "slug already taken") from None
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.cost_provider.create",
        target_kind="cost_provider",
        target_id=str(row.id),
        payload={"kind": row.kind, "slug": row.slug},
    )
    await session.commit()
    return _provider_out(row)


@router.patch("/{provider_id}", response_model=ProviderOut)
async def update_provider(
    provider_id: int,
    body: ProviderPatch,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProviderOut:
    row = await session.get(CostProvider, provider_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "provider not found")
    if body.name is not None:
        row.name = body.name
    if body.notes is not None:
        row.notes = body.notes
    if body.active is not None:
        row.active = body.active
    if body.currency is not None:
        row.currency = body.currency.upper()
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.cost_provider.update",
        target_kind="cost_provider",
        target_id=str(provider_id),
    )
    await session.commit()
    await session.refresh(row)
    return _provider_out(row)


@router.delete("/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(
    provider_id: int,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    row = await session.get(CostProvider, provider_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "provider not found")
    await session.delete(row)
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.cost_provider.delete",
        target_kind="cost_provider",
        target_id=str(provider_id),
    )
    await session.commit()


# --- Prices (nested under a provider) -------------------------------------


@router.get("/{provider_id}/prices")
async def list_prices(
    provider_id: int,
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[PriceOut]:
    rows = (
        await session.execute(
            select(CostProviderPrice)
            .where(CostProviderPrice.cost_provider_id == provider_id)
            .order_by(CostProviderPrice.effective_at.desc())
        )
    ).scalars().all()
    return [_price_out(p) for p in rows]


@router.post("/{provider_id}/prices", status_code=status.HTTP_201_CREATED, response_model=PriceOut)
async def create_price(
    provider_id: int,
    body: PriceIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PriceOut:
    provider = await session.get(CostProvider, provider_id)
    if provider is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "provider not found")
    row = CostProviderPrice(
        cost_provider_id=provider_id,
        unit=body.unit,
        variant=body.variant,
        price_micros=body.price_micros,
        currency=body.currency.upper(),
        notes=body.notes,
    )
    session.add(row)
    await session.flush()
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.cost_provider_price.create",
        target_kind="cost_provider_price",
        target_id=str(row.id),
        payload={"provider_id": provider_id, "unit": body.unit, "variant": body.variant},
    )
    await session.commit()
    await session.refresh(row)
    return _price_out(row)


@router.delete("/{provider_id}/prices/{price_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_price(
    provider_id: int,
    price_id: int,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    row = await session.get(CostProviderPrice, price_id)
    if row is None or row.cost_provider_id != provider_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "price not found")
    await session.delete(row)
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.cost_provider_price.delete",
        target_kind="cost_provider_price",
        target_id=str(price_id),
    )
    await session.commit()


# --- Credentials + live model fetch + sync prices -------------------------


class CredentialsIn(BaseModel):
    api_key: str = Field(min_length=1)


class CredentialsStatusOut(BaseModel):
    configured: bool


class AvailableModelOut(BaseModel):
    variant: str
    label: str | None
    source: Literal["live", "catalog"]


class AvailableModelsOut(BaseModel):
    source: Literal["live", "catalog"]
    models: list[AvailableModelOut]
    notes: str | None = None


class SyncPricesOut(BaseModel):
    upserted: int
    skipped: int
    notes: str | None = None


@router.get("/{provider_id}/credentials", response_model=CredentialsStatusOut)
async def get_credentials_status(
    provider_id: int,
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CredentialsStatusOut:
    """Boolean only — secrets never come back out of the API."""
    row = await session.get(CostProvider, provider_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "provider not found")
    return CredentialsStatusOut(configured=row.credentials_encrypted is not None)


class UpsertCredentialsIn(BaseModel):
    kind: ProviderKind
    slug: str = Field(min_length=1, max_length=64, pattern="^[a-z0-9-]+$")
    api_key: str = Field(min_length=1)


@router.post("/upsert-credentials", response_model=ProviderOut)
async def upsert_credentials(
    body: UpsertCredentialsIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProviderOut:
    """Set a platform-level API key for an integrated provider, creating the
    cost_provider row on first use.

    Drives the /settings/provider-api-keys page: listing every catalog provider
    and exposing a single "Set API key" affordance regardless of whether the
    cost_provider has been instantiated yet. If the catalog has the slug we
    use its display name; otherwise we fall back to the slug.
    """
    row = (
        await session.execute(select(CostProvider).where(CostProvider.slug == body.slug))
    ).scalar_one_or_none()
    created = False
    if row is None:
        catalog_hit = find_provider(body.slug)
        display_name = catalog_hit[1]["name"] if catalog_hit else body.slug
        row = CostProvider(
            kind=body.kind,
            slug=body.slug,
            name=display_name,
            currency="USD",
            active=True,
            credentials_encrypted=encrypt_dict({"api_key": body.api_key}),
        )
        session.add(row)
        created = True
    else:
        # Just rotate the key on an existing provider.
        row.credentials_encrypted = encrypt_dict({"api_key": body.api_key})

    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "slug conflict") from None

    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.cost_provider.credentials.upsert",
        target_kind="cost_provider",
        target_id=str(row.id),
        payload={"slug": row.slug, "kind": row.kind, "created": created},
    )
    await session.commit()
    await session.refresh(row)
    return _provider_out(row)


@router.put("/{provider_id}/credentials", response_model=CredentialsStatusOut)
async def set_credentials(
    provider_id: int,
    body: CredentialsIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CredentialsStatusOut:
    row = await session.get(CostProvider, provider_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "provider not found")
    row.credentials_encrypted = encrypt_dict({"api_key": body.api_key})
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.cost_provider.credentials.set",
        target_kind="cost_provider",
        target_id=str(provider_id),
    )
    await session.commit()
    return CredentialsStatusOut(configured=True)


@router.delete("/{provider_id}/credentials", status_code=status.HTTP_204_NO_CONTENT)
async def clear_credentials(
    provider_id: int,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    row = await session.get(CostProvider, provider_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "provider not found")
    row.credentials_encrypted = None
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.cost_provider.credentials.clear",
        target_kind="cost_provider",
        target_id=str(provider_id),
    )
    await session.commit()


@router.get("/{provider_id}/available-models", response_model=AvailableModelsOut)
async def list_available_models(
    provider_id: int,
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AvailableModelsOut:
    """Returns models for THIS provider only.

    Prefers a live fetch from the vendor when:
      (a) we have a live adapter for the provider's slug, and
      (b) credentials are configured.
    Otherwise falls back to the static integrated catalog. Always scoped to
    this provider's slug — never bleeds in models from a sibling provider in
    the same kind.
    """
    row = await session.get(CostProvider, provider_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "provider not found")

    # Try live first if creds present.
    if row.credentials_encrypted is not None:
        try:
            creds = decrypt_dict(row.credentials_encrypted)
            adapter = get_adapter(row.slug, creds)
            result = await adapter.fetch_models()
            return AvailableModelsOut(
                source="live",
                models=[
                    AvailableModelOut(variant=m.variant, label=m.label, source="live")
                    for m in result.models
                ],
                notes=result.notes,
            )
        except AdapterError as e:
            # Fall through to catalog with a note explaining why.
            catalog_models = _catalog_models_for(row.slug)
            return AvailableModelsOut(
                source="catalog",
                models=catalog_models,
                notes=f"live fetch failed ({e}); showing catalog",
            )

    # No creds → catalog.
    return AvailableModelsOut(
        source="catalog",
        models=_catalog_models_for(row.slug),
        notes="no credentials configured — showing catalog models",
    )


@router.post("/{provider_id}/sync-prices", response_model=SyncPricesOut)
async def sync_prices(
    provider_id: int,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SyncPricesOut:
    """Upsert reference prices from the integrated catalog.

    For each (variant, unit) in the catalog for this provider's slug:
    if no active price row exists, insert one. Existing prices are left
    alone so admin overrides aren't blown away. Returns counts.

    True live-pricing fetches (where the vendor exposes a pricing API)
    can hook here when their adapter implements it.
    """
    row = await session.get(CostProvider, provider_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "provider not found")

    catalog_hit = find_provider(row.slug)
    if catalog_hit is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"provider {row.slug} is not in the integrated catalog — nothing to sync",
        )

    _kind, integrated = catalog_hit
    upserted = 0
    skipped = 0
    for model in integrated["models"]:
        for price in model["prices"]:
            existing_q = await session.execute(
                select(CostProviderPrice.id)
                .where(CostProviderPrice.cost_provider_id == provider_id)
                .where(CostProviderPrice.variant == model["variant"])
                .where(CostProviderPrice.unit == price["unit"])
                .where(CostProviderPrice.currency == "USD")
            )
            if existing_q.first() is not None:
                skipped += 1
                continue
            session.add(
                CostProviderPrice(
                    cost_provider_id=provider_id,
                    unit=price["unit"],
                    variant=model["variant"],
                    price_micros=price["price_micros"],
                    currency="USD",
                    notes=f"synced from integrated catalog ({integrated['name']} reference price)",
                )
            )
            upserted += 1

    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.cost_provider.sync_prices",
        target_kind="cost_provider",
        target_id=str(provider_id),
        payload={"upserted": upserted, "skipped": skipped},
    )
    await session.commit()
    return SyncPricesOut(
        upserted=upserted,
        skipped=skipped,
        notes=f"existing prices left alone; {skipped} variant/unit pairs already had a row",
    )


def _catalog_models_for(slug: str) -> list[AvailableModelOut]:
    hit = find_provider(slug)
    if hit is None:
        return []
    _kind, provider = hit
    return [
        AvailableModelOut(variant=m["variant"], label=m["label"], source="catalog")
        for m in provider["models"]
    ]


# --- Markup rules ---------------------------------------------------------


@markup_router.get("")
async def list_markup(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[MarkupOut]:
    rows = (
        await session.execute(
            select(MarkupRule).order_by(MarkupRule.scope_kind, MarkupRule.priority.desc())
        )
    ).scalars().all()
    return [_markup_out(m) for m in rows]


@markup_router.post("", status_code=status.HTTP_201_CREATED, response_model=MarkupOut)
async def create_markup(
    body: MarkupIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MarkupOut:
    if body.scope_kind != "global" and not body.scope_value:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "scope_value required for non-global scopes",
        )
    if body.scope_kind == "global" and body.scope_value:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "global scope must not have scope_value",
        )
    row = MarkupRule(
        scope_kind=body.scope_kind,
        scope_value=body.scope_value,
        markup_kind=body.markup_kind,
        value_micros=body.value_micros,
        currency=body.currency.upper(),
        priority=body.priority,
        active=body.active,
        notes=body.notes,
    )
    session.add(row)
    await session.flush()
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.markup_rule.create",
        target_kind="markup_rule",
        target_id=str(row.id),
        payload={"scope_kind": row.scope_kind, "markup_kind": row.markup_kind},
    )
    await session.commit()
    await session.refresh(row)
    return _markup_out(row)


@markup_router.patch("/{rule_id}", response_model=MarkupOut)
async def update_markup(
    rule_id: int,
    body: MarkupPatch,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MarkupOut:
    row = await session.get(MarkupRule, rule_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rule not found")
    if body.value_micros is not None:
        row.value_micros = body.value_micros
    if body.priority is not None:
        row.priority = body.priority
    if body.active is not None:
        row.active = body.active
    if body.notes is not None:
        row.notes = body.notes
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.markup_rule.update",
        target_kind="markup_rule",
        target_id=str(rule_id),
    )
    await session.commit()
    await session.refresh(row)
    return _markup_out(row)


@markup_router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_markup(
    rule_id: int,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    row = await session.get(MarkupRule, rule_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rule not found")
    await session.delete(row)
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.markup_rule.delete",
        target_kind="markup_rule",
        target_id=str(rule_id),
    )
    await session.commit()
