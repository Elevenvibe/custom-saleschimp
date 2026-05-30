"""Super-admin custom-field builder.

  GET    /api/admin/custom-fields/entities        placement catalog
  GET    /api/admin/custom-fields?entity=          list definitions
  POST   /api/admin/custom-fields                  create a field
  PATCH  /api/admin/custom-fields/{id}             update a field
  DELETE /api/admin/custom-fields/{id}             delete a field (+ its values)
  POST   /api/admin/custom-fields/reorder          set sort order
  GET    /api/admin/custom-fields/values            defs + values for a record
  PUT    /api/admin/custom-fields/values            save values for a record

Definitions are scoped to a placement `entity`; values are keyed by
(field_id, entity_id) so any surface can render + persist via the shared
values API.
"""

from __future__ import annotations

import re
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.custom_fields.models import CustomField, CustomFieldValue
from app.db import get_session

router = APIRouter(prefix="/custom-fields", tags=["admin:custom-fields"])

# Placements a field can attach to. Keep in sync with the consumer surfaces.
ENTITIES: list[dict[str, str]] = [
    {"key": "tenant", "label": "Tenant (organization)"},
    {"key": "tenant_member", "label": "Tenant user"},
    {"key": "workflow", "label": "Agent / workflow"},
    {"key": "global", "label": "Platform-wide"},
]
_ENTITY_KEYS = {e["key"] for e in ENTITIES}

FIELD_TYPES = [
    "text",
    "textarea",
    "number",
    "boolean",
    "select",
    "multiselect",
    "date",
    "email",
    "url",
]
_OPTION_TYPES = {"select", "multiselect"}


def _slugify(label: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
    return s[:64] or "field"


# ---- IO shapes ------------------------------------------------------------


class Option(BaseModel):
    value: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=128)


class FieldOut(BaseModel):
    id: int
    entity: str
    key: str
    label: str
    field_type: str
    options: list[Option]
    required: bool
    help_text: str | None
    placeholder: str | None
    sort_order: int
    active: bool


def _serialize(f: CustomField) -> FieldOut:
    return FieldOut(
        id=f.id,
        entity=f.entity,
        key=f.key,
        label=f.label,
        field_type=f.field_type,
        options=[Option(**o) for o in (f.options or [])],
        required=f.required,
        help_text=f.help_text,
        placeholder=f.placeholder,
        sort_order=f.sort_order,
        active=f.active,
    )


class FieldCreateIn(BaseModel):
    entity: str
    label: str = Field(min_length=1, max_length=128)
    field_type: str
    key: str | None = None
    options: list[Option] = []
    required: bool = False
    help_text: str | None = Field(default=None, max_length=255)
    placeholder: str | None = Field(default=None, max_length=128)
    active: bool = True


class FieldPatchIn(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=128)
    field_type: str | None = None
    options: list[Option] | None = None
    required: bool | None = None
    help_text: str | None = Field(default=None, max_length=255)
    placeholder: str | None = Field(default=None, max_length=128)
    active: bool | None = None


def _uid(claims: dict) -> int | None:
    sub = claims.get("sub", "")
    if isinstance(sub, str) and sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            return None
    return None


def _validate_type(field_type: str, options: list[Option]) -> None:
    if field_type not in FIELD_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unknown field_type '{field_type}'")
    if field_type in _OPTION_TYPES and not options:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"{field_type} fields need at least one option"
        )


# ---- catalog --------------------------------------------------------------


@router.get("/entities")
async def list_entities(
    _claims: Annotated[dict, Depends(require_super_admin)],
) -> dict:
    return {"entities": ENTITIES, "field_types": FIELD_TYPES}


# ---- definitions ----------------------------------------------------------


@router.get("", response_model=list[FieldOut])
async def list_fields(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    entity: str | None = Query(None),
) -> list[FieldOut]:
    stmt = select(CustomField)
    if entity:
        stmt = stmt.where(CustomField.entity == entity)
    stmt = stmt.order_by(CustomField.entity, CustomField.sort_order, CustomField.id)
    rows = (await session.execute(stmt)).scalars().all()
    return [_serialize(f) for f in rows]


