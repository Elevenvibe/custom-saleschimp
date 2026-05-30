"""custom fields + values

Admin-designed custom fields (definitions) + their per-record values, backing
the field builder in Settings → Custom fields.

Revision ID: 0026_custom_fields
Revises: 0025_notifications
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0026_custom_fields"
down_revision: Union[str, None] = "0025_notifications"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "custom_fields",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("entity", sa.String(length=48), nullable=False),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=128), nullable=False),
        sa.Column("field_type", sa.String(length=24), nullable=False),
        sa.Column("options", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("required", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("help_text", sa.String(length=255), nullable=True),
        sa.Column("placeholder", sa.String(length=128), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("entity", "key", name="uq_custom_field_entity_key"),
    )
    op.create_index("ix_custom_fields_entity", "custom_fields", ["entity", "active", "sort_order"])

    op.create_table(
        "custom_field_values",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "field_id",
            sa.BigInteger(),
            sa.ForeignKey("custom_fields.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("entity", sa.String(length=48), nullable=False),
        sa.Column("entity_id", sa.String(length=64), nullable=False),
        sa.Column("value", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("field_id", "entity_id", name="uq_custom_field_value"),
    )
    op.create_index(
        "ix_custom_field_values_lookup", "custom_field_values", ["entity", "entity_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_custom_field_values_lookup", table_name="custom_field_values")
    op.drop_table("custom_field_values")
    op.drop_index("ix_custom_fields_entity", table_name="custom_fields")
    op.drop_table("custom_fields")
