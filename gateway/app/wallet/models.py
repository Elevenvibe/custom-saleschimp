"""Wallet, ledger, usage records, coupons.

Every balance change MUST go through `WalletService` so it lands a
`WalletLedger` row in the same transaction — never UPDATE wallets.balance
directly from a route. The service-layer rule keeps the audit chain
tight and is what `/wallet/ledger` reads.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Wallet(Base):
    __tablename__ = "wallets"

    tenant_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    balance_micros: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    currency: Mapped[str] = mapped_column(String(8), nullable=False, server_default="USD")
    # Strict no-negative by default; admins can raise per tenant.
    credit_limit_micros: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    auto_reload_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    auto_reload_threshold_micros: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    auto_reload_amount_micros: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    # FK to payment_methods lands in 0008 — keep nullable + no FK constraint here.
    auto_reload_payment_method_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WalletLedger(Base):
    __tablename__ = "wallet_ledger"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("wallets.tenant_id", ondelete="CASCADE"), nullable=False
    )
    # Signed delta — positive credits the tenant, negative charges.
    delta_micros: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # Stored alongside the delta so the ledger is self-contained — we can
    # render a history view without a running JOIN against wallets.
    balance_after_micros: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, server_default="USD")
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    ref_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ref_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actor_kind: Mapped[str] = mapped_column(String(16), nullable=False, server_default="system")
    actor_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UsageRecord(Base):
    __tablename__ = "usage_records"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    external_ref: Mapped[str] = mapped_column(String(64), nullable=False)
    package_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, server_default="call")
    unit: Mapped[str] = mapped_column(String(16), nullable=False, server_default="per_min")
    quantity_micros: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    raw_cost_micros: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    markup_micros: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    billed_micros: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    currency: Mapped[str] = mapped_column(String(8), nullable=False, server_default="USD")
    cost_breakdown: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    ledger_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("tenant_id", "external_ref", name="uq_usage_tenant_ref"),
    )


class Coupon(Base):
    __tablename__ = "coupons"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    # 'percentage' → value_micros is a basis point on the top-up amount
    # (e.g. 100_000 micros = 10%). 'fixed_micros' → absolute credit amount.
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    value_micros: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, server_default="USD")
    scope_kind: Mapped[str] = mapped_column(String(16), nullable=False, server_default="global")
    scope_value: Mapped[str | None] = mapped_column(String(64), nullable=True)
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uses_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CouponRedemption(Base):
    __tablename__ = "coupon_redemptions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    coupon_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("coupons.id", ondelete="CASCADE"), nullable=False
    )
    tenant_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    value_applied_micros: Mapped[int] = mapped_column(BigInteger, nullable=False)
    ledger_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    redeemed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("coupon_id", "tenant_id", name="uq_coupon_redemptions_pair"),
    )
