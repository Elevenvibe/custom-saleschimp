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
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Package(Base):
    """A subscription tier.

    `kind` partitions the offering:
        payg   — month-to-month pre-paid bundle + per-minute overage
        annual — yearly commitment, often with bigger bundle / lower
                 overage / "contact sales" UX

    All money is stored in micros (millionths of a currency unit) so the
    same precision rules used in the cost catalog apply here. `bundled_minutes`
    = 0 means usage-only (no bundle); `concurrency_included` = 0 means none.
    `contact_sales = true` hides the self-serve checkout on the customer
    Plans page and surfaces a Contact button instead.
    """

    __tablename__ = "packages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    monthly_price_cents: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    limits: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    kind: Mapped[str] = mapped_column(String(16), nullable=False, server_default="payg")
    bundled_minutes: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    overage_per_minute_micros: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default="0"
    )
    concurrency_included: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    billing_period: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="monthly"
    )
    currency: Mapped[str] = mapped_column(String(8), nullable=False, server_default="USD")
    contact_sales: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    visible: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    # Provider gating + scoping. Empty list = no restriction on that axis.
    allowed_provider_kinds: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
    markup_rule_ids: Mapped[dict[str, int]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    apply_markup: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    usage_only: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    allowed_countries: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PackagePlugin(Base):
    __tablename__ = "package_plugins"

    package_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("packages.id", ondelete="CASCADE"), primary_key=True
    )
    plugin_id: Mapped[str] = mapped_column(String(128), primary_key=True)
