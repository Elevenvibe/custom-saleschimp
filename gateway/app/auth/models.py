from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    func,
)
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
