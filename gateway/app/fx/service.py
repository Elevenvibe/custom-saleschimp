"""FX rate lookups + conversion.

All conversion is integer math in micros so we never lose precision.
Cache TTL is short (60s) because admin overrides should propagate
quickly, and a hot path that resolves a rate per call is fine — the
table is tiny.

When no direct rate exists, we try the inverse (NGN→USD via 1/USD→NGN)
before giving up. We deliberately don't synthesize transitive rates
(USD→NGN→GBP) — that's a feature the admin can solve with explicit
manual entries when they need a non-USD base.
"""

from __future__ import annotations

import time
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.fx.models import FxRate

log = structlog.get_logger()

_CACHE_TTL_SECONDS = 60
_cache: dict[tuple[str, str], tuple[float, int | None]] = {}

MICROS_PER_UNIT = 1_000_000


class RateNotFound(Exception):
    pass


def invalidate() -> None:
    _cache.clear()


async def get_rate_micros(base: str, quote: str) -> int:
    """Return micros-per-1-base. Identity for same currency."""
    base = base.upper()
    quote = quote.upper()
    if base == quote:
        return MICROS_PER_UNIT

    key = (base, quote)
    cached = _cache.get(key)
    now = time.time()
    if cached and now - cached[0] < _CACHE_TTL_SECONDS:
        if cached[1] is None:
            raise RateNotFound(f"{base}->{quote}")
        return cached[1]

    async with SessionLocal() as session:
        row = (
            await session.execute(
                select(FxRate.rate_micros).where(
                    FxRate.base_currency == base, FxRate.quote_currency == quote
                )
            )
        ).scalar_one_or_none()
        if row is not None:
            _cache[key] = (now, int(row))
            return int(row)

        # Try the inverse.
        inv = (
            await session.execute(
                select(FxRate.rate_micros).where(
                    FxRate.base_currency == quote, FxRate.quote_currency == base
                )
            )
        ).scalar_one_or_none()
        if inv is not None and int(inv) > 0:
            # rate_b->a = 1 / rate_a->b. Compute via micros: stored is
            # quote-micros per 1 base, so the inverse is base-micros per
            # 1 quote = (1e12 / stored). The 1e12 keeps precision: we
            # multiply micros by another 1e6 before dividing.
            result = (MICROS_PER_UNIT * MICROS_PER_UNIT) // int(inv)
            _cache[key] = (now, result)
            return result

    _cache[key] = (now, None)
    raise RateNotFound(f"{base}->{quote}")


async def convert(amount_micros: int, *, frm: str, to: str) -> int:
    """Convert `amount_micros` denominated in `frm` to micros in `to`.

    Same-currency: identity. Cross-currency: amount * rate / 1_000_000.
    """
    if frm.upper() == to.upper():
        return amount_micros
    rate = await get_rate_micros(frm, to)
    return (amount_micros * rate) // MICROS_PER_UNIT


async def upsert_rate(
    session: AsyncSession,
    *,
    base: str,
    quote: str,
    rate_micros: int,
    source: str = "manual",
) -> FxRate:
    if rate_micros <= 0:
        raise ValueError("rate_micros must be positive")
    base = base.upper()
    quote = quote.upper()
    row = (
        await session.execute(
            select(FxRate).where(
                FxRate.base_currency == base, FxRate.quote_currency == quote
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = FxRate(
            base_currency=base,
            quote_currency=quote,
            rate_micros=rate_micros,
            source=source,
        )
        session.add(row)
        try:
            await session.flush()
        except IntegrityError:
            await session.rollback()
            raise
    else:
        row.rate_micros = rate_micros
        row.source = source
        await session.flush()
    invalidate()
    log.info(
        "fx.upserted",
        base=base,
        quote=quote,
        rate_micros=rate_micros,
        source=source,
    )
    return row


async def list_rates(session: AsyncSession) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(FxRate).order_by(FxRate.base_currency, FxRate.quote_currency)
        )
    ).scalars().all()
    return [
        {
            "id": r.id,
            "base_currency": r.base_currency,
            "quote_currency": r.quote_currency,
            "rate_micros": r.rate_micros,
            "source": r.source,
            "fetched_at": r.fetched_at.isoformat(),
        }
        for r in rows
    ]


async def delete_rate(session: AsyncSession, *, base: str, quote: str) -> bool:
    row = (
        await session.execute(
            select(FxRate).where(
                FxRate.base_currency == base.upper(),
                FxRate.quote_currency == quote.upper(),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return False
    await session.delete(row)
    invalidate()
    return True
