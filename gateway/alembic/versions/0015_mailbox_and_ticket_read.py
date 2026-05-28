"""mailbox configs + ticket read state

Revision ID: 0015_mailbox_and_ticket_read
Revises: 0014_support_tickets
Create Date: 2026-05-28 11:00:00

Two unrelated additions tracked in one migration because they ship in
the same UI slice:

mailbox_configs
  New table for SMTP (outbox) + IMAP (inbox) credentials used by the
  Email page in the super-admin Communication section, and the
  matching per-tenant Email Integration card on /console/settings/
  organization. Distinct from email_provider_configs because that
  table powers TRANSACTIONAL notifications (verify emails, password
  resets via SES/Postmark/SMTP) — mixing the two would be confusing
  and would force one row to serve two unrelated concepts.

  scope_kind = 'platform' (one shared mailbox the super-admin's Email
                tab reads/writes) or 'tenant' (the tenant's own
                mailbox shown on their Email tab).
  scope_id    = tenant.id when scope_kind='tenant'; null otherwise.
  smtp_config_encrypted / imap_config_encrypted store the credentials
  as JSONB. The actual pull/push worker lands in a follow-up; this
  migration just makes the storage available so the UI can save
  credentials.

support_tickets.read_at
  Per-row timestamp of when the platform side last opened the ticket.
  Powers the read/unread badge on the Gmail-style ticket list (admin
  unread = read_at IS NULL OR read_at < updated_at). Tenant-side
  read tracking is intentionally not added here — tenants don't
  need a separate inbox in the same way; the existing in_progress/
  open status surface is sufficient for now.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0015_mailbox_and_ticket_read"
down_revision: Union[str, None] = "0014_support_tickets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mailbox_configs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("scope_kind", sa.String(16), nullable=False),  # platform | tenant
        sa.Column("scope_id", sa.Integer, nullable=True),
        sa.Column("smtp_config_encrypted", sa.JSON, nullable=True),
        sa.Column("imap_config_encrypted", sa.JSON, nullable=True),
        sa.Column("from_email", sa.String(255), nullable=True),
        sa.Column("from_name", sa.String(255), nullable=True),
        sa.Column(
            "smtp_active",
            sa.Boolean,
            nullable=False,
            server_default="false",
        ),
        sa.Column(
            "imap_active",
            sa.Boolean,
            nullable=False,
            server_default="false",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("scope_kind", "scope_id", name="uq_mailbox_scope"),
    )

    with op.batch_alter_table("support_tickets") as batch:
        batch.add_column(
            sa.Column("read_at", sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("support_tickets") as batch:
        batch.drop_column("read_at")
    op.drop_table("mailbox_configs")
