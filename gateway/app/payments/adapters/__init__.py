"""Adapter registry. Stripe is the default; Paystack is opt-in.

`get_provider(slug)` returns the singleton adapter or raises
`UnknownProvider`. The slug column on payment_methods / payment_intents
matches the keys here.
"""

from app.payments import config_service
from app.payments.adapters.base import BillingProvider, ProviderError
from app.payments.adapters.paystack import PaystackAdapter
from app.payments.adapters.stripe_adapter import StripeAdapter

_REGISTRY: dict[str, BillingProvider] = {
    "stripe": StripeAdapter(),
    "paystack": PaystackAdapter(),
}

DEFAULT_PROVIDER = "stripe"


class UnknownProvider(Exception):
    pass


def get_provider(slug: str) -> BillingProvider:
    if slug not in _REGISTRY:
        raise UnknownProvider(slug)
    return _REGISTRY[slug]


async def list_configured() -> list[dict[str, bool | str]]:
    """Used by the customer app to render only the providers that are
    actually usable in this deployment.

    Async now so we can look up the publishable key from the config
    resolver (DB → env fallback) — Stripe Elements / Paystack inline
    both need their public key in the browser, and this endpoint is the
    single source of truth for it.
    """
    out: list[dict[str, bool | str]] = []
    for slug in _REGISTRY.keys():
        cfg = await config_service.get(slug)  # type: ignore[arg-type]
        configured = cfg is not None and bool(cfg.secret_key)
        out.append(
            {
                "slug": slug,
                "configured": configured,
                "is_default": slug == DEFAULT_PROVIDER,
                # Public — safe to ship to the browser.
                "publishable_key": (cfg.publishable_key if (configured and cfg) else ""),
            }
        )
    return out


__all__ = [
    "BillingProvider",
    "ProviderError",
    "UnknownProvider",
    "get_provider",
    "list_configured",
    "DEFAULT_PROVIDER",
]
