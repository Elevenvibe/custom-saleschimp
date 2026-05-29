"""Notification store.

A single table backs both audiences:
  - recipient_kind='platform' → recipient_id is a platform_users.id
    (a specific super-admin). Surfaced on the admin-ui bell.
  - recipient_kind='tenant'   → recipient_id is a tenants.id
    (org-wide). Surfaced on the console bell for every member.

Notifications are append-only from the app's perspective; the only
mutation is stamping read_at. Real-time delivery (Pusher / Beam) is a
follow-up — today the bell polls the list endpoint.
"""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        # Unread-count + recent-list queries always filter by audience.
        Index("ix_notifications_recipient", "recipient_kind", "recipient_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    recipient_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    recipient_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Relative URL the bell links to on click (e.g. "/tenants/16?tab=tickets").
    link: Mapped[str | None] = mapped_column(String(512), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
