"""tenant suspension metadata + ticket category

Revision ID: 0020_tenant_suspension
Revises: 0019_payment_purpose
Create Date: 2026-05-29 18:00:00

Suspension workflow.

tenants gains:
  suspended_at          when the suspension took effect
  suspended_by          platform_user id who suspended
  suspension_subject    category (Payment Overdue, Abuse, …)
  suspension_reason     the (optionally AI-drafted) notice text
  suspension_ticket_id  the support ticket opened for the suspension so
                        the tenant can reply from the /suspended page

support_tickets gains:
  category     mirrors the suspension subject / general ticket category
  assigned_to  platform_user handling the ticket (nullable)

All nullable so existing rows are unaffected. Suspension *history* lives
permanently in the audit log; these columns hold the CURRENT suspension
(cleared on unsuspend).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0020_tenant_suspension"
down_revision: Union[str, None] = "0019_payment_purpose"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("tenants") as batch:
        batch.add_column(sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("suspended_by", sa.BigInteger, nullable=True))
        batch.add_column(sa.Column("suspension_subject", sa.String(64), nullable=True))
        batch.add_column(sa.Column("suspension_reason", sa.Text, nullable=True))
        batch.add_column(sa.Column("suspension_ticket_id", sa.Integer, nullable=True))
    with op.batch_alter_table("support_tickets") as batch:
        batch.add_column(sa.Column("category", sa.String(64), nullable=True))
        batch.add_column(sa.Column("assigned_to", sa.BigInteger, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("support_tickets") as batch:
        batch.drop_column("assigned_to")
        batch.drop_column("category")
    with op.batch_alter_table("tenants") as batch:
        batch.drop_column("suspension_ticket_id")
        batch.drop_column("suspension_reason")
        batch.drop_column("suspension_subject")
        batch.drop_column("suspended_by")
        batch.drop_column("suspended_at")
