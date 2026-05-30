"""Seed Settings — catalog of seedable tables.

`seed_tables` is the discovered catalog the cron refreshes by introspecting
both databases:
  - schema='control'  → gateway DB tables that carry a `tenant_id` FK
  - schema='dograh'    → Dograh DB tables that carry an `organization_id` FK

Each row remembers whether the super-admin enabled seeding it onto new
tenants. Config (demo tenant, reset interval, CRUD lock, source tenant)
lives separately in platform_settings['seed'].
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class SeedTable(Base):
    __tablename__ = "seed_tables"
    __table_args__ = (UniqueConstraint("schema", "name", name="uq_seed_table_schema_name"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # 'control' (gateway DB) or 'dograh'.
    schema: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    # The column the rows are keyed by for the tenant ('tenant_id' for control,
    # 'organization_id' for dograh).
    scope_column: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    # Detected on first sight; lets us hide tables the catalog hasn't seen
    # in a while if a refresh stops listing them.
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
