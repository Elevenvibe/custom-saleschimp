"""Tenant-side payment routes.

GET  /api/tenant/wallet/providers     which adapters are configured
POST /api/tenant/wallet/topup         start a top-up; returns the
                                      client_secret / authorization_url
GET  /api/tenant/payment-methods      list stored cards
POST /api/tenant/payment-methods      finalize a confirmed Setup Intent
PATCH /api/tenant/payment-methods/{id} set/unset default
DELETE /api/tenant/payment-methods/{id} revoke

The actual card data never lands on our backend. Stripe Elements posts
directly to Stripe; we only see the resulting payment_method id.
Paystack returns an authorization_url we redirect to; we only see the
reference + post-payment webhook.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.customer_auth.deps import require_customer, require_org_admin
from app.customer_auth.plans import _tenant_id_for
from app.db import get_session
from app.payments import service as payments_service
from app.payments.adapters import DEFAULT_PROVIDER, UnknownProvider, get_provider
from app.payments.adapters.base import ProviderError
from app.payments.models import PaymentIntent, PaymentMethod

router = APIRouter(tags=["customer-auth:payments"])


class ProviderInfo(BaseModel):
    slug: str
    configured: bool
    is_default: bool
    # Public — required by Stripe Elements / Paystack inline. Empty
    # string when the provider isn't configured (or doesn't use one).
    publishable_key: str = ""


class TopUpIn(BaseModel):
    amount_cents: int = Field(ge=100, le=1_000_000_00)
    currency: str = "USD"
    provider: str = DEFAULT_PROVIDER
    idempotency_key: str | None = Field(default=None, max_length=64)
    payment_method_id: int | None = None


class TopUpOut(BaseModel):
    intent_id: int
    provider: str
    provider_ref: str
    client_secret: str | None
    authorization_url: str | None
    amount_cents: int
    currency: str


class PaymentMethodOut(BaseModel):
    id: int
    provider: str
    brand: str | None
    last4: str | None
    exp_month: int | None
    exp_year: int | None
    is_default: bool
    status: str
    created_at: str


class RegisterMethodIn(BaseModel):
    provider: Literal["stripe", "paystack"] = DEFAULT_PROVIDER  # type: ignore[assignment]
    confirmation_token: str = Field(min_length=1, max_length=128)
    make_default: bool = True


class PaymentMethodPatch(BaseModel):
    is_default: bool | None = None


def _serialize_method(pm: PaymentMethod) -> PaymentMethodOut:
    return PaymentMethodOut(
        id=pm.id,
        provider=pm.provider,
        brand=pm.brand,
        last4=pm.last4,
        exp_month=pm.exp_month,
        exp_year=pm.exp_year,
        is_default=pm.is_default,
        status=pm.status,
        created_at=pm.created_at.isoformat(),
    )


@router.get("/wallet/providers", response_model=list[ProviderInfo])
async def list_providers() -> list[ProviderInfo]:
    return [ProviderInfo(**p) for p in await payments_service.list_providers()]


@router.post("/wallet/topup", response_model=TopUpOut)
async def topup(
    body: TopUpIn,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TopUpOut:
    tenant_id = await _tenant_id_for(session, claims)
    try:
        result = await payments_service.open_topup(
            session,
            tenant_id=tenant_id,
            provider=body.provider,
            amount_cents=body.amount_cents,
            currency=body.currency,
            idempotency_key=body.idempotency_key,
            payment_method_id=body.payment_method_id,
        )
    except UnknownProvider:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown provider") from None
    except ProviderError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    await session.commit()
    return TopUpOut(
        intent_id=result.intent_id,
        provider=result.provider,
        provider_ref=result.provider_ref,
        client_secret=result.client_secret,
        authorization_url=result.authorization_url,
        amount_cents=result.amount_cents,
        currency=result.currency,
    )


class SetupIntentOut(BaseModel):
    client_secret: str
    id: str


@router.post("/payment-methods/setup-intent", response_model=SetupIntentOut)
async def create_setup_intent(
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SetupIntentOut:
    """Stripe-only — mint a SetupIntent so the client can run Elements
    and confirm a card without charging it. The returned payment_method
    id then comes back to POST /payment-methods for storage."""
    tenant_id = await _tenant_id_for(session, claims)
    try:
        adapter = get_provider("stripe")
        if not adapter.is_configured():
            raise ProviderError("stripe not configured")
        result = await adapter.create_setup_intent(tenant_id=tenant_id)  # type: ignore[attr-defined]
    except ProviderError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    if not result.get("client_secret"):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "stripe did not return a client_secret")
    return SetupIntentOut(client_secret=result["client_secret"], id=result["id"])


@router.get("/payment-methods", response_model=list[PaymentMethodOut])
async def list_methods(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[PaymentMethodOut]:
    tenant_id = await _tenant_id_for(session, claims)
    rows = (
        await session.execute(
            select(PaymentMethod)
            .where(PaymentMethod.tenant_id == tenant_id)
            .where(PaymentMethod.status == "active")
            .order_by(PaymentMethod.is_default.desc(), PaymentMethod.id.desc())
        )
    ).scalars().all()
    return [_serialize_method(r) for r in rows]


@router.post(
    "/payment-methods",
    response_model=PaymentMethodOut,
    status_code=status.HTTP_201_CREATED,
)
async def register_method(
    body: RegisterMethodIn,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PaymentMethodOut:
    tenant_id = await _tenant_id_for(session, claims)
    try:
        pm = await payments_service.register_method(
            session,
            tenant_id=tenant_id,
            provider=body.provider,
            confirmation_token=body.confirmation_token,
            make_default=body.make_default,
        )
    except UnknownProvider:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown provider") from None
    except ProviderError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    await session.commit()
    return _serialize_method(pm)


@router.patch("/payment-methods/{pm_id}", response_model=PaymentMethodOut)
async def update_method(
    pm_id: int,
    body: PaymentMethodPatch,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PaymentMethodOut:
    tenant_id = await _tenant_id_for(session, claims)
    pm = await session.get(PaymentMethod, pm_id)
    if pm is None or pm.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "payment method not found")
    if body.is_default is True:
        existing = (
            await session.execute(
                select(PaymentMethod)
                .where(PaymentMethod.tenant_id == tenant_id)
                .where(PaymentMethod.is_default.is_(True))
            )
        ).scalars().all()
        for row in existing:
            row.is_default = False
        pm.is_default = True
    elif body.is_default is False:
        pm.is_default = False
    await session.commit()
    await session.refresh(pm)
    return _serialize_method(pm)


@router.delete("/payment-methods/{pm_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_method(
    pm_id: int,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    tenant_id = await _tenant_id_for(session, claims)
    pm = await session.get(PaymentMethod, pm_id)
    if pm is None or pm.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "payment method not found")
    # Soft revoke so historical intents still resolve. The auto-reload
    # cron checks status='active' before charging.
    pm.status = "revoked"
    pm.is_default = False
    await session.commit()
