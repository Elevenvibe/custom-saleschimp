"""Paystack — opt-in second provider, primarily for NG.

Paystack's flow is different from Stripe's:
  - top-up = `transaction/initialize` returns an `authorization_url`
    the customer redirects to (no client-side SDK like Elements)
  - on successful payment Paystack POSTs a `charge.success` webhook
  - subsequent charges reuse the `authorization_code` from that webhook
    via `transaction/charge_authorization`

Webhook signature is HMAC-SHA512 of the raw body with the secret key.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from typing import Any

import httpx
import structlog

from app.payments import config_service
from app.payments.adapters.base import (
    BillingProvider,
    ChargeResult,
    NormalizedEvent,
    ProviderError,
    RegisteredMethod,
    TopUpInit,
)

log = structlog.get_logger()

_API = "https://api.paystack.co"


class PaystackAdapter(BillingProvider):
    slug = "paystack"

    def is_configured(self) -> bool:
        cfg = config_service.get_sync("paystack")
        return bool(cfg and cfg.secret_key)

    async def _resolved(self):
        cfg = await config_service.get("paystack")
        if cfg is None or not cfg.secret_key:
            raise ProviderError("paystack secret key not configured")
        return cfg

    def _headers(self, secret_key: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {secret_key}",
            "Content-Type": "application/json",
        }

    async def _post(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        cfg = await self._resolved()
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(f"{_API}{path}", json=params, headers=self._headers(cfg.secret_key))
        body = resp.json() if resp.content else {}
        if resp.status_code >= 400 or not body.get("status", True):
            raise ProviderError(f"paystack: {body.get('message', resp.status_code)}")
        return body.get("data") or body

    async def create_topup(
        self,
        *,
        tenant_id: int,
        amount_cents: int,
        currency: str,
        idempotency_key: str | None,
        payment_method_token: str | None = None,
    ) -> TopUpInit:
        # Paystack uses an arbitrary `email` (not a real account ref).
        # We synthesize one — the customer email gets passed via metadata
        # from the route layer if known; here we just need any valid string.
        reference = idempotency_key or secrets.token_urlsafe(16)
        if payment_method_token:
            data = await self._post(
                "/transaction/charge_authorization",
                {
                    "authorization_code": payment_method_token,
                    "amount": amount_cents,
                    "currency": currency.upper(),
                    "email": f"tenant-{tenant_id}@charge.invalid",
                    "reference": reference,
                    "metadata": {"tenant_id": tenant_id, "kind": "wallet_auto_reload"},
                },
            )
            return TopUpInit(
                provider_ref=data["reference"],
                client_secret=None,
                authorization_url=None,
                raw=data,
            )
        data = await self._post(
            "/transaction/initialize",
            {
                "amount": amount_cents,
                "currency": currency.upper(),
                "email": f"tenant-{tenant_id}@topup.invalid",
                "reference": reference,
                "metadata": {"tenant_id": tenant_id, "kind": "wallet_topup"},
            },
        )
        return TopUpInit(
            provider_ref=data["reference"],
            client_secret=None,
            authorization_url=data.get("authorization_url"),
            raw=data,
        )

    async def register_method(self, *, confirmation_token: str) -> RegisteredMethod:
        """For Paystack the "confirmation_token" is a transaction
        reference whose charge.success webhook already fired. Verify
        the transaction and pull the authorization_code from it."""
        cfg = await self._resolved()
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{_API}/transaction/verify/{confirmation_token}",
                headers=self._headers(cfg.secret_key),
            )
        body = resp.json() if resp.content else {}
        if resp.status_code >= 400 or not body.get("status"):
            raise ProviderError(f"paystack: cannot verify transaction {confirmation_token}")
        data = body.get("data") or {}
        auth = data.get("authorization") or {}
        if not auth.get("reusable"):
            raise ProviderError("paystack: authorization not reusable")
        return RegisteredMethod(
            token=auth["authorization_code"],
            brand=auth.get("card_type"),
            last4=auth.get("last4"),
            exp_month=int(auth["exp_month"]) if auth.get("exp_month") else None,
            exp_year=int(auth["exp_year"]) if auth.get("exp_year") else None,
            raw=auth,
        )

    async def charge_method(
        self,
        *,
        token: str,
        amount_cents: int,
        currency: str,
        idempotency_key: str | None,
    ) -> ChargeResult:
        try:
            init = await self.create_topup(
                tenant_id=0,
                amount_cents=amount_cents,
                currency=currency,
                idempotency_key=idempotency_key,
                payment_method_token=token,
            )
        except ProviderError as e:
            return ChargeResult(provider_ref="", status="failed", raw={}, error=str(e))
        status_raw = init.raw.get("status")
        status: str = "succeeded" if status_raw == "success" else "pending"
        return ChargeResult(
            provider_ref=init.provider_ref,
            status=status,  # type: ignore[arg-type]
            raw=init.raw,
        )

    def verify_webhook(self, *, payload: bytes, signature: str) -> dict[str, Any]:
        cfg = config_service.get_sync("paystack")
        secret = cfg.secret_key if cfg else ""
        if not secret:
            raise ProviderError("paystack secret key not configured")
        expected = hmac.new(secret.encode(), payload, hashlib.sha512).hexdigest()
        if not hmac.compare_digest(expected, signature.strip()):
            raise ProviderError("paystack webhook: signature mismatch")
        try:
            return json.loads(payload)
        except json.JSONDecodeError as e:
            raise ProviderError(f"paystack webhook: invalid json: {e}") from None

    def parse_event(self, event: dict[str, Any]) -> NormalizedEvent:
        etype = event.get("event", "")
        data = event.get("data") or {}
        if etype == "charge.success":
            return NormalizedEvent(
                kind="topup.succeeded",
                provider_ref=data.get("reference"),
                amount_cents=int(data.get("amount") or 0),
                currency=(data.get("currency") or "USD").upper(),
                raw=event,
            )
        if etype in {"charge.failed", "transaction.failed"}:
            return NormalizedEvent(
                kind="topup.failed",
                provider_ref=data.get("reference"),
                amount_cents=int(data.get("amount") or 0),
                currency=(data.get("currency") or "USD").upper(),
                raw=event,
            )
        if etype == "refund.processed":
            return NormalizedEvent(
                kind="topup.refunded",
                provider_ref=data.get("transaction", {}).get("reference"),
                amount_cents=int(data.get("amount") or 0),
                currency=(data.get("currency") or "USD").upper(),
                raw=event,
            )
        return NormalizedEvent(kind="ignored", provider_ref=None, amount_cents=None, currency=None, raw=event)
