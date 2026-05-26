"""payment_provider_configs

Revision ID: 0009_payment_provider_configs
Revises: 0008_payments
Create Date: 2026-05-26 14:00:00

Stores Stripe + Paystack secret/publishable/webhook keys in the
control DB so super-admins can flip providers on/off without
redeploying the gateway. Secrets are Fernet-encrypted via the same
GATEWAY_SECRETS_KEY that protects email-provider configs and stored
cost-provider API keys.

One row per provider; the `provider` column is also the natural
primary key but we use an autoincrement id so future plumbing (audit
refs, etc.) has a stable target.

Env vars stay as a fallback — adapters prefer the DB row, fall back
to `settings.<provider>_secret_key` etc. when no row exists. That
keeps existing deploys working untouched and lets a deploy bootstrap
with env, then move to DB-managed secrets later.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_payment_provider_configs"
down_revision: Union[str, None] = "0008_payments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "payment_provider_configs",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("provider", sa.String(16), nullable=False, unique=True),
        # Fernet-encrypted dict with the shape:
        #   {"secret_key": "...", "publishable_key": "...", "webhook_secret": "..."}
        # Wrapped via app.email.crypto.encrypt_dict so the storage shape
        # is consistent with email provider secrets / cost provider creds.
        sa.Column("secrets_encrypted", postgresql.JSONB, nullable=False),
        sa.Column("active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("notes", sa.Text, nullable=True),
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
            "provider IN ('stripe','paystack')",
            name="ck_payment_provider_configs_provider",
        ),
    )


def downgrade() -> None:
    op.drop_table("payment_provider_configs")
