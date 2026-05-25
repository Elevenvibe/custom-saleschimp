"""Cost calculator.

Takes a list of provider-unit usages (e.g. "OpenAI gpt-4o · 1500 tokens",
"ElevenLabs · 42s of TTS", "Twilio · 1.7 minutes of carrier") and a tenant
context, and returns:

    raw_cost_micros     — sum of provider costs without markup
    markup_micros       — what we add on top
    billed_cost_micros  — what we'd charge the wallet
    breakdown           — per-line itemization

Money is in micros throughout. Caller decides whether to convert to cents
for display, persist to usage_records, or debit the wallet.

This module is intentionally pure: no DB writes, no FastAPI. Pricing-policy
changes belong here; persistence happens in caller code.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Iterable, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing.models import CostProvider, CostProviderPrice, MarkupRule

MICROS_PER_UNIT = 1_000_000
ProviderKind = Literal["llm", "tts", "stt", "embedding", "telephony"]


@dataclass
class UsageItem:
    """One slice of usage to price.

    Provide either `provider_slug` (preferred) or `provider_id`. `quantity`
    is in the unit declared by the matching price row (tokens, characters,
    minutes, calls, requests, or 1k-multiples thereof).
    """

    provider_slug: str | None
    quantity: Decimal | float | int
    unit: str
    variant: str | None = None
    provider_id: int | None = None


@dataclass
class CostLine:
    provider_slug: str
    provider_kind: str
    variant: str | None
    unit: str
    quantity: Decimal
    unit_price_micros: int
    raw_cost_micros: int


@dataclass
class CostBreakdown:
    raw_cost_micros: int = 0
    markup_micros: int = 0
    billed_cost_micros: int = 0
    currency: str = "USD"
    lines: list[CostLine] = field(default_factory=list)
    markup_rule_id: int | None = None
    unpriced: list[str] = field(default_factory=list)  # items we couldn't price


class PricingError(Exception):
    pass


async def price_usage(
    session: AsyncSession,
    items: Iterable[UsageItem],
    *,
    tenant_id: int | None = None,
    currency: str = "USD",
) -> CostBreakdown:
    """Score every line, then apply the resolved markup once."""
    breakdown = CostBreakdown(currency=currency)

    for item in items:
        line = await _price_one(session, item, currency=currency)
        if line is None:
            breakdown.unpriced.append(
                f"{item.provider_slug or item.provider_id}:{item.unit}:{item.variant or '-'}"
            )
            continue
        breakdown.lines.append(line)
        breakdown.raw_cost_micros += line.raw_cost_micros

    rule = await _resolve_markup(session, tenant_id=tenant_id, currency=currency)
    if rule is not None:
        breakdown.markup_rule_id = rule.id
        breakdown.markup_micros = _apply_markup(
            breakdown.raw_cost_micros,
            rule,
            total_minutes=_sum_minutes(breakdown.lines),
        )

    breakdown.billed_cost_micros = breakdown.raw_cost_micros + breakdown.markup_micros
    return breakdown


# --- internals ------------------------------------------------------------


async def _price_one(
    session: AsyncSession, item: UsageItem, *, currency: str
) -> CostLine | None:
    # Find the provider
    if item.provider_id is not None:
        provider = await session.get(CostProvider, item.provider_id)
    elif item.provider_slug:
        provider = (
            await session.execute(
                select(CostProvider).where(CostProvider.slug == item.provider_slug)
            )
        ).scalar_one_or_none()
    else:
        return None
    if provider is None or not provider.active:
        return None

    # Find the most recently-effective price for (provider, unit, variant, currency).
    stmt = (
        select(CostProviderPrice)
        .where(CostProviderPrice.cost_provider_id == provider.id)
        .where(CostProviderPrice.unit == item.unit)
        .where(CostProviderPrice.currency == currency)
        .order_by(CostProviderPrice.effective_at.desc())
    )
    if item.variant is not None:
        stmt = stmt.where(CostProviderPrice.variant == item.variant)
    else:
        stmt = stmt.where(CostProviderPrice.variant.is_(None))
    price = (await session.execute(stmt.limit(1))).scalar_one_or_none()
    if price is None:
        return None

    qty = Decimal(str(item.quantity))
    raw = int((Decimal(price.price_micros) * qty).quantize(Decimal("1")))

    return CostLine(
        provider_slug=provider.slug,
        provider_kind=provider.kind,
        variant=price.variant,
        unit=price.unit,
        quantity=qty,
        unit_price_micros=price.price_micros,
        raw_cost_micros=raw,
    )


async def _resolve_markup(
    session: AsyncSession,
    *,
    tenant_id: int | None,
    currency: str,
) -> MarkupRule | None:
    # 1. tenant-scoped
    if tenant_id is not None:
        r = await _find_rule(session, "tenant", str(tenant_id), currency=currency)
        if r:
            return r
    # 2. global (kind-scoped resolution happens per-line, see _apply_markup)
    return await _find_rule(session, "global", None, currency=currency)


async def _find_rule(
    session: AsyncSession,
    scope_kind: str,
    scope_value: str | None,
    *,
    currency: str,
) -> MarkupRule | None:
    stmt = (
        select(MarkupRule)
        .where(MarkupRule.scope_kind == scope_kind)
        .where(MarkupRule.active.is_(True))
        .where(MarkupRule.currency == currency)
        .order_by(MarkupRule.priority.desc())
    )
    if scope_value is None:
        stmt = stmt.where(MarkupRule.scope_value.is_(None))
    else:
        stmt = stmt.where(MarkupRule.scope_value == scope_value)
    return (await session.execute(stmt.limit(1))).scalar_one_or_none()


def _apply_markup(raw_micros: int, rule: MarkupRule, *, total_minutes: Decimal) -> int:
    if rule.markup_kind == "percentage":
        # value_micros is the markup percent in micros: 25_000_000 = 25%.
        return int(Decimal(raw_micros) * Decimal(rule.value_micros) / Decimal(100 * MICROS_PER_UNIT))
    if rule.markup_kind == "fixed_per_minute":
        return int(Decimal(rule.value_micros) * total_minutes)
    if rule.markup_kind == "fixed_per_unit":
        return rule.value_micros
    raise PricingError(f"unknown markup_kind: {rule.markup_kind}")


def _sum_minutes(lines: list[CostLine]) -> Decimal:
    total = Decimal(0)
    for line in lines:
        if line.unit == "per_minute":
            total += line.quantity
    return total
