from datetime import datetime

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
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class CostProvider(Base):
    """A vendor whose service contributes to a call's cost.

    `kind` partitions providers by what they're paid for:
        llm        — language model (per token usually)
        tts        — text-to-speech (per char or per minute of audio)
        stt        — speech-to-text (per minute)
        embedding  — embedding model (per token)
        telephony  — carrier (per minute of voice traffic)
    A provider can have multiple `cost_provider_prices` rows — one per
    SKU/variant — so e.g. "OpenAI" carries gpt-4o + gpt-4o-mini side by side.
    """

    __tablename__ = "cost_providers"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, server_default="USD")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class CostProviderPrice(Base):
    """A unit price for a provider's service.

    Prices are stored as *micros* (millionths of a currency unit). A penny
    is 10_000 micros; a $3-per-1000-tokens model is 3_000 micros/1k or 3
    micros/token. This avoids losing precision on per-token math.
    """

    __tablename__ = "cost_provider_prices"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    cost_provider_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("cost_providers.id", ondelete="CASCADE"),
        nullable=False,
    )
    unit: Mapped[str] = mapped_column(String(32), nullable=False)
    variant: Mapped[str | None] = mapped_column(String(128), nullable=True)
    price_micros: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, server_default="USD")
    effective_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class MarkupRule(Base):
    """Platform markup applied on top of raw provider cost.

    Resolution at billing time:
        1. find highest-priority active rule with scope_kind='tenant'
           and scope_value=<tenant_id>
        2. else highest-priority active rule with scope_kind='kind'
           and scope_value=<provider_kind>
        3. else highest-priority active rule with scope_kind='global'
        4. else: zero markup
    """

    __tablename__ = "markup_rules"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    scope_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    scope_value: Mapped[str | None] = mapped_column(String(64), nullable=True)
    markup_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    value_micros: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, server_default="USD")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
