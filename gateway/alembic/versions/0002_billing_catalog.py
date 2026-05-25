"""billing: cost providers + prices + markup rules

Revision ID: 0002_billing_catalog
Revises: 0001_initial
Create Date: 2026-05-25 18:00:00

Per docs/saas-architecture.md billing notes (P2): the gateway needs to
compute the cost of a call as a sum of all underlying provider costs
(LLM tokens, TTS chars/minutes, STT minutes, embeddings, telephony) and
then apply a platform markup before billing the customer.

This migration introduces the catalog: providers, their unit prices, and
the markup rules that turn raw provider cost into customer billing rate.

Money is stored as `micros` (millionths of a currency unit) throughout.
Cents are too coarse for per-token prices ($0.000003/token = 3 micros).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_billing_catalog"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- cost_providers --------------------------------------------------
    op.create_table(
        "cost_providers",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("kind", sa.String(16), nullable=False),  # llm|tts|stt|embedding|telephony
        sa.Column("slug", sa.String(64), nullable=False, unique=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("currency", sa.String(8), nullable=False, server_default="USD"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_check_constraint(
        "cost_providers_kind_check",
        "cost_providers",
        "kind IN ('llm', 'tts', 'stt', 'embedding', 'telephony')",
    )

    # --- cost_provider_prices --------------------------------------------
    op.create_table(
        "cost_provider_prices",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "cost_provider_id",
            sa.BigInteger,
            sa.ForeignKey("cost_providers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("unit", sa.String(32), nullable=False),
        # variant lets a provider have multiple price rows for different
        # SKUs (e.g. gpt-4o vs gpt-4o-mini, or a specific voice id).
        sa.Column("variant", sa.String(128), nullable=True),
        sa.Column("price_micros", sa.BigInteger, nullable=False),
        sa.Column("currency", sa.String(8), nullable=False, server_default="USD"),
        sa.Column("effective_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_check_constraint(
        "cost_provider_prices_unit_check",
        "cost_provider_prices",
        "unit IN ('per_minute', 'per_input_token', 'per_output_token', "
        "'per_character', 'per_call', 'per_request', 'per_1k_tokens', 'per_1k_chars')",
    )
    op.create_index(
        "ix_cost_provider_prices_lookup",
        "cost_provider_prices",
        ["cost_provider_id", "variant", "effective_at"],
    )

    # --- markup_rules ----------------------------------------------------
    op.create_table(
        "markup_rules",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("scope_kind", sa.String(16), nullable=False),  # global|kind|tenant
        sa.Column("scope_value", sa.String(64), nullable=True),  # kind name or tenant id
        sa.Column("markup_kind", sa.String(32), nullable=False),  # percentage|fixed_per_minute|fixed_per_unit
        sa.Column("value_micros", sa.BigInteger, nullable=False),
        sa.Column("currency", sa.String(8), nullable=False, server_default="USD"),
        sa.Column("priority", sa.Integer, nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_check_constraint(
        "markup_rules_scope_kind_check",
        "markup_rules",
        "scope_kind IN ('global', 'kind', 'tenant')",
    )
    op.create_check_constraint(
        "markup_rules_markup_kind_check",
        "markup_rules",
        "markup_kind IN ('percentage', 'fixed_per_minute', 'fixed_per_unit')",
    )
    op.create_index(
        "ix_markup_rules_scope",
        "markup_rules",
        ["scope_kind", "scope_value", "priority"],
    )


def downgrade() -> None:
    for t in ("markup_rules", "cost_provider_prices", "cost_providers"):
        op.drop_table(t)
