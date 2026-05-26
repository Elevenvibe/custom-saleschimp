"""Adapter registry. Stripe is the default; Paystack is opt-in.

`get_provider(slug)` returns the singleton adapter or raises
`UnknownProvider`. The slug column on payment_methods / payment_intents
matches the keys here.
"""

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


def list_configured() -> list[dict[str, bool | str]]:
    """Used by the customer app to render only the providers that are
    actually usable in this deployment (i.e. their secret env var is set).
    Stripe is listed first so the UI picks it as default."""
    return [
        {
            "slug": slug,
            "configured": adapter.is_configured(),
            "is_default": slug == DEFAULT_PROVIDER,
        }
        for slug, adapter in _REGISTRY.items()
    ]


__all__ = [
    "BillingProvider",
    "ProviderError",
    "UnknownProvider",
    "get_provider",
    "list_configured",
    "DEFAULT_PROVIDER",
]
