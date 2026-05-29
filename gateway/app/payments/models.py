"""Payment methods + payment intents.

The pair tracks "what cards are on file" and "what top-up attempts
have happened" respectively. They live in their own module so the
wallet primitives (P2.A3a) don't pull a hard dependency on Stripe.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PaymentMethod(Base):
    __tablename__ = "payment_methods"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    # Fernet-encrypted via app.email.crypto.encrypt_dict so the column
    # shape stays consistent with email provider secrets.
    token_encrypted: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    brand: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last4: Mapped[str | None] = mapped_column(String(8), nullable=True)
    exp_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exp_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, server_default="USD")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PaymentIntent(Base):
    __tablename__ = "payment_intents"
    __table_args__ = (
        UniqueConstraint("provider", "provider_ref", name="uq_payment_intents_provider_ref"),
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_payment_intents_tenant_idem"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    provider_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, server_default="USD")
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="pending")
    # What this payment paid for. 'wallet_topup' (default) keeps existing
    # behaviour; 'subscription' + package_id attributes it to a plan, which
    # powers the dashboard's payment-backed "recent paid subscriptions".
    purpose: Mapped[str] = mapped_column(String(32), nullable=False, server_default="wallet_topup")
    package_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    payment_method_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    ledger_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    raw_payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
