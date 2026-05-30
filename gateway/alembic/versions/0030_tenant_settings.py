"""tenant settings tables + jsonb column

- tenants.tenant_settings JSONB: per-tenant app/currency/notification prefs.
- tenant_payment_methods: per-tenant BYOK provider credentials (encrypted).
- tenant_tax_rates: per-tenant tax catalog.

Revision ID: 0030_tenant_settings
Revises: 0029_seed_settings
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0030_tenant_settings"
down_revision: Union[str, None] = "0029_seed_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column(
            "tenant_settings",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )

    op.create_table(
        "tenant_payment_methods",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "tenant_id",
            sa.BigInteger(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("environment", sa.String(length=16), nullable=False, server_default="live"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("config", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "provider", name="uq_tenant_payment_method"),
    )

    op.create_table(
        "tenant_tax_rates",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "tenant_id",
            sa.BigInteger(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("rate", sa.Numeric(6, 3), nullable=False),
        sa.Column("region", sa.String(length=64), nullable=True),
        sa.Column("inclusive", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_tenant_tax_rates_tenant", "tenant_tax_rates", ["tenant_id", "is_default"]
    )


def downgrade() -> None:
    op.drop_index("ix_tenant_tax_rates_tenant", table_name="tenant_tax_rates")
    op.drop_table("tenant_tax_rates")
    op.drop_table("tenant_payment_methods")
    op.drop_column("tenants", "tenant_settings")
