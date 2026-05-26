"""payment_methods + payment_intents

Revision ID: 0008_payments
Revises: 0007_wallet_usage
Create Date: 2026-05-26 13:00:00

Two tables that turn the wallet from a fake ledger into a real one:

1. payment_methods — one row per stored card / authorization on file.
   We never touch raw card data. The provider holds it; we just keep
   the provider-issued token (Stripe payment_method id or Paystack
   authorization_code) so we can charge it again later. The token is
   Fernet-encrypted at rest using the same GATEWAY_SECRETS_KEY that
   protects email-provider secrets.

2. payment_intents — one row per top-up attempt. Status transitions
   pending → succeeded | failed | refunded. Webhook handlers and the
   client-side polling both reconcile against this row; idempotency_key
   guarantees a webhook retry can't double-credit the wallet.

Stripe is the default (configured first in the UI flow); Paystack is
opt-in for NG. The `provider` column is a free string so new adapters
can land without a migration.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_payments"
down_revision: Union[str, None] = "0007_wallet_usage"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "payment_methods",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.BigInteger, nullable=False),
        sa.Column("provider", sa.String(16), nullable=False),
        # Fernet-encrypted dict: {"token": "<id>", "fingerprint": "..."}.
        # JSONB so we can rotate shape (e.g. add Paystack's authorization
        # signature) without a schema migration.
        sa.Column("token_encrypted", postgresql.JSONB, nullable=False),
        sa.Column("brand", sa.String(32), nullable=True),
        sa.Column("last4", sa.String(8), nullable=True),
        sa.Column("exp_month", sa.Integer, nullable=True),
        sa.Column("exp_year", sa.Integer, nullable=True),
        sa.Column("currency", sa.String(8), nullable=False, server_default="USD"),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "provider IN ('stripe','paystack')",
            name="ck_payment_methods_provider",
        ),
        sa.CheckConstraint(
            "status IN ('active','revoked')",
            name="ck_payment_methods_status",
        ),
    )
    op.create_index(
        "ix_payment_methods_tenant",
        "payment_methods",
        ["tenant_id"],
    )

    op.create_table(
        "payment_intents",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.BigInteger, nullable=False),
        sa.Column("provider", sa.String(16), nullable=False),
        # The Stripe payment_intent id / Paystack reference. Unique
        # per provider so retries from the client app or webhook can't
        # create a second row for the same charge.
        sa.Column("provider_ref", sa.String(128), nullable=False),
        sa.Column("amount_cents", sa.Integer, nullable=False),
        sa.Column("currency", sa.String(8), nullable=False, server_default="USD"),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("payment_method_id", sa.BigInteger, nullable=True),
        sa.Column("ledger_id", sa.BigInteger, nullable=True),
        # Our own idempotency key — caller-provided so a UI retry maps
        # to the same row even before the provider has issued a ref.
        sa.Column("idempotency_key", sa.String(64), nullable=True),
        sa.Column(
            "raw_payload",
            postgresql.JSONB,
            nullable=False,
            server_default="{}",
        ),
        sa.Column("error", sa.Text, nullable=True),
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
            "status IN ('pending','succeeded','failed','refunded')",
            name="ck_payment_intents_status",
        ),
        sa.UniqueConstraint(
            "provider", "provider_ref", name="uq_payment_intents_provider_ref"
        ),
        sa.UniqueConstraint(
            "tenant_id", "idempotency_key", name="uq_payment_intents_tenant_idem"
        ),
    )
    op.create_index(
        "ix_payment_intents_tenant_created",
        "payment_intents",
        ["tenant_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_payment_intents_tenant_created", table_name="payment_intents")
    op.drop_table("payment_intents")
    op.drop_index("ix_payment_methods_tenant", table_name="payment_methods")
    op.drop_table("payment_methods")
