"""Tenant SSO configs + transient state rows.

Models stay thin; secrets management + crypto live in sso/service.py.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TenantSsoConfig(Base):
    __tablename__ = "tenant_sso_configs"
    __table_args__ = (
        UniqueConstraint("tenant_id", name="uq_tenant_sso_configs_tenant"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    idp_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    issuer: Mapped[str] = mapped_column(String(512), nullable=False)
    client_id: Mapped[str] = mapped_column(String(256), nullable=False)
    secrets_encrypted: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    discovery_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    metadata_xml: Mapped[str | None] = mapped_column(Text, nullable=True)
    force_sso: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    attribute_map: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=lambda: {"_default": "user"}
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SsoState(Base):
    __tablename__ = "sso_state"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    state: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    nonce: Mapped[str] = mapped_column(String(64), nullable=False)
    redirect_uri: Mapped[str] = mapped_column(String(512), nullable=False)
    return_to: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
