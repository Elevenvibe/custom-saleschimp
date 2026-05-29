"""super-admin per-feature permissions

Revision ID: 0018_super_admin_permissions
Revises: 0017_mail_folder
Create Date: 2026-05-29 12:00:00

Per-feature permission grants for platform (super-admin) users. One row
per (platform_user_id, feature). Absence of a row = not granted.

Features (validated in the route layer, not the DB, so adding one needs
no migration):
  - manage_permissions : can view/edit this permissions table
  - update_checker      : sees the Dograh update-availability widget
                          (relocated here from the tenant sidebar)
  - support_widget      : sees/uses the support (Chatwoot) widget
                          (relocated here from the tenant floating bubble)

"Owner" is not a column — it's the bootstrapped super-admin (email ==
GATEWAY_BOOTSTRAP_SUPER_ADMIN_EMAIL), resolved in code. The owner
implicitly has every feature and can always manage permissions, so the
system can never lock itself out of permission management.

ON DELETE CASCADE on platform_user_id so deleting a super-admin drops
their grants.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0018_super_admin_permissions"
down_revision: Union[str, None] = "0017_mail_folder"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "super_admin_permissions",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "platform_user_id",
            sa.BigInteger,
            sa.ForeignKey("platform_users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("feature", sa.String(64), nullable=False),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default="true"),
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
        sa.UniqueConstraint(
            "platform_user_id", "feature", name="uq_super_admin_permission"
        ),
    )


def downgrade() -> None:
    op.drop_table("super_admin_permissions")
