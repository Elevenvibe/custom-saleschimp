"""CouponService — validate + redeem a code.

Redemption is idempotent per (coupon, tenant): the unique constraint
on coupon_redemptions catches the second attempt and we surface a
clear `CouponAlreadyRedeemed` instead of an IntegrityError.

Value resolution:
  - `fixed_micros` → credit `min(value_micros, top_up_amount)`. When
    redeemed standalone (no top-up context), we credit `value_micros`.
  - `percentage`   → only meaningful with a top-up amount; we treat
    `value_micros` as basis points * 1000 (so 100_000 = 10%) and
    credit `top_up * value_micros / 1_000_000`.

Scope:
  - `global`  → any tenant
  - `package` → tenant must currently be on `scope_value` package slug
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import structlog
from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.wallet import service as wallet_service
from app.wallet.models import Coupon, CouponRedemption

log = structlog.get_logger()


class CouponNotFound(Exception):
    pass


class CouponInvalid(Exception):
    """Active=false, expired, max_uses hit, or scope mismatch."""


class CouponAlreadyRedeemed(Exception):
    pass


@dataclass(slots=True)
class RedemptionResult:
    coupon_id: int
    value_applied_micros: int
    ledger_id: int


async def _resolve_value(
    coupon: Coupon, top_up_micros: int | None
) -> int:
    if coupon.kind == "fixed_micros":
        return (
            min(coupon.value_micros, top_up_micros)
            if top_up_micros is not None
            else coupon.value_micros
        )
    if coupon.kind == "percentage":
        if top_up_micros is None or top_up_micros <= 0:
            # Percentage coupon redeemed without a top-up amount → no
            # base to multiply against. Surface that as invalid rather
            # than silently giving them 0.
            raise CouponInvalid("percentage coupons require a top-up amount")
        # value_micros is bp*1000; 1_000_000 micros == 100%.
        return (top_up_micros * coupon.value_micros) // 1_000_000
    raise CouponInvalid(f"unknown coupon kind {coupon.kind!r}")


async def redeem(
    session: AsyncSession,
    *,
    code: str,
    tenant_id: int,
    top_up_micros: int | None = None,
    current_package_slug: str | None = None,
) -> RedemptionResult:
    coupon = (
        await session.execute(select(Coupon).where(Coupon.code == code))
    ).scalar_one_or_none()
    if coupon is None:
        raise CouponNotFound(code)
    if not coupon.active:
        raise CouponInvalid("coupon is not active")
    if coupon.expires_at and coupon.expires_at < datetime.now(timezone.utc):
        raise CouponInvalid("coupon has expired")
    if coupon.max_uses is not None and coupon.uses_count >= coupon.max_uses:
        raise CouponInvalid("coupon has reached its usage limit")
    if coupon.scope_kind == "package":
        if current_package_slug != coupon.scope_value:
            raise CouponInvalid("coupon is restricted to a different package")

    value_micros = await _resolve_value(coupon, top_up_micros)
    if value_micros <= 0:
        raise CouponInvalid("coupon resolves to zero value")

    # Bump uses_count first via a conditional UPDATE so two concurrent
    # redemptions can't blow past max_uses. The unique constraint on
    # (coupon_id, tenant_id) catches double-redemption by the same tenant.
    result = await session.execute(
        text(
            """
            UPDATE coupons
            SET uses_count = uses_count + 1
            WHERE id = :cid
              AND (max_uses IS NULL OR uses_count < max_uses)
            """
        ),
        {"cid": coupon.id},
    )
    if result.rowcount == 0:
        raise CouponInvalid("coupon has reached its usage limit")

    entry = await wallet_service.credit(
        session,
        tenant_id,
        value_micros,
        reason="coupon",
        ref_kind="coupon",
        ref_id=str(coupon.id),
        notes=f"coupon {coupon.code}",
    )

    redemption = CouponRedemption(
        coupon_id=coupon.id,
        tenant_id=tenant_id,
        value_applied_micros=value_micros,
        ledger_id=entry.id,
    )
    session.add(redemption)
    try:
        await session.flush()
    except IntegrityError:
        # Same tenant already redeemed this code. Roll back the
        # uses_count bump + the wallet credit by raising — the route's
        # surrounding session handles rollback.
        await session.rollback()
        raise CouponAlreadyRedeemed(code) from None

    log.info(
        "coupon.redeemed",
        code=code,
        tenant_id=tenant_id,
        value_applied_micros=value_micros,
    )
    return RedemptionResult(
        coupon_id=coupon.id,
        value_applied_micros=value_micros,
        ledger_id=entry.id,
    )
