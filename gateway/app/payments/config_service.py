"""Runtime payment-provider config resolver.

Adapters call `get(slug)` instead of reading `settings.<provider>_*`
directly. The resolver:
  1. checks an in-process TTL cache,
  2. on miss, queries `payment_provider_configs` for an active row,
  3. on still-miss, falls back to env vars from app.config.settings.

Cache TTL is short (30s by default) so an admin saving new keys via
the UI takes effect on the next charge without a process restart, and
without a Redis pub/sub fan-out (we're single-worker on compose).

Writes go through `upsert()` which encrypts the secrets dict and
invalidates the cache immediately.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Literal

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import SessionLocal
from app.email.crypto import decrypt_dict, encrypt_dict
from app.payments.config_models import PaymentProviderConfig

log = structlog.get_logger()

ProviderSlug = Literal["stripe", "paystack"]

_CACHE_TTL_SECONDS = 30


@dataclass(slots=True)
class ResolvedConfig:
    """What the adapters actually need. Public keys are surfaced so the
    UI can render the publishable key without re-decrypting."""

    secret_key: str
    publishable_key: str
    webhook_secret: str
    source: Literal["db", "env"]


_cache: dict[str, tuple[float, ResolvedConfig | None]] = {}


def _from_env(slug: ProviderSlug) -> ResolvedConfig | None:
    if slug == "stripe":
        if not settings.stripe_secret_key:
            return None
        return ResolvedConfig(
            secret_key=settings.stripe_secret_key,
            publishable_key=settings.stripe_publishable_key,
            webhook_secret=settings.stripe_webhook_secret,
            source="env",
        )
    if slug == "paystack":
        if not settings.paystack_secret_key:
            return None
        return ResolvedConfig(
            secret_key=settings.paystack_secret_key,
            publishable_key=settings.paystack_public_key,
            webhook_secret=settings.paystack_secret_key,
            source="env",
        )
    return None


async def _from_db(slug: ProviderSlug) -> ResolvedConfig | None:
    async with SessionLocal() as session:
        row = (
            await session.execute(
                select(PaymentProviderConfig).where(
                    PaymentProviderConfig.provider == slug,
                    PaymentProviderConfig.active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if row is None:
            return None
        raw = decrypt_dict(row.secrets_encrypted)
    return ResolvedConfig(
        secret_key=str(raw.get("secret_key") or ""),
        publishable_key=str(raw.get("publishable_key") or ""),
        webhook_secret=str(raw.get("webhook_secret") or ""),
        source="db",
    )


async def get(slug: ProviderSlug) -> ResolvedConfig | None:
    """Cached resolver. Returns None when the provider isn't configured
    in either source. Adapters short-circuit on None with their existing
    "not configured" error path."""
    cached = _cache.get(slug)
    now = time.time()
    if cached and now - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]
    resolved = await _from_db(slug)
    if resolved is None:
        resolved = _from_env(slug)
    _cache[slug] = (now, resolved)
    return resolved


def invalidate(slug: ProviderSlug | None = None) -> None:
    """Drop the cache entry so the next get() re-reads. Called by the
    admin upsert/delete endpoints."""
    if slug is None:
        _cache.clear()
    else:
        _cache.pop(slug, None)


def get_sync(slug: ProviderSlug) -> ResolvedConfig | None:
    """Sync read for the adapter's `is_configured()` boolean check.

    is_configured() is called from synchronous code (e.g. the webhook
    verify path that needs to short-circuit before awaiting), so we
    can't await the DB. We accept a stale cache here — once the cache
    is warm from any prior get() call, we read it; otherwise fall back
    to env vars. The cost is one extra "not configured" 503 after the
    very first admin save, until the next async path warms the cache.
    """
    cached = _cache.get(slug)
    if cached and time.time() - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]
    return _from_env(slug)  # type: ignore[arg-type]


async def upsert(
    session: AsyncSession,
    *,
    provider: ProviderSlug,
    secret_key: str,
    publishable_key: str,
    webhook_secret: str,
    active: bool = True,
    notes: str | None = None,
) -> PaymentProviderConfig:
    row = (
        await session.execute(
            select(PaymentProviderConfig).where(
                PaymentProviderConfig.provider == provider
            )
        )
    ).scalar_one_or_none()
    encrypted = encrypt_dict(
        {
            "secret_key": secret_key,
            "publishable_key": publishable_key,
            "webhook_secret": webhook_secret,
        }
    )
    if row is None:
        row = PaymentProviderConfig(
            provider=provider,
            secrets_encrypted=encrypted,
            active=active,
            notes=notes,
        )
        session.add(row)
    else:
        row.secrets_encrypted = encrypted
        row.active = active
        row.notes = notes
    await session.flush()
    invalidate(provider)
    log.info("payment_config.upserted", provider=provider, active=active)
    return row


async def delete(session: AsyncSession, *, provider: ProviderSlug) -> bool:
    row = (
        await session.execute(
            select(PaymentProviderConfig).where(
                PaymentProviderConfig.provider == provider
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return False
    await session.delete(row)
    invalidate(provider)
    log.info("payment_config.deleted", provider=provider)
    return True


async def status_for(provider: ProviderSlug) -> dict[str, object]:
    """Read-only view for the admin Settings page — never returns the
    secret itself, only enough to render 'configured / source / has
    publishable key / has webhook secret'."""
    resolved = await get(provider)
    if resolved is None:
        return {
            "provider": provider,
            "configured": False,
            "source": None,
            "publishable_key": "",
            "has_webhook_secret": False,
            "secret_key_last4": None,
        }
    return {
        "provider": provider,
        "configured": True,
        "source": resolved.source,
        # Publishable / public keys are not secret — surface them so
        # the customer UI can pick them up via the existing /providers
        # endpoint without each admin pasting them into a second place.
        "publishable_key": resolved.publishable_key,
        "has_webhook_secret": bool(resolved.webhook_secret),
        # Tail of the secret key so the admin can sanity-check what's
        # stored without us ever round-tripping the full secret.
        "secret_key_last4": resolved.secret_key[-4:] if resolved.secret_key else None,
    }
