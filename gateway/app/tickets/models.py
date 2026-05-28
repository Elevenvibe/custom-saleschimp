"""Support-ticket models.

Two tables (see migration 0014_support_tickets). The status / priority
enums are kept as plain strings rather than SQL ENUMs so we can extend
them without an ALTER TABLE round-trip; validation happens in the route
layer's pydantic models.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    # open | in_progress | resolved | closed
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="open")
    # low | normal | high | urgent
    priority: Mapped[str] = mapped_column(String(10), nullable=False, server_default="normal")
    # Denormalised so a list of tickets doesn't need a join into
    # tenant_members — and so a ticket keeps its creator name even after
    # that member is removed from the org.
    created_by_email: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class SupportTicketMessage(Base):
    __tablename__ = "support_ticket_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticket_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("support_tickets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 'tenant' or 'platform' — who is talking. We don't FK to a users
    # table because customer-side users live in Dograh's DB and platform
    # users live in control's, so a single FK doesn't work.
    author_kind: Mapped[str] = mapped_column(String(10), nullable=False)
    author_email: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
