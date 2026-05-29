"""notifications table

Backs the notification bell on both the super-admin (admin-ui) and tenant
(console) headers. One row per notification; recipient_kind discriminates
platform-user vs tenant audiences.

Revision ID: 0025_notifications
Revises: 0024_tenant_org_profile
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0025_notifications"
down_revision: Union[str, None] = "0024_tenant_org_profile"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("recipient_kind", sa.String(length=16), nullable=False),
        sa.Column("recipient_id", sa.BigInteger(), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("link", sa.String(length=512), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_notifications_recipient",
        "notifications",
        ["recipient_kind", "recipient_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_recipient", table_name="notifications")
    op.drop_table("notifications")
