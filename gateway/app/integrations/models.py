"""Integration data — linked Google accounts + imported contacts.

google_links   one row per tenant that has connected a Google account; holds
               the (encrypted) OAuth tokens used to call Google APIs on their
               behalf.
contacts       contacts imported from a linked source (Google today), tagged
               with an optional label. Deduped per (tenant, source,
               resource_name) so re-imports update rather than duplicate.
"""

from datetime import datetime

from typing import Any

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class GoogleLink(Base):
    __tablename__ = "google_links"
    __table_args__ = (UniqueConstraint("tenant_id", name="uq_google_link_tenant"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    google_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Fernet-encrypted token, stored in the encrypt_dict shape ({"_enc": ...})
    # as JSONB — matches how every other secret is persisted.
    access_token_enc: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    refresh_token_enc: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    token_expiry: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scopes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Contact(Base):
    __tablename__ = "contacts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "source", "resource_name", name="uq_contact_source"),
        Index("ix_contacts_tenant", "tenant_id", "label"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    source: Mapped[str] = mapped_column(String(24), nullable=False, server_default="google")
    label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Provider id (Google People resourceName) for idempotent re-import.
    resource_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