@router.post("", response_model=FieldOut, status_code=status.HTTP_201_CREATED)
async def create_field(
    body: FieldCreateIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> FieldOut:
    if body.entity not in _ENTITY_KEYS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unknown entity '{body.entity}'")
    _validate_type(body.field_type, body.options)
    key = _slugify(body.key or body.label)

    # Next sort_order within the entity.
    existing = (
        await session.execute(
            select(CustomField.sort_order)
            .where(CustomField.entity == body.entity)
            .order_by(CustomField.sort_order.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    next_order = (existing or 0) + 1

    f = CustomField(
        entity=body.entity,
        key=key,
        label=body.label.strip(),
        field_type=body.field_type,
        options=[o.model_dump() for o in body.options] if body.field_type in _OPTION_TYPES else [],
        required=body.required,
        help_text=body.help_text,
        placeholder=body.placeholder,
        sort_order=next_order,
        active=body.active,
    )
    session.add(f)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"a field with key '{key}' already exists for {body.entity}"
        ) from None
    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.custom_field.create", target_kind="custom_field",
        target_id=str(f.id), payload={"entity": f.entity, "key": f.key, "type": f.field_type},
    )
    await session.commit()
    return _serialize(f)


@router.patch("/{field_id}", response_model=FieldOut)
async def update_field(
    field_id: int,
    body: FieldPatchIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> FieldOut:
    f = await session.get(CustomField, field_id)
    if f is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "field not found")

    new_type = body.field_type if body.field_type is not None else f.field_type
    new_options = body.options if body.options is not None else [Option(**o) for o in (f.options or [])]
    if body.field_type is not None or body.options is not None:
        _validate_type(new_type, new_options)

    if body.label is not None:
        f.label = body.label.strip()
    if body.field_type is not None:
        f.field_type = body.field_type
    if body.field_type is not None or body.options is not None:
        f.options = [o.model_dump() for o in new_options] if new_type in _OPTION_TYPES else []
    if body.required is not None:
        f.required = body.required
    if body.help_text is not None:
        f.help_text = body.help_text or None
    if body.placeholder is not None:
        f.placeholder = body.placeholder or None
    if body.active is not None:
        f.active = body.active

    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.custom_field.update", target_kind="custom_field",
        target_id=str(f.id), payload={"entity": f.entity, "key": f.key},
    )
    await session.commit()
    return _serialize(f)


@router.delete("/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_field(
    field_id: int,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    f = await session.get(CustomField, field_id)
    if f is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "field not found")
    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.custom_field.delete", target_kind="custom_field",
        target_id=str(f.id), payload={"entity": f.entity, "key": f.key},
    )
    await session.delete(f)  # values cascade via FK
    await session.commit()


class ReorderIn(BaseModel):
    entity: str
    ids: list[int] = Field(min_length=1)


@router.post("/reorder", response_model=list[FieldOut])
async def reorder_fields(
    body: ReorderIn,
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[FieldOut]:
    rows = (
        await session.execute(select(CustomField).where(CustomField.entity == body.entity))
    ).scalars().all()
    by_id = {f.id: f for f in rows}
    order = 0
    for fid in body.ids:
        f = by_id.get(fid)
        if f is not None:
            order += 1
            f.sort_order = order
    await session.commit()
    rows = (
        await session.execute(
            select(CustomField)
            .where(CustomField.entity == body.entity)
            .order_by(CustomField.sort_order, CustomField.id)
        )
    ).scalars().all()
    return [_serialize(f) for f in rows]


# ---- values ---------------------------------------------------------------


class ValuesOut(BaseModel):
    entity: str
    entity_id: str
    fields: list[FieldOut]
    # field_id -> serialized value
    values: dict[int, str | None]


@router.get("/values", response_model=ValuesOut)
async def get_values(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    entity: str = Query(...),
    entity_id: str = Query(...),
) -> ValuesOut:
    fields = (
        await session.execute(
            select(CustomField)
            .where(CustomField.entity == entity, CustomField.active.is_(True))
            .order_by(CustomField.sort_order, CustomField.id)
        )
    ).scalars().all()
    rows = (
        await session.execute(
            select(CustomFieldValue).where(
                CustomFieldValue.entity == entity, CustomFieldValue.entity_id == entity_id
            )
        )
    ).scalars().all()
    values = {r.field_id: r.value for r in rows}
    return ValuesOut(
        entity=entity,
        entity_id=entity_id,
        fields=[_serialize(f) for f in fields],
        values={f.id: values.get(f.id) for f in fields},
    )


class ValuesIn(BaseModel):
    entity: str
    entity_id: str
    # field_id -> value (string; multiselect sent as JSON array string)
    values: dict[int, str | None]


@router.put("/values", response_model=ValuesOut)
async def put_values(
    body: ValuesIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ValuesOut:
    # Only accept values for fields that actually belong to this entity.
    fields = (
        await session.execute(
            select(CustomField).where(CustomField.entity == body.entity)
        )
    ).scalars().all()
    valid_ids = {f.id for f in fields}

    existing = {
        r.field_id: r
        for r in (
            await session.execute(
                select(CustomFieldValue).where(
                    CustomFieldValue.entity == body.entity,
                    CustomFieldValue.entity_id == body.entity_id,
                )
            )
        ).scalars().all()
    }

    for field_id, raw in body.values.items():
        if field_id not in valid_ids:
            continue
        val = (raw if raw is not None else "") or None
        row = existing.get(field_id)
        if row is None:
            session.add(
                CustomFieldValue(
                    field_id=field_id,
                    entity=body.entity,
                    entity_id=body.entity_id,
                    value=val,
                )
            )
        else:
            row.value = val

    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.custom_field.values", target_kind=body.entity,
        target_id=body.entity_id, payload={"count": len(body.values)},
    )
    await session.commit()
    return await get_values(  # type: ignore[return-value]
        _claims=claims, session=session, entity=body.entity, entity_id=body.entity_id
    )
