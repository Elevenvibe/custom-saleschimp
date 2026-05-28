"""MailMessage — inbound (IMAP fetch) + outbound (SMTP send) storage.

Single table for both directions so the Email UI can render a unified
thread; the `direction` column is the discriminator.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
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


class MailMessage(Base):
    __tablename__ = "mail_messages"
    __table_args__ = (
        UniqueConstraint("scope_kind", "scope_id", "uid_int", name="uq_mail_messages_uid"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scope_kind: Mapped[str] = mapped_column(String(16), nullable=False)  # platform|tenant
    scope_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    direction: Mapped[str] = mapped_column(String(10), nullable=False)  # inbound|outbound
    uid_int: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    message_id: Mapped[str | None] = mapped_column(String(512), nullable=True)
    in_reply_to: Mapped[str | None] = mapped_column(String(512), nullable=True)
    from_email: Mapped[str] = mapped_column(String(320), nullable=False)
    from_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    to_emails: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    subject: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    body_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # IMAP folder this row came from (or 'SENT' for outbound). Lets the
    # Email page filter the list pane by Inbox / Sent / Spam / Updates.
    folder: Mapped[str] = mapped_column(String(64), nullable=False, default="INBOX")
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
