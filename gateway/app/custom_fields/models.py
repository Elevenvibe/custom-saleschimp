"""Custom fields — admin-designed fields attachable to platform surfaces.

Two tables:
  custom_fields        the field DEFINITIONS (label, type, options, …) scoped
                       to a placement `entity` (tenant / member / workflow /
                       global). Unique (entity, key).
  custom_field_values  the VALUES, keyed by (field_id, entity_id) so any
                       surface can read/write the field for a given record.

The split lets a super-admin design a field once and have every consumer
(admin-ui 3020, gateway/console 8080, unified Dograh 8081) render + persist
it through the shared values API.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class CustomField(Base):
    __tablename__ = "custom_fields"
    __table_args__ = (
        UniqueConstraint("entity", "key", name="uq_custom_field_entity_key"),
        Index("ix_custom_fields_entity", "entity", "active", "sort_order"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # Placement: which kind of record this field attaches to.
    entity: Mapped[str] = mapped_column(String(48), nullable=False)
    # Stable machine key (slug) used by consumers; unique within an entity.
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    # text | textarea | number | boolean | select | multiselect | date | email | url
    field_type: Mapped[str] = mapped_column(String(24), nullable=False)
    # For select/multiselect: list of {"value": str, "label": str}.
    options: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    help_text: Mapped[str | None] = mapped_column(String(255), nullable=True)
    placeholder: Mapped[str | None] = mapped_column(String(128), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class CustomFieldValue(Base):
    __tablename__ = "custom_field_values"
    __table_args__ = (
        UniqueConstraint("field_id", "entity_id", name="uq_custom_field_value"),
        Index("ix_custom_field_values_lookup", "entity", "entity_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    field_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("custom_fields.id", ondelete="CASCADE"), nullable=False
    )
    # Denormalized for index-only lookups by surface.
    entity: Mapped[str] = mapped_column(String(48), nullable=False)
    # String so any id space works (tenant id, dograh user id, workflow uuid…).
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # Serialized value: scalars as text, multiselect as JSON array string.
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
