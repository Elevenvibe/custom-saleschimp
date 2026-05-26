"""plugins_catalog + tenant_plugin_installs

Revision ID: 0012_plugin_marketplace
Revises: 0011_tenant_sso
Create Date: 2026-05-26 17:00:00

Two tables for the plugin marketplace (P2.B follow-up to SSO):

1. plugins_catalog — the admin-curated registry of available plugins.
   `pricing_kind` is one of 'free', 'one_time', 'monthly', 'per_call'.
   `price_micros` is the price in the catalog currency (USD default).
   `hooks` is a JSONB array of strings ('call.started', 'call.ended',
   …) declaring which runtime events the plugin participates in.

   `visible` decides whether the plugin shows up on the tenant
   marketplace browse page. Admin can stage entries with visible=false
   while they're being prepared.

2. tenant_plugin_installs — one row per (tenant, plugin) installation.
   `status` tracks 'active' / 'paused' / 'failed'. `settings` is a
   JSONB dict for tenant-specific config that the plugin runtime
   reads (API tokens, target inbox, etc.). `installed_at` + the
   reference into `wallet_ledger` (`charge_ledger_id`) preserve the
   audit story for any wallet charge that happened at install.

The existing platform-wide `installed_plugins` table from 0001
stays put — it represents the *platform* having a plugin installed
(catalog-side runtime registration). `tenant_plugin_installs` is
the per-tenant subscription / enablement layer on top.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012_plugin_marketplace"
down_revision: Union[str, None] = "0011_tenant_sso"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "plugins_catalog",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("slug", sa.String(64), nullable=False, unique=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("vendor", sa.String(128), nullable=True),
        sa.Column("icon_url", sa.String(512), nullable=True),
        sa.Column("homepage_url", sa.String(512), nullable=True),
        # one of free | one_time | monthly | per_call. Defaults to free
        # so an admin can stage a new entry without committing to a
        # billing model yet.
        sa.Column(
            "pricing_kind",
            sa.String(16),
            nullable=False,
            server_default="free",
        ),
        sa.Column("price_micros", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("currency", sa.String(8), nullable=False, server_default="USD"),
        sa.Column(
            "hooks",
            postgresql.JSONB,
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "required_scopes",
            postgresql.JSONB,
            nullable=False,
            server_default="[]",
        ),
        sa.Column("visible", sa.Boolean, nullable=False, server_default="true"),
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
        sa.CheckConstraint(
            "pricing_kind IN ('free','one_time','monthly','per_call')",
            name="ck_plugins_catalog_pricing_kind",
        ),
        sa.CheckConstraint(
            "price_micros >= 0",
            name="ck_plugins_catalog_price_nonneg",
        ),
    )

    op.create_table(
        "tenant_plugin_installs",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.BigInteger, nullable=False),
        sa.Column(
            "plugin_id",
            sa.BigInteger,
            sa.ForeignKey("plugins_catalog.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(16),
            nullable=False,
            server_default="active",
        ),
        sa.Column(
            "settings",
            postgresql.JSONB,
            nullable=False,
            server_default="{}",
        ),
        sa.Column("charge_ledger_id", sa.BigInteger, nullable=True),
        sa.Column(
            "installed_at",
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
        sa.CheckConstraint(
            "status IN ('active','paused','failed')",
            name="ck_tenant_plugin_installs_status",
        ),
        sa.UniqueConstraint(
            "tenant_id", "plugin_id", name="uq_tenant_plugin_installs_pair"
        ),
    )


def downgrade() -> None:
    op.drop_table("tenant_plugin_installs")
    op.drop_table("plugins_catalog")
