"""initial control db schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-05-25 02:00:00

Creates the full Control DB schema described in docs/saas-architecture.md §6
and §11.5. Tables are created up-front (not iteratively per phase) so the
schema is one declarative source of truth from the start. Per-phase code adds
behavior, not tables.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Identity: platform users (super-admins) ---
    op.create_table(
        "platform_users",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),  # super_admin | super_admin_staff
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "platform_users_role_check",
        "platform_users",
        "role IN ('super_admin', 'super_admin_staff')",
    )

    # --- Tenants (1:1 mirror of dograh.organizations) ---
    op.create_table(
        "tenants",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("dograh_org_id", sa.Integer, nullable=True, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(64), nullable=False, unique=True),
        sa.Column("owner_email", sa.String(255), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending_verification"),
        sa.Column("signup_metadata", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_check_constraint(
        "tenants_status_check",
        "tenants",
        "status IN ('pending_verification', 'active', 'suspended', 'cancelled')",
    )

    op.create_table(
        "tenant_members",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.BigInteger, sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("dograh_user_id", sa.Integer, nullable=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("invited_by", sa.BigInteger, nullable=True),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "email", name="uq_tenant_member_email"),
    )
    op.create_check_constraint(
        "tenant_members_role_check",
        "tenant_members",
        "role IN ('org_owner', 'org_admin', 'org_member')",
    )

    op.create_table(
        "invites",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.BigInteger, sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("token_hash", sa.String(128), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("invited_by_user_id", sa.BigInteger, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_invites_tenant_email", "invites", ["tenant_id", "email"])

    # --- Packages & entitlements ---
    op.create_table(
        "packages",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("slug", sa.String(64), nullable=False, unique=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("monthly_price_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("limits", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "package_plugins",
        sa.Column("package_id", sa.BigInteger, sa.ForeignKey("packages.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("plugin_id", sa.String(128), primary_key=True),
    )

    op.create_table(
        "tenant_packages",
        sa.Column("tenant_id", sa.BigInteger, sa.ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("package_id", sa.BigInteger, sa.ForeignKey("packages.id"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(32), nullable=False, server_default="manual"),
    )
    op.create_check_constraint(
        "tenant_packages_source_check",
        "tenant_packages",
        "source IN ('manual', 'stripe', 'trial')",
    )

    op.create_table(
        "tenant_plugin_overrides",
        sa.Column("tenant_id", sa.BigInteger, sa.ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("plugin_id", sa.String(128), primary_key=True),
        sa.Column("granted_by", sa.BigInteger, nullable=True),
        sa.Column("granted_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("note", sa.Text, nullable=True),
    )

    # --- Plugin lifecycle ---
    op.create_table(
        "installed_plugins",
        sa.Column("plugin_id", sa.String(128), primary_key=True),
        sa.Column("version", sa.String(64), nullable=False),
        sa.Column("manifest", postgresql.JSONB, nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="installed"),
        sa.Column("installed_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_check_constraint(
        "installed_plugins_status_check",
        "installed_plugins",
        "status IN ('installed', 'active', 'inactive', 'broken')",
    )

    op.create_table(
        "plugin_tenant_config",
        sa.Column("tenant_id", sa.BigInteger, sa.ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("plugin_id", sa.String(128), primary_key=True),
        sa.Column("config", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # --- Multi-provider email (§11.5) ---
    op.create_table(
        "email_provider_configs",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("scope_kind", sa.String(16), nullable=False),  # 'platform' | 'tenant'
        sa.Column("scope_id", sa.BigInteger, nullable=True),  # tenant_id when scope='tenant'
        sa.Column("provider", sa.String(32), nullable=False),  # resend | ses | postmark | smtp
        sa.Column("config_encrypted", postgresql.JSONB, nullable=False),
        sa.Column("from_email", sa.String(255), nullable=False),
        sa.Column("from_name", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_check_constraint(
        "email_provider_scope_check",
        "email_provider_configs",
        "scope_kind IN ('platform', 'tenant')",
    )
    op.create_check_constraint(
        "email_provider_provider_check",
        "email_provider_configs",
        "provider IN ('resend', 'ses', 'postmark', 'smtp')",
    )
    # Only one active config per (scope_kind, scope_id).
    op.create_index(
        "uq_email_provider_active_per_scope",
        "email_provider_configs",
        ["scope_kind", "scope_id"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
    )

    # --- Audit log ---
    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("actor_user_id", sa.BigInteger, nullable=True),
        sa.Column("actor_kind", sa.String(32), nullable=False),  # platform | tenant | system
        sa.Column("action", sa.String(128), nullable=False),
        sa.Column("target_kind", sa.String(64), nullable=True),
        sa.Column("target_id", sa.String(128), nullable=True),
        sa.Column("payload", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("ip", sa.String(64), nullable=True),
        sa.Column("ua", sa.String(512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_audit_created_at", "audit_log", ["created_at"])
    op.create_index("ix_audit_actor", "audit_log", ["actor_kind", "actor_user_id"])


def downgrade() -> None:
    # Initial migration: full drop in reverse dependency order.
    for table in (
        "audit_log",
        "email_provider_configs",
        "plugin_tenant_config",
        "installed_plugins",
        "tenant_plugin_overrides",
        "tenant_packages",
        "package_plugins",
        "packages",
        "invites",
        "tenant_members",
        "tenants",
        "platform_users",
    ):
        op.drop_table(table)
