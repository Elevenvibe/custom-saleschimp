"""Payments service — wallet's bridge to the outside world.

This is the *only* module that knows about both the wallet and the
provider adapters. Routes call into here; adapters know nothing about
the wallet; the wallet knows nothing about Stripe/Paystack. That
isolation lets us add a new provider without touching the wallet logic
and add a new wallet feature (e.g. holds, multi-currency) without
touching the adapters.

Three responsibilities:
  1. Open a top-up intent — record the pending payment_intent row and
     return the provider-issued client artifacts.
  2. Reconcile a webhook event — flip the matching payment_intent to
     succeeded/failed/refunded and credit the wallet *exactly once*
     using the intent id as the ledger ref so retries can't double-pay.
  3. Auto-reload sweep — for tenants below their threshold, attempt a
     charge against their default method and reconcile inline.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.email.crypto import decrypt_dict, encrypt_dict
from app.payments.adapters import (
    UnknownProvider,
    get_provider,
    list_configured as adapter_list_configured,
)
from app.payments.adapters.base import NormalizedEvent, ProviderError
from app.payments.models import PaymentIntent, PaymentMethod
from app.wallet import service as wallet_service
from app.wallet.models import Wallet

log = structlog.get_logger()


class PaymentIntentNotFound(Exception):
    pass


@dataclass(slots=True)
class TopUpResult:
    intent_id: int
    provider: str
    provider_ref: str
    client_secret: str | None
    authorization_url: str | None
    amount_cents: int
    currency: str


async def list_providers() -> list[dict[str, Any]]:
    """Cheap delegate so routes don't import the adapter registry directly."""
    return adapter_list_configured()


