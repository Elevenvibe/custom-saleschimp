"""wallets, ledger, usage_records, coupons

Revision ID: 0007_wallet_usage
Revises: 0006_packages_advanced
Create Date: 2026-05-26 08:00:00

Five tables that together form the wallet/billing data plane:

1. wallets — one row per tenant, holds the current balance in micros plus
   the auto-reload preferences. Default currency is USD; we deliberately
   ship USD-only at MVP and surface a banner for tenants whose package
   currency differs (FX is its own can of worms).

2. wallet_ledger — append-only journal of every signed delta. Reason
   strings (charge / topup / refund / adjustment / coupon) drive the UI
   filters and the admin audit story. `ref_kind`/`ref_id` lets us point
   back at usage_records / payment_intents / coupon_redemptions without
   adding hard FKs (those tables live in this migration and the next).

3. usage_records — one row per billable Dograh workflow_run. We mirror
   call_duration_seconds + Dograh's reported charge_usd plus our own
   cost-calculator output (raw, markup, billed) so the customer reports
   page can show both numbers if they ever diverge (e.g. tenant package
   pins a different markup rule than Dograh assumed).

4. coupons + coupon_redemptions — first-class coupon codes with global
   or package scope, capped by max_uses and expires_at. Redemption rows
   are idempotent per (coupon, tenant) so the same code can't be
   double-spent.

Everything that touches the balance MUST go through wallet_ledger — no
direct UPDATE on wallets.balance_micros outside the service layer.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007_wallet_usage"
down_revision: Union[str, None] = "0006_packages_advanced"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- wallets -----------------------------------------------------------
    op.create_table(
        "wallets",
        sa.Column("tenant_id", sa.BigInteger, primary_key=True),
        sa.Column("balance_micros", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("currency", sa.String(8), nullable=False, server_default="USD"),
        # Negative balances are forbidden globally; per-tenant credit_limit_micros
        # gives super-admins a clean knob to grant invoiced/enterprise tenants
        # the ability to dip below zero. Default 0 = strict.
        sa.Column("credit_limit_micros", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("auto_reload_enabled", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("auto_reload_threshold_micros", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("auto_reload_amount_micros", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("auto_reload_payment_method_id", sa.BigInteger, nullable=True),
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
        sa.CheckConstraint("balance_micros >= -credit_limit_micros", name="ck_wallets_no_negative"),
    )

    # --- wallet_ledger -----------------------------------------------------
    op.create_table(
        "wallet_ledger",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "tenant_id",
            sa.BigInteger,
            sa.ForeignKey("wallets.tenant_id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Signed delta — positive = credit to tenant, negative = charge.
        sa.Column("delta_micros", sa.BigInteger, nullable=False),
        sa.Column("balance_after_micros", sa.BigInteger, nullable=False),
        sa.Column("currency", sa.String(8), nullable=False, server_default="USD"),
        sa.Column("reason", sa.String(32), nullable=False),
        sa.Column("ref_kind", sa.String(32), nullable=True),
        sa.Column("ref_id", sa.String(64), nullable=True),
        sa.Column("actor_kind", sa.String(16), nullable=False, server_default="system"),
        sa.Column("actor_user_id", sa.BigInteger, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "reason IN ('charge','topup','refund','adjustment','coupon','auto_reload')",
            name="ck_wallet_ledger_reason",
        ),
    )
    op.create_index(
        "ix_wallet_ledger_tenant_created",
        "wallet_ledger",
        ["tenant_id", "created_at"],
    )

    # --- usage_records -----------------------------------------------------
    op.create_table(
        "usage_records",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.BigInteger, nullable=False),
        # external_ref lets the ingest cron skip a Dograh workflow_run we've
        # already recorded. Unique per tenant so two tenants can re-use run ids.
        sa.Column("external_ref", sa.String(64), nullable=False),
        sa.Column("package_id", sa.BigInteger, nullable=True),
        sa.Column("kind", sa.String(32), nullable=False, server_default="call"),
        sa.Column("unit", sa.String(16), nullable=False, server_default="per_min"),
        # Quantity stored in micros of the unit so 30 seconds = 500_000 of a
        # per_min unit without floating-point loss.
        sa.Column("quantity_micros", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("raw_cost_micros", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("markup_micros", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("billed_micros", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("currency", sa.String(8), nullable=False, server_default="USD"),
        sa.Column(
            "cost_breakdown",
            postgresql.JSONB,
            nullable=False,
            server_default="{}",
        ),
        sa.Column("ledger_id", sa.BigInteger, nullable=True),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("tenant_id", "external_ref", name="uq_usage_tenant_ref"),
    )
    op.create_index(
        "ix_usage_records_tenant_occurred",
        "usage_records",
        ["tenant_id", "occurred_at"],
    )

    # --- coupons -----------------------------------------------------------
    op.create_table(
        "coupons",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(64), nullable=False, unique=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("value_micros", sa.BigInteger, nullable=False),
        sa.Column("currency", sa.String(8), nullable=False, server_default="USD"),
        sa.Column("scope_kind", sa.String(16), nullable=False, server_default="global"),
        sa.Column("scope_value", sa.String(64), nullable=True),
        sa.Column("max_uses", sa.Integer, nullable=True),
        sa.Column("uses_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "kind IN ('percentage','fixed_micros')",
            name="ck_coupons_kind",
        ),
        sa.CheckConstraint(
            "scope_kind IN ('global','package')",
            name="ck_coupons_scope_kind",
        ),
    )

    # --- coupon_redemptions ------------------------------------------------
    op.create_table(
        "coupon_redemptions",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "coupon_id",
            sa.BigInteger,
            sa.ForeignKey("coupons.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tenant_id", sa.BigInteger, nullable=False),
        sa.Column("value_applied_micros", sa.BigInteger, nullable=False),
        sa.Column("ledger_id", sa.BigInteger, nullable=True),
        sa.Column(
            "redeemed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # One tenant can only redeem a given code once. Multi-use across
        # tenants is gated by coupons.max_uses + uses_count.
        sa.UniqueConstraint("coupon_id", "tenant_id", name="uq_coupon_redemptions_pair"),
    )


def downgrade() -> None:
    op.drop_table("coupon_redemptions")
    op.drop_table("coupons")
    op.drop_index("ix_usage_records_tenant_occurred", table_name="usage_records")
    op.drop_table("usage_records")
    op.drop_index("ix_wallet_ledger_tenant_created", table_name="wallet_ledger")
    op.drop_table("wallet_ledger")
    op.drop_table("wallets")
