"""2FA columns + platform_settings table

Revision ID: 0023_security_2fa_settings
Revises: 0022_platform_user_profile
Create Date: 2026-05-30 12:00:00

Two-factor auth for platform users:
  totp_secret_enc        confirmed TOTP secret (Fernet-encrypted JSONB)
  totp_pending_enc       secret during setup, before the first code confirms
  totp_enabled           Google-Authenticator 2FA active
  email_2fa_enabled      email-code 2FA active
  login_2fa_code         transient email login code
  login_2fa_expires_at   its expiry

platform_settings: generic singleton key→JSONB store (first user:
reCAPTCHA config under key='recaptcha'). Reusable for later settings
chunks so we don't add a table per feature.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0023_security_2fa_settings"
down_revision: Union[str, None] = "0022_platform_user_profile"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("platform_users") as batch:
        batch.add_column(sa.Column("totp_secret_enc", sa.JSON, nullable=True))
        batch.add_column(sa.Column("totp_pending_enc", sa.JSON, nullable=True))
        batch.add_column(sa.Column("totp_enabled", sa.Boolean, nullable=False, server_default="false"))
        batch.add_column(sa.Column("email_2fa_enabled", sa.Boolean, nullable=False, server_default="false"))
        batch.add_column(sa.Column("login_2fa_code", sa.String(12), nullable=True))
        batch.add_column(sa.Column("login_2fa_expires_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "platform_settings",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.JSON, nullable=False, server_default="{}"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("platform_settings")
    with op.batch_alter_table("platform_users") as batch:
        for col in (
            "login_2fa_expires_at",
            "login_2fa_code",
            "email_2fa_enabled",
            "totp_enabled",
            "totp_pending_enc",
            "totp_secret_enc",
        ):
            batch.drop_column(col)
