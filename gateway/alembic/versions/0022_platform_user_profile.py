"""platform user profile fields + email-change verification

Revision ID: 0022_platform_user_profile
Revises: 0021_suspension_mode
Create Date: 2026-05-30 09:00:00

Profile settings for the super-admin (platform_users). All nullable /
defaulted so existing rows are unaffected.

Email change is verified: a 6-digit code is mailed to the requested new
address and held in pending_email/email_change_code/email_change_expires_at
until the user enters it; only then does `email` move.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0022_platform_user_profile"
down_revision: Union[str, None] = "0021_suspension_mode"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("platform_users") as batch:
        batch.add_column(sa.Column("first_name", sa.String(120), nullable=True))
        batch.add_column(sa.Column("last_name", sa.String(120), nullable=True))
        batch.add_column(sa.Column("profile_picture_url", sa.String(512), nullable=True))
        batch.add_column(sa.Column("country", sa.String(80), nullable=True))
        batch.add_column(sa.Column("mobile", sa.String(40), nullable=True))
        batch.add_column(sa.Column("language", sa.String(10), nullable=False, server_default="en"))
        batch.add_column(sa.Column("gender", sa.String(10), nullable=True))  # male | female
        batch.add_column(sa.Column("date_of_birth", sa.Date, nullable=True))
        batch.add_column(sa.Column("slack_member_id", sa.String(40), nullable=True))
        batch.add_column(sa.Column("marital_status", sa.String(20), nullable=True))
        batch.add_column(sa.Column("address", sa.String(255), nullable=True))
        batch.add_column(sa.Column("city", sa.String(120), nullable=True))
        batch.add_column(sa.Column("state", sa.String(120), nullable=True))
        batch.add_column(sa.Column("zip_code", sa.String(20), nullable=True))
        batch.add_column(sa.Column("about", sa.Text, nullable=True))
        batch.add_column(
            sa.Column("receive_email_notifications", sa.Boolean, nullable=False, server_default="true")
        )
        batch.add_column(
            sa.Column("google_calendar_enabled", sa.Boolean, nullable=False, server_default="false")
        )
        # Pending email change (verification).
        batch.add_column(sa.Column("pending_email", sa.String(255), nullable=True))
        batch.add_column(sa.Column("email_change_code", sa.String(12), nullable=True))
        batch.add_column(
            sa.Column("email_change_expires_at", sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("platform_users") as batch:
        for col in (
            "email_change_expires_at",
            "email_change_code",
            "pending_email",
            "google_calendar_enabled",
            "receive_email_notifications",
            "about",
            "zip_code",
            "state",
            "city",
            "address",
            "marital_status",
            "slack_member_id",
            "date_of_birth",
            "gender",
            "language",
            "mobile",
            "country",
            "profile_picture_url",
            "last_name",
            "first_name",
        ):
            batch.drop_column(col)
