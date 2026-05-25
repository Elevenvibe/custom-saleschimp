from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Package(Base):
    __tablename__ = "packages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    monthly_price_cents: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    limits: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PackagePlugin(Base):
    __tablename__ = "package_plugins"

    package_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("packages.id", ondelete="CASCADE"), primary_key=True
    )
    plugin_id: Mapped[str] = mapped_column(String(128), primary_key=True)
