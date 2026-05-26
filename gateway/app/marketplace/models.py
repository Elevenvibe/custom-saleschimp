"""Plugin marketplace models.

`PluginCatalogEntry` is admin-curated; `TenantPluginInstall` is the
per-tenant install row that's created when a tenant clicks Install.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PluginCatalogEntry(Base):
    __tablename__ = "plugins_catalog"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    vendor: Mapped[str | None] = mapped_column(String(128), nullable=True)
    icon_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    homepage_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    pricing_kind: Mapped[str] = mapped_column(String(16), nullable=False, server_default="free")
    price_micros: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    currency: Mapped[str] = mapped_column(String(8), nullable=False, server_default="USD")
    hooks: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    required_scopes: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
    visible: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TenantPluginInstall(Base):
    __tablename__ = "tenant_plugin_installs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "plugin_id", name="uq_tenant_plugin_installs_pair"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    plugin_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("plugins_catalog.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="active")
    settings: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    charge_ledger_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    installed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
