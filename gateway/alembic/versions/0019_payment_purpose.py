"""payment purpose + package link

Revision ID: 0019_payment_purpose
Revises: 0018_super_admin_permissions
Create Date: 2026-05-29 16:00:00

Lets a payment_intent be attributed to *what it paid for*:

  purpose      'wallet_topup' (default — existing behaviour) | 'subscription'
  package_id   nullable FK-ish to packages.id; set when purpose='subscription'

This is the subscription↔payment link: a paid subscription is now a
succeeded payment_intent with purpose='subscription' + package_id, so the
dashboard's "recent paid subscriptions" and revenue can be payment-backed
rather than inferred from tenant_packages alone.

Both columns are nullable / defaulted so existing rows are untouched.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0019_payment_purpose"
down_revision: Union[str, None] = "0018_super_admin_permissions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("payment_intents") as batch:
        batch.add_column(
            sa.Column(
                "purpose",
                sa.String(32),
                nullable=False,
                server_default="wallet_topup",
            )
        )
        batch.add_column(sa.Column("package_id", sa.BigInteger, nullable=True))
    op.create_index(
        "ix_payment_intents_purpose", "payment_intents", ["purpose", "status"]
    )


def downgrade() -> None:
    op.drop_index("ix_payment_intents_purpose", table_name="payment_intents")
    with op.batch_alter_table("payment_intents") as batch:
        batch.drop_column("package_id")
        batch.drop_column("purpose")