async def open_topup(
    session: AsyncSession,
    *,
    tenant_id: int,
    provider: str,
    amount_cents: int,
    currency: str,
    idempotency_key: str | None = None,
    payment_method_id: int | None = None,
) -> TopUpResult:
    """Create a pending payment_intent and call the provider to start a
    charge. `payment_method_id` is used by the auto-reload path to
    charge an already-registered method off-session — for the
    interactive path the customer picks/enters the method client-side."""
    try:
        adapter = get_provider(provider)
    except UnknownProvider:
        raise ProviderError(f"unknown provider {provider!r}") from None
    if not adapter.is_configured():
        raise ProviderError(f"{provider} not configured")

    pm_token: str | None = None
    if payment_method_id is not None:
        pm = await session.get(PaymentMethod, payment_method_id)
        if pm is None or pm.tenant_id != tenant_id or pm.status != "active":
            raise ProviderError("payment method not found or revoked")
        pm_token = decrypt_dict(pm.token_encrypted).get("token")

    init = await adapter.create_topup(
        tenant_id=tenant_id,
        amount_cents=amount_cents,
        currency=currency,
        idempotency_key=idempotency_key,
        payment_method_token=pm_token,
    )

    # Insert the pending row. UniqueConstraint(provider, provider_ref) +
    # UniqueConstraint(tenant_id, idempotency_key) double-protect against
    # races between the route and a fast-fire webhook.
    intent = PaymentIntent(
        tenant_id=tenant_id,
        provider=provider,
        provider_ref=init.provider_ref,
        amount_cents=amount_cents,
        currency=currency.upper(),
        status="pending",
        payment_method_id=payment_method_id,
        idempotency_key=idempotency_key,
        raw_payload={"init": init.raw},
    )
    session.add(intent)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        # If we already opened this intent (idempotency hit), return the
        # existing one so the client UI can finish from where it left off.
        existing = (
            await session.execute(
                select(PaymentIntent).where(
                    PaymentIntent.tenant_id == tenant_id,
                    PaymentIntent.idempotency_key == idempotency_key,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            raise
        intent = existing

    log.info(
        "payments.topup_opened",
        tenant_id=tenant_id,
        provider=provider,
        provider_ref=init.provider_ref,
        amount_cents=amount_cents,
    )
    return TopUpResult(
        intent_id=intent.id,
        provider=provider,
        provider_ref=init.provider_ref,
        client_secret=init.client_secret,
        authorization_url=init.authorization_url,
        amount_cents=amount_cents,
        currency=currency.upper(),
    )


async def register_method(
    session: AsyncSession,
    *,
    tenant_id: int,
    provider: str,
    confirmation_token: str,
    make_default: bool = True,
) -> PaymentMethod:
    adapter = get_provider(provider)
    if not adapter.is_configured():
        raise ProviderError(f"{provider} not configured")
    reg = await adapter.register_method(confirmation_token=confirmation_token)

    if make_default:
        # Demote any existing default rows first; flush so the partial
        # index (if we add one later) doesn't trip.
        existing = (
            await session.execute(
                select(PaymentMethod)
                .where(PaymentMethod.tenant_id == tenant_id)
                .where(PaymentMethod.is_default.is_(True))
            )
        ).scalars().all()
        for row in existing:
            row.is_default = False
        await session.flush()

    pm = PaymentMethod(
        tenant_id=tenant_id,
        provider=provider,
        token_encrypted=encrypt_dict({"token": reg.token}),
        brand=reg.brand,
        last4=reg.last4,
        exp_month=reg.exp_month,
        exp_year=reg.exp_year,
        is_default=make_default,
    )
    session.add(pm)
    await session.flush()
    log.info(
        "payments.method_registered",
        tenant_id=tenant_id,
        provider=provider,
        last4=reg.last4,
    )
    return pm


async def reconcile_event(
    session: AsyncSession, provider: str, event: NormalizedEvent
) -> str:
    """Apply a parsed, signature-verified webhook event to the wallet.

    Returns a short string describing what happened, useful for the
    webhook response body and for log/audit.
    """
    if event.kind == "ignored":
        return "ignored"
    if not event.provider_ref:
        return "missing_provider_ref"

    intent = (
        await session.execute(
            select(PaymentIntent).where(
                PaymentIntent.provider == provider,
                PaymentIntent.provider_ref == event.provider_ref,
            )
        )
    ).scalar_one_or_none()
    if intent is None:
        log.warning(
            "payments.webhook_orphan",
            provider=provider,
            provider_ref=event.provider_ref,
            kind=event.kind,
        )
        return "no_matching_intent"

    if event.kind == "topup.succeeded":
        if intent.status == "succeeded":
            return "already_credited"
        intent.status = "succeeded"
        intent.updated_at = datetime.utcnow()
        ledger = await wallet_service.credit(
            session,
            intent.tenant_id,
            # amount is in cents (provider unit). Convert to micros for
            # the ledger. We use the intent's stored amount, not the
            # event's, so a tampered webhook can't move a different
            # number of dollars than the user authorized.
            intent.amount_cents * 10_000,
            reason="topup",
            ref_kind="payment_intent",
            ref_id=str(intent.id),
            actor_kind="system",
            notes=f"{provider} {intent.provider_ref}",
        )
        intent.ledger_id = ledger.id
        return "credited"

    if event.kind == "topup.failed":
        intent.status = "failed"
        intent.error = (event.raw.get("error") or {}).get("message") if isinstance(event.raw, dict) else None
        intent.updated_at = datetime.utcnow()
        return "marked_failed"

    if event.kind == "topup.refunded":
        if intent.status == "refunded":
            return "already_refunded"
        intent.status = "refunded"
        intent.updated_at = datetime.utcnow()
        # The refunded amount may be partial — trust the event here
        # since intent.amount_cents could be larger than the refund.
        refund_cents = event.amount_cents or intent.amount_cents
        await wallet_service.adjust(
            session,
            intent.tenant_id,
            -refund_cents * 10_000,
            actor_user_id=None,
            notes=f"refund {provider} {intent.provider_ref}",
        )
        return "refunded"

    return "unhandled"


async def try_auto_reload(session: AsyncSession, wallet: Wallet) -> str:
    """One pass for one wallet. Returns a short status the cron logs.

    Pre-conditions:
      - auto_reload_enabled is true
      - balance is below threshold
      - a payment_method_id is configured
      - the configured method is still active
    Failures are non-fatal — we flip the intent to failed and move on.
    """
    if not wallet.auto_reload_enabled:
        return "disabled"
    if wallet.balance_micros >= wallet.auto_reload_threshold_micros:
        return "above_threshold"
    if wallet.auto_reload_payment_method_id is None or wallet.auto_reload_amount_micros <= 0:
        return "missing_config"

    pm = await session.get(PaymentMethod, wallet.auto_reload_payment_method_id)
    if pm is None or pm.status != "active":
        return "method_revoked"

    amount_cents = max(1, wallet.auto_reload_amount_micros // 10_000)
    idem = f"auto-{wallet.tenant_id}-{secrets.token_hex(6)}"
    try:
        result = await open_topup(
            session,
            tenant_id=wallet.tenant_id,
            provider=pm.provider,
            amount_cents=amount_cents,
            currency=wallet.currency,
            idempotency_key=idem,
            payment_method_id=pm.id,
        )
    except ProviderError as e:
        log.warning("auto_reload.charge_failed", tenant_id=wallet.tenant_id, error=str(e))
        return "charge_failed"

    # Stripe off-session charges with `confirm=true` return status=succeeded
    # synchronously. The reconciliation path still handles the webhook for
    # async providers (Paystack charge_authorization).
    raw_status = (result.client_secret is None and "succeeded") or "pending"
    if raw_status == "succeeded":
        # Skip the webhook — credit now using the intent we just opened.
        intent = (
            await session.execute(
                select(PaymentIntent).where(PaymentIntent.id == result.intent_id)
            )
        ).scalar_one()
        if intent.status != "succeeded":
            intent.status = "succeeded"
            ledger = await wallet_service.credit(
                session,
                intent.tenant_id,
                intent.amount_cents * 10_000,
                reason="auto_reload",
                ref_kind="payment_intent",
                ref_id=str(intent.id),
                actor_kind="system",
                notes=f"auto-reload {pm.provider} {intent.provider_ref}",
            )
            intent.ledger_id = ledger.id
        return "reloaded"
    return "pending_webhook"
