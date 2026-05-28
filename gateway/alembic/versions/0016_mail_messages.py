"""mail messages

Revision ID: 0016_mail_messages
Revises: 0015_mailbox_and_ticket_read
Create Date: 2026-05-28 14:00:00

Storage for IMAP-fetched inbound mail and SMTP-sent outbound mail.
Both directions live in the same table so the Email UI can render a
unified thread without a UNION.

  direction = 'inbound'   → row was written by the IMAP fetcher
            = 'outbound'  → row was written by the SMTP send helper

UID-based dedupe for inbound: UNIQUE(scope_kind, scope_id, uid_int)
means a message that's already been pulled never gets re-inserted.
Outbound rows have uid_int = NULL so the unique constraint doesn't
fire for them (NULLs don't collide in postgres' default behavior).

read_at supports the "unread" badge on the Email page, mirroring the
read_at pattern on support_tickets.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016_mail_messages"
down_revision: Union[str, None] = "0015_mailbox_and_ticket_read"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mail_messages",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("scope_kind", sa.String(16), nullable=False),  # platform | tenant
        sa.Column("scope_id", sa.Integer, nullable=True),
        sa.Column("direction", sa.String(10), nullable=False),  # inbound | outbound
        sa.Column("uid_int", sa.BigInteger, nullable=True),  # IMAP UID; outbound is null
        sa.Column("message_id", sa.String(512), nullable=True),
        sa.Column("in_reply_to", sa.String(512), nullable=True),
        sa.Column("from_email", sa.String(320), nullable=False),
        sa.Column("from_name", sa.String(255), nullable=True),
        sa.Column("to_emails", sa.JSON, nullable=False),  # list[str]
        sa.Column("subject", sa.String(500), nullable=False, server_default=""),
        sa.Column("body_text", sa.Text, nullable=False, server_default=""),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "scope_kind", "scope_id", "uid_int", name="uq_mail_messages_uid"
        ),
    )
    op.create_index(
        "ix_mail_messages_scope_received",
        "mail_messages",
        ["scope_kind", "scope_id", sa.text("received_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_mail_messages_scope_received", table_name="mail_messages")
    op.drop_table("mail_messages")
