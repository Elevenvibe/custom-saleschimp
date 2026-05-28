"""MailboxConfig — SMTP/IMAP credentials for the Email feature.

See migration 0015 for the table definition + the why-not-reuse-
email_provider_configs decision.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class MailboxConfig(Base):
    __tablename__ = "mailbox_configs"
    __table_args__ = (UniqueConstraint("scope_kind", "scope_id", name="uq_mailbox_scope"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scope_kind: Mapped[str] = mapped_column(String(16), nullable=False)  # platform | tenant
    scope_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Encrypted blobs — Fernet via app.secrets.crypto. Shape:
    #   smtp: {"host": str, "port": int, "username": str, "password": str, "use_tls": bool}
    #   imap: {"host": str, "port": int, "username": str, "password": str, "use_ssl": bool}
    smtp_config_encrypted: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    imap_config_encrypted: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    from_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    from_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    imap_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
