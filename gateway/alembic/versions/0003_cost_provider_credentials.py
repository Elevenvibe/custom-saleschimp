"""cost_providers: credentials_encrypted column

Revision ID: 0003_cost_provider_credentials
Revises: 0002_billing_catalog
Create Date: 2026-05-25 20:00:00

Allows storing the vendor API key (Fernet-encrypted via the platform key)
on each cost provider, so adapters can fetch live model lists and any
endpoint-exposed pricing. Nullable — providers without configured creds
just fall back to the integrated catalog.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_cost_provider_credentials"
down_revision: Union[str, None] = "0002_billing_catalog"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "cost_providers",
        sa.Column("credentials_encrypted", postgresql.JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("cost_providers", "credentials_encrypted")
