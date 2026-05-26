"""packages: billing intervals + provider/markup gating + country scope

Revision ID: 0006_packages_advanced
Revises: 0005_packages_pricing
Create Date: 2026-05-26 04:00:00

Three things in one migration so the rollback is atomic:

1. Relax packages.billing_period to allow finer-grained intervals
   (per_sec/per_min/per_hour/per_day/per_week) alongside the
   monthly/annual/usage values already supported.

2. Five new columns describing what the package is allowed to spend on:
       allowed_provider_kinds   list of provider kinds the package permits
       markup_rule_ids          one markup_rule_id per provider kind
       apply_markup             master toggle for the per-kind rules
       usage_only               kills the recurring fee — pure PAYG
       allowed_countries        ISO codes the telephony pricing covers

All defaults are conservative (empty / false) so existing rows are
unaffected.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_packages_advanced"
down_revision: Union[str, None] = "0005_packages_pricing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_NEW_BILLING_PERIODS = (
    "monthly",
    "annual",
    "usage",
    "per_sec",
    "per_min",
    "per_hour",
    "per_day",
    "per_week",
)


def upgrade() -> None:
    # 1. Relax billing_period check.
    op.drop_constraint("packages_billing_period_check", "packages", type_="check")
    op.create_check_constraint(
        "packages_billing_period_check",
        "packages",
        "billing_period IN ("
        + ", ".join(f"'{p}'" for p in _NEW_BILLING_PERIODS)
        + ")",
    )

    # 2. New gating + scope columns.
    op.add_column(
        "packages",
        sa.Column(
            "allowed_provider_kinds",
            postgresql.JSONB,
            nullable=False,
            server_default="[]",
        ),
    )
    op.add_column(
        "packages",
        sa.Column(
            "markup_rule_ids",
            postgresql.JSONB,
            nullable=False,
            server_default="{}",
        ),
    )
    op.add_column(
        "packages",
        sa.Column(
            "apply_markup",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "packages",
        sa.Column(
            "usage_only",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "packages",
        sa.Column(
            "allowed_countries",
            postgresql.JSONB,
            nullable=False,
            server_default="[]",
        ),
    )


def downgrade() -> None:
    for col in (
        "allowed_countries",
        "usage_only",
        "apply_markup",
        "markup_rule_ids",
        "allowed_provider_kinds",
    ):
        op.drop_column("packages", col)

    op.drop_constraint("packages_billing_period_check", "packages", type_="check")
    op.create_check_constraint(
        "packages_billing_period_check",
        "packages",
        "billing_period IN ('monthly', 'annual', 'usage')",
    )
