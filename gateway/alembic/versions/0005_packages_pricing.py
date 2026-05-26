"""packages: PAYG vs annual + bundled minutes + overage + concurrency

Revision ID: 0005_packages_pricing
Revises: 0004_phone_number_kind
Create Date: 2026-05-26 02:00:00

Adds the columns customer-facing Plans page needs to express tiers:

    kind                       'payg' | 'annual'
    bundled_minutes            0 = unlimited / on-demand only
    overage_per_minute_micros  what's charged above bundle
    concurrency_included       0 = none / packed limit
    billing_period             'monthly' | 'annual' | 'usage'
    currency                   already implicit; codify here
    contact_sales              annual + custom plans hide checkout
    visible                    super-admin can stage a draft package

Existing rows are migrated to a sensible PAYG default so the catalog
keeps working without manual fix-up.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_packages_pricing"
down_revision: Union[str, None] = "0004_phone_number_kind"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "packages",
        sa.Column("kind", sa.String(16), nullable=False, server_default="payg"),
    )
    op.add_column(
        "packages",
        sa.Column("bundled_minutes", sa.Integer, nullable=False, server_default="0"),
    )
    op.add_column(
        "packages",
        sa.Column(
            "overage_per_minute_micros",
            sa.BigInteger,
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "packages",
        sa.Column(
            "concurrency_included",
            sa.Integer,
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "packages",
        sa.Column(
            "billing_period",
            sa.String(16),
            nullable=False,
            server_default="monthly",
        ),
    )
    op.add_column(
        "packages",
        sa.Column("currency", sa.String(8), nullable=False, server_default="USD"),
    )
    op.add_column(
        "packages",
        sa.Column(
            "contact_sales",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "packages",
        sa.Column(
            "visible",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("true"),
        ),
    )

    op.create_check_constraint(
        "packages_kind_check",
        "packages",
        "kind IN ('payg', 'annual')",
    )
    op.create_check_constraint(
        "packages_billing_period_check",
        "packages",
        "billing_period IN ('monthly', 'annual', 'usage')",
    )


def downgrade() -> None:
    op.drop_constraint("packages_billing_period_check", "packages", type_="check")
    op.drop_constraint("packages_kind_check", "packages", type_="check")
    for col in (
        "visible",
        "contact_sales",
        "currency",
        "billing_period",
        "concurrency_included",
        "overage_per_minute_micros",
        "bundled_minutes",
        "kind",
    ):
        op.drop_column("packages", col)
