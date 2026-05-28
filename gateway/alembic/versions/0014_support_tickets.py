"""support tickets

Revision ID: 0014_support_tickets
Revises: 0013_tenant_org_settings
Create Date: 2026-05-28 09:00:00

Minimal support-ticket model so tenants have an in-product way to
raise issues without going to email. Two tables:

  support_tickets         — one row per ticket. status enum is
                            inline (open/in_progress/resolved/closed);
                            priority is also inline (low/normal/high/
                            urgent). created_by_email is denormalised
                            from TenantMember so we don't have to join
                            for the list view, and so a ticket survives
                            a member being removed.

  support_ticket_messages — the thread. author_kind is 'tenant' or
                            'platform' so we know who said what without
                            joining users tables that live in different
                            databases (Dograh users vs control users).

ON DELETE CASCADE on tenant_id so the super-admin purge endpoint
(/api/admin/tenants/{id}/purge) wipes tickets along with the tenant.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0014_support_tickets"
down_revision: Union[str, None] = "0013_tenant_org_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "support_tickets",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Integer,
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="open",
        ),  # open | in_progress | resolved | closed
        sa.Column(
            "priority",
            sa.String(10),
            nullable=False,
            server_default="normal",
        ),  # low | normal | high | urgent
        sa.Column("created_by_email", sa.String(255), nullable=False),
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
    )

    op.create_table(
        "support_ticket_messages",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "ticket_id",
            sa.Integer,
            sa.ForeignKey("support_tickets.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("author_kind", sa.String(10), nullable=False),  # tenant | platform
        sa.Column("author_email", sa.String(255), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("support_ticket_messages")
    op.drop_table("support_tickets")
