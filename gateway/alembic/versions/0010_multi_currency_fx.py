"""multi-currency wallets + fx_rates

Revision ID: 0010_multi_currency_fx
Revises: 0009_payment_provider_configs
Create Date: 2026-05-26 15:00:00

Two coupled changes:

1. Wallets become (tenant_id, currency) — one row per currency the
   tenant holds. The existing PK on tenant_id alone is dropped and
   replaced with a composite PK. Existing rows all have currency='USD'
   so the swap is a no-op for current tenants.

   wallet_ledger already carries a currency column from 0007 — we drop
   the FK to wallets.tenant_id (the FK shape would have to become
   composite, but the ledger is append-only and balance reconciliation
   lives in WalletService, so the FK was decorative anyway).

2. fx_rates table for currency conversion. Rate is stored as micros
   of the quote currency per 1 unit of the base — i.e. for USD→NGN at
   1500.00 NGN/USD we'd store rate_micros = 1_500_000_000. Keeping
   micros throughout the money stack means the converter is just
   integer math.

   Unique on (base, quote). Cron + admin CRUD live elsewhere (the
   admin can override a stale rate at any time).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010_multi_currency_fx"
down_revision: Union[str, None] = "0009_payment_provider_configs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- wallets PK swap -------------------------------------------------
    # Drop the wallet_ledger FK first so the PK change doesn't trip an
    # invalidated-reference error. The ledger keeps tenant_id as a plain
    # column; the service layer enforces the (tenant_id, currency) match
    # at write time.
    op.execute("ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_tenant_id_fkey")
    op.execute("ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_pkey")
    op.create_primary_key("wallets_pkey", "wallets", ["tenant_id", "currency"])

    # --- fx_rates --------------------------------------------------------
    op.create_table(
        "fx_rates",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("base_currency", sa.String(8), nullable=False),
        sa.Column("quote_currency", sa.String(8), nullable=False),
        # 1 base = (rate_micros / 1_000_000) quote.
        sa.Column("rate_micros", sa.BigInteger, nullable=False),
        sa.Column("source", sa.String(32), nullable=False, server_default="manual"),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("base_currency", "quote_currency", name="uq_fx_rates_pair"),
        sa.CheckConstraint("rate_micros > 0", name="ck_fx_rates_positive"),
    )

    # Seed identity rate so USD↔USD conversion is a no-op even before
    # the admin sets anything up.
    op.execute(
        """
        INSERT INTO fx_rates (base_currency, quote_currency, rate_micros, source)
        VALUES ('USD', 'USD', 1000000, 'seed')
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_table("fx_rates")
    # Restoring the old PK + FK requires that every wallet row's
    # tenant_id be unique. If a tenant has multiple currencies you'd
    # need to consolidate first; we don't try to do that automatically.
    op.execute("ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_pkey")
    op.create_primary_key("wallets_pkey", "wallets", ["tenant_id"])
    op.execute(
        "ALTER TABLE wallet_ledger "
        "ADD CONSTRAINT wallet_ledger_tenant_id_fkey "
        "FOREIGN KEY (tenant_id) REFERENCES wallets(tenant_id) ON DELETE CASCADE"
    )
