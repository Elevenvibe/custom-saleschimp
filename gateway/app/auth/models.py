from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PlatformUser(Base):
    """Super-admin and staff users. Lives only in the Control DB; never has a
    Dograh user counterpart."""

    __tablename__ = "platform_users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Profile fields (migration 0022).
    first_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    profile_picture_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    country: Mapped[str | None] = mapped_column(String(80), nullable=True)
    mobile: Mapped[str | None] = mapped_column(String(40), nullable=True)
    language: Mapped[str] = mapped_column(String(10), nullable=False, server_default="en")
    gender: Mapped[str | None] = mapped_column(String(10), nullable=True)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    slack_member_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    marital_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    state: Mapped[str | None] = mapped_column(String(120), nullable=True)
    zip_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    about: Mapped[str | None] = mapped_column(Text, nullable=True)
    receive_email_notifications: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    google_calendar_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    # Pending email change (verification).
    pending_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_change_code: Mapped[str | None] = mapped_column(String(12), nullable=True)
    email_change_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Two-factor auth (migration 0023). Secrets are Fernet-encrypted JSONB.
    totp_secret_enc: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    totp_pending_enc: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    email_2fa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    login_2fa_code: Mapped[str | None] = mapped_column(String(12), nullable=True)
    login_2fa_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class PlatformSetting(Base):
    """Generic singleton key→JSONB settings store (reCAPTCHA today; reusable
    for future settings chunks)."""

    __tablename__ = "platform_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SuperAdminPermission(Base):
    """Per-feature permission grant for a platform user. See migration
    0018_super_admin_permissions. Absence of a row = not granted. The
    'owner' (bootstrapped super-admin email) is resolved in code and
    implicitly has every feature."""

    __tablename__ = "super_admin_permissions"
    __table_args__ = (
        UniqueConstraint("platform_user_id", "feature", name="uq_super_admin_permission"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    platform_user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("platform_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    feature: Mapped[str] = mapped_column(String(64), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
