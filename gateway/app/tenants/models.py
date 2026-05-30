from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    dograh_org_id: Mapped[int | None] = mapped_column(Integer, unique=True, nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    owner_email: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default="pending_verification")
    signup_metadata: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    # Branding overrides (org settings page). URL form today; file upload to
    # S3/MinIO ships in a follow-up.
    logo_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    favicon_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # Organization profile (migration 0024). Editable from both the tenant-
    # side Organization Settings page and the super-admin tenant Profile tab.
    company_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(64), nullable=True)
    company_size: Mapped[str | None] = mapped_column(String(32), nullable=True)
    country: Mapped[str | None] = mapped_column(String(64), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    state: Mapped[str | None] = mapped_column(String(120), nullable=True)
    zip_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    about: Mapped[str | None] = mapped_column(String, nullable=True)
    # JSONB grab-bag for the redesigned tenant settings page — app prefs,
    # currency choice, notification overrides. Migration 0030.
    tenant_settings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    # Tenant-side cap on concurrent calls. NULL → use package default; ints
    # are validated against the package's concurrency_included in the service
    # layer so a tenant can only dial DOWN their own ceiling.
    concurrent_calls_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # When true, new assistants in this org get fallback providers wired in.
    # Off by default; explicit opt-in by tenant or super-admin.
    auto_fallback_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    # Suspension metadata (migration 0020). Holds the CURRENT suspension;
    # cleared on unsuspend. Permanent history lives in the audit log.
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    suspended_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    suspension_subject: Mapped[str | None] = mapped_column(String(64), nullable=True)
    suspension_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    suspension_ticket_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 'delayed' (block on next visit) | 'kill_live' (boot open sessions now).
    suspension_mode: Mapped[str] = mapped_column(String(16), nullable=False, server_default="delayed")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TenantMember(Base):
    __tablename__ = "tenant_members"
    __table_args__ = (UniqueConstraint("tenant_id", "email", name="uq_tenant_member_email"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    dograh_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    invited_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Invite(Base):
    __tablename__ = "invites"
    __table_args__ = (Index("ix_invites_tenant_email", "tenant_id", "email"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    invited_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
