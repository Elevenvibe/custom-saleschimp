"""tenant suspension mode

Revision ID: 0021_suspension_mode
Revises: 0020_tenant_suspension
Create Date: 2026-05-29 20:00:00

How aggressively a suspension is enforced:

  'delayed'   (default) — blocked on the tenant's next navigation / API
              call. Already-open tabs keep their current view until they
              move. This is the middleware + gateway behaviour.
  'kill_live' — a poller in the Dograh chrome detects the suspension
              within ~seconds, signs the tenant out of ALL Dograh
              services (clears dograh_auth_token), and redirects to the
              suspension page — even with no navigation.

Nullable/defaulted so existing rows are unaffected; cleared on unsuspend.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0021_suspension_mode"
down_revision: Union[str, None] = "0020_tenant_suspension"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("tenants") as batch:
        batch.add_column(
            sa.Column(
                "suspension_mode",
                sa.String(16),
                nullable=False,
                server_default="delayed",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("tenants") as batch:
        batch.drop_column("suspension_mode")
