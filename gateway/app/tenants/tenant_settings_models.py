"""Tenant-scoped settings tables (payment methods + tax rates).

Kept separate from `tenants/models.py` so the new tables don't bloat the
core tenant module. Payment-method credentials are stored encrypted under
config['_secret_enc'] (Fernet, via app.email.crypto.encrypt_dict).
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TenantPaymentMethod(Base):
    __tablename__ = "tenant_payment_methods"
    __table_args__ = (
        UniqueConstraint("tenant_id", "provider", name="uq_tenant_payment_method"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    environment: Mapped[str] = mapped_column(String(16), nullable=False, server_default="live")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    # Plain fields + an "_secret_enc" entry (Fernet-encrypted JSON object).
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TenantTaxRate(Base):
    __tablename__ = "tenant_tax_rates"
    __table_args__ = (Index("ix_tenant_tax_rates_tenant", "tenant_id", "is_default"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    rate: Mapped[float] = mapped_column(Numeric(6, 3), nullable=False)
    region: Mapped[str | None] = mapped_column(String(64), nullable=True)
    inclusive: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
