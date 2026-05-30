"""seed tables catalog

Catalog of seedable tables for Settings → Seed Settings.

Revision ID: 0029_seed_settings
Revises: 0028_tax_rates
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0029_seed_settings"
down_revision: Union[str, None] = "0028_tax_rates"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "seed_tables",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("schema", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("scope_column", sa.String(length=32), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("schema", "name", name="uq_seed_table_schema_name"),
    )


def downgrade() -> None:
    op.drop_table("seed_tables")
