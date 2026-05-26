"""Adapter interface every payment provider implements.

The point of the interface is to keep the route layer provider-agnostic:
`POST /api/tenant/wallet/topup` shouldn't care whether it's Stripe
returning a `client_secret` for Elements or Paystack returning an
`authorization_url` to redirect to — both shapes flow through the same
`TopUpInit` record.

Method contract:
  - create_topup     → start a charge; returns enough data for the
                       client SDK / redirect to take over
  - register_method  → finalize a Setup Intent / authorization into a
                       reusable payment_method
  - charge_method    → charge an already-registered payment_method
                       (called by the auto-reload cron)
  - verify_webhook   → returns parsed payload or raises
  - parse_event      → maps a verified payload to a normalized
                       NormalizedEvent the wallet layer understands
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Literal


class ProviderError(Exception):
    """Anything the provider tells us it couldn't do (decline, 4xx,
    signature mismatch). Routes turn these into 400/402 responses."""


@dataclass(slots=True)
class TopUpInit:
    provider_ref: str
    """Provider-issued id (Stripe payment_intent id, Paystack reference)."""

    client_secret: str | None
    """For Stripe Elements — paste into `confirmPayment`. None for Paystack."""

    authorization_url: str | None
    """For Paystack — redirect target. None for Stripe."""

    raw: dict[str, Any]


@dataclass(slots=True)
class RegisteredMethod:
    """Returned after a Setup Intent / authorization is confirmed."""

    token: str
    """Opaque provider token we'll Fernet-encrypt + store."""

    brand: str | None
    last4: str | None
    exp_month: int | None
    exp_year: int | None
    raw: dict[str, Any]


@dataclass(slots=True)
class ChargeResult:
    provider_ref: str
    status: Literal["succeeded", "pending", "failed"]
    raw: dict[str, Any]
    error: str | None = None


@dataclass(slots=True)
class NormalizedEvent:
    """What the webhook dispatcher hands to the wallet reconciler."""

    kind: Literal["topup.succeeded", "topup.failed", "topup.refunded", "ignored"]
    provider_ref: str | None
    amount_cents: int | None
    currency: str | None
    raw: dict[str, Any]


class BillingProvider(ABC):
    slug: str

    def is_configured(self) -> bool:
        """True iff the secret key for this provider is set. Routes can
        short-circuit to 503 instead of attempting and failing inside
        the adapter."""
        return False

    @abstractmethod
    async def create_topup(
        self,
        *,
        tenant_id: int,
        amount_cents: int,
        currency: str,
        idempotency_key: str | None,
        payment_method_token: str | None = None,
    ) -> TopUpInit: ...

    @abstractmethod
    async def register_method(self, *, confirmation_token: str) -> RegisteredMethod: ...

    @abstractmethod
    async def charge_method(
        self,
        *,
        token: str,
        amount_cents: int,
        currency: str,
        idempotency_key: str | None,
    ) -> ChargeResult: ...

    @abstractmethod
    def verify_webhook(self, *, payload: bytes, signature: str) -> dict[str, Any]: ...

    @abstractmethod
    def parse_event(self, event: dict[str, Any]) -> NormalizedEvent: ...
