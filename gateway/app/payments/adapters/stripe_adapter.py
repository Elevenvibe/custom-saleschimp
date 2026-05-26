"""Stripe — the default provider.

We talk to Stripe's REST API directly via httpx instead of the official
SDK. The SDK is fine but pinning it locks us to a Python release window,
and we only need ~five endpoints: payment_intents, setup_intents,
payment_methods.retrieve, refunds, and the webhook signature check.

Webhook signature verification follows the algorithm from Stripe's docs:
take `<timestamp>.<payload>`, HMAC-SHA256 with the endpoint secret,
compare against the `v1` signatures in the `Stripe-Signature` header.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any
from urllib.parse import urlencode

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

_API = "https://api.stripe.com/v1"
_WEBHOOK_TOLERANCE_SECONDS = 5 * 60


def _flatten(prefix: str, value: Any, out: dict[str, str]) -> None:
    """Stripe wants form-encoded `metadata[key]=value`. We don't need full
    nesting — just one level deep for `metadata` is enough today."""
    if isinstance(value, dict):
        for k, v in value.items():
            _flatten(f"{prefix}[{k}]" if prefix else k, v, out)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            _flatten(f"{prefix}[{i}]", v, out)
    else:
        out[prefix] = "" if value is None else str(value)


def _form(params: dict[str, Any]) -> str:
    flat: dict[str, str] = {}
    for k, v in params.items():
        _flatten(k, v, flat)
    return urlencode(flat)


class StripeAdapter(BillingProvider):
    slug = "stripe"

    def is_configured(self) -> bool:
        # Sync check — used by route short-circuits and the public
        # /providers listing. Reads cached config + env fallback.
        cfg = config_service.get_sync("stripe")
        return bool(cfg and cfg.secret_key)

    async def _resolved(self):
        cfg = await config_service.get("stripe")
        if cfg is None or not cfg.secret_key:
            raise ProviderError("stripe secret key not configured")
        return cfg

    def _headers(self, secret_key: str, idempotency_key: str | None = None) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {secret_key}",
            "Content-Type": "application/x-www-form-urlencoded",
        }
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    async def _post(
        self, path: str, params: dict[str, Any], idempotency_key: str | None = None
    ) -> dict[str, Any]:
        cfg = await self._resolved()
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{_API}{path}",
                content=_form(params),
                headers=self._headers(cfg.secret_key, idempotency_key),
            )
        body = resp.json() if resp.content else {}
        if resp.status_code >= 400:
            err = body.get("error", {}).get("message", f"http {resp.status_code}")
            raise ProviderError(f"stripe: {err}")
        return body

    async def create_topup(
        self,
        *,
        tenant_id: int,
        amount_cents: int,
        currency: str,
        idempotency_key: str | None,
        payment_method_token: str | None = None,
    ) -> TopUpInit:
        params: dict[str, Any] = {
            "amount": amount_cents,
            "currency": currency.lower(),
            "automatic_payment_methods[enabled]": "true",
            "metadata": {"tenant_id": str(tenant_id), "kind": "wallet_topup"},
        }
        if payment_method_token:
            # Off-session charge using a stored method — auto-reload path.
            params["payment_method"] = payment_method_token
            params["confirm"] = "true"
            params["off_session"] = "true"
            # automatic_payment_methods + confirm requires us to drop
            # the redirect handling so off-session card charges work.
            params["automatic_payment_methods[allow_redirects]"] = "never"
        body = await self._post("/payment_intents", params, idempotency_key)
        return TopUpInit(
            provider_ref=body["id"],
            client_secret=body.get("client_secret"),
            authorization_url=None,
            raw=body,
        )

    async def create_setup_intent(self, *, tenant_id: int) -> dict[str, Any]:
        """Mint a SetupIntent so the client can collect + save a card
        without charging it. The customer app passes the returned
        `client_secret` to Stripe Elements; on confirm Stripe gives
        them a `payment_method` id which they POST back to
        /api/tenant/payment-methods for storage.
        """
        body = await self._post(
            "/setup_intents",
            {
                "usage": "off_session",
                "automatic_payment_methods[enabled]": "true",
                "metadata": {"tenant_id": str(tenant_id), "kind": "wallet_setup"},
            },
            idempotency_key=None,
        )
        return {
            "client_secret": body.get("client_secret"),
            "id": body.get("id"),
        }

    async def register_method(self, *, confirmation_token: str) -> RegisteredMethod:
        """`confirmation_token` is the Stripe payment_method id the client
        SDK confirmed (via SetupIntent or PaymentIntent). We fetch the
        full object so we can store brand/last4 for the UI."""
        cfg = await self._resolved()
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{_API}/payment_methods/{confirmation_token}",
                headers=self._headers(cfg.secret_key),
            )
        if resp.status_code >= 400:
            raise ProviderError(f"stripe: cannot fetch payment_method {resp.status_code}")
        body = resp.json()
        card = body.get("card") or {}
        return RegisteredMethod(
            token=body["id"],
            brand=card.get("brand"),
            last4=card.get("last4"),
            exp_month=card.get("exp_month"),
            exp_year=card.get("exp_year"),
            raw=body,
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
                tenant_id=0,  # metadata-only — wallet logic supplies the real one upstream
                amount_cents=amount_cents,
                currency=currency,
                idempotency_key=idempotency_key,
                payment_method_token=token,
            )
        except ProviderError as e:
            return ChargeResult(
                provider_ref="",
                status="failed",
                raw={},
                error=str(e),
            )
        status_raw = init.raw.get("status", "")
        status: str = (
            "succeeded" if status_raw == "succeeded"
            else "pending" if status_raw in {"processing", "requires_action"}
            else "failed"
        )
        return ChargeResult(
            provider_ref=init.provider_ref,
            status=status,  # type: ignore[arg-type]
            raw=init.raw,
            error=None if status != "failed" else init.raw.get("last_payment_error", {}).get("message"),
        )

    def verify_webhook(self, *, payload: bytes, signature: str) -> dict[str, Any]:
        # Webhook handlers are sync-by-design (FastAPI route awaits the
        # body, then hands the raw bytes off to us). Use the cached
        # config + env fallback — see config_service.get_sync.
        cfg = config_service.get_sync("stripe")
        secret = cfg.webhook_secret if cfg else ""
        if not secret:
            raise ProviderError("stripe webhook secret not configured")

        # Header shape: "t=<ts>,v1=<sig>,v0=<sig>" — comma-separated kv pairs.
        parts = {kv.split("=", 1)[0]: kv.split("=", 1)[1] for kv in signature.split(",") if "=" in kv}
        try:
            ts = int(parts["t"])
        except (KeyError, ValueError):
            raise ProviderError("stripe webhook: malformed signature header") from None
        if abs(time.time() - ts) > _WEBHOOK_TOLERANCE_SECONDS:
            raise ProviderError("stripe webhook: timestamp outside tolerance")

        signed = f"{ts}.".encode() + payload
        expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
        # Accept any v1 signature — Stripe may include multiple during rotation.
        v1_sigs = [v for k, v in parts.items() if k == "v1"]
        if not any(hmac.compare_digest(expected, sig) for sig in v1_sigs):
            raise ProviderError("stripe webhook: signature mismatch")
        try:
            return json.loads(payload)
        except json.JSONDecodeError as e:
            raise ProviderError(f"stripe webhook: invalid json: {e}") from None

    def parse_event(self, event: dict[str, Any]) -> NormalizedEvent:
        etype = event.get("type", "")
        obj = (event.get("data") or {}).get("object") or {}
        if etype == "payment_intent.succeeded":
            return NormalizedEvent(
                kind="topup.succeeded",
                provider_ref=obj.get("id"),
                amount_cents=int(obj.get("amount_received") or obj.get("amount") or 0),
                currency=(obj.get("currency") or "usd").upper(),
                raw=event,
            )
        if etype == "payment_intent.payment_failed":
            return NormalizedEvent(
                kind="topup.failed",
                provider_ref=obj.get("id"),
                amount_cents=int(obj.get("amount") or 0),
                currency=(obj.get("currency") or "usd").upper(),
                raw=event,
            )
        if etype == "charge.refunded":
            pi = obj.get("payment_intent")
            return NormalizedEvent(
                kind="topup.refunded",
                provider_ref=pi if isinstance(pi, str) else None,
                amount_cents=int(obj.get("amount_refunded") or 0),
                currency=(obj.get("currency") or "usd").upper(),
                raw=event,
            )
        return NormalizedEvent(kind="ignored", provider_ref=None, amount_cents=None, currency=None, raw=event)
