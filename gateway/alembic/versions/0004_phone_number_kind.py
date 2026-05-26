"""billing: phone_number kind + per_month price unit

Revision ID: 0004_phone_number_kind
Revises: 0003_cost_provider_credentials
Create Date: 2026-05-26 00:00:00

Most telephony vendors also rent phone numbers — local, toll-free, mobile —
priced per month rather than per minute. Split that into its own kind so it
gets its own tab in the cost catalog instead of muddling the telephony
per-minute rates.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0004_phone_number_kind"
down_revision: Union[str, None] = "0003_cost_provider_credentials"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # cost_providers.kind — add phone_number
    op.drop_constraint("cost_providers_kind_check", "cost_providers", type_="check")
    op.create_check_constraint(
        "cost_providers_kind_check",
        "cost_providers",
        "kind IN ('llm', 'tts', 'stt', 'embedding', 'telephony', 'phone_number')",
    )

    # cost_provider_prices.unit — add per_month
    op.drop_constraint(
        "cost_provider_prices_unit_check", "cost_provider_prices", type_="check"
    )
    op.create_check_constraint(
        "cost_provider_prices_unit_check",
        "cost_provider_prices",
        "unit IN ('per_minute', 'per_input_token', 'per_output_token', "
        "'per_character', 'per_call', 'per_request', 'per_1k_tokens', "
        "'per_1k_chars', 'per_month')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "cost_provider_prices_unit_check", "cost_provider_prices", type_="check"
    )
    op.create_check_constraint(
        "cost_provider_prices_unit_check",
        "cost_provider_prices",
        "unit IN ('per_minute', 'per_input_token', 'per_output_token', "
        "'per_character', 'per_call', 'per_request', 'per_1k_tokens', "
        "'per_1k_chars')",
    )

    op.drop_constraint("cost_providers_kind_check", "cost_providers", type_="check")
    op.create_check_constraint(
        "cost_providers_kind_check",
        "cost_providers",
        "kind IN ('llm', 'tts', 'stt', 'embedding', 'telephony')",
    )
