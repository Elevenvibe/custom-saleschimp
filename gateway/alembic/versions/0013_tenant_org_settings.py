"""tenant org-settings columns

Revision ID: 0013_tenant_org_settings
Revises: 0012_plugin_marketplace
Create Date: 2026-05-27 18:00:00

Four new columns on `tenants` so the customer Organization Settings
page has something to read + write:

  logo_url           — branding asset shown in the console + on
                       customer-facing pages. Free-form URL today;
                       file upload to S3/MinIO is a follow-up.

  favicon_url        — same shape, separate field because favicons
                       are typically a smaller dedicated asset.

  concurrent_calls_limit — INT NULL. When null, the tenant uses the
                       full concurrency_included on their package.
                       Setting it lets the tenant dial DOWN their
                       own ceiling (1 → package_concurrency_included).
                       Setting above the package limit is rejected
                       in the service layer.

  auto_fallback_enabled — BOOL. When true, new assistants created in
                       this org automatically get fallback providers
                       wired in for STT/TTS/LLM/embedding/transcriber.
                       Default false; turning it on is a tenant +
                       super-admin opt-in.

All four are nullable / have safe defaults so existing tenants are
unaffected (they read the package defaults via the GET endpoint).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013_tenant_org_settings"
down_revision: Union[str, None] = "0012_plugin_marketplace"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("tenants") as batch:
        batch.add_column(sa.Column("logo_url", sa.String(512), nullable=True))
        batch.add_column(sa.Column("favicon_url", sa.String(512), nullable=True))
        batch.add_column(
            sa.Column("concurrent_calls_limit", sa.Integer, nullable=True)
        )
        batch.add_column(
            sa.Column(
                "auto_fallback_enabled",
                sa.Boolean,
                nullable=False,
                server_default="false",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("tenants") as batch:
        batch.drop_column("auto_fallback_enabled")
        batch.drop_column("concurrent_calls_limit")
        batch.drop_column("favicon_url")
        batch.drop_column("logo_url")
