"""Super-admin Seed Settings.

  GET   /api/admin/seed                snapshot (config + summary)
  PUT   /api/admin/seed                save config
  GET   /api/admin/seed/tables          full catalog (grouped by schema)
  PUT   /api/admin/seed/tables/{id}     toggle/enable a single catalog row
  POST  /api/admin/seed/refresh         re-introspect both DBs now
  POST  /api/admin/seed/reset-demo      reset the demo tenant now (manual)
  POST  /api/admin/seed/apply/{tid}     apply seeds to a given tenant now
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.db import get_session
from app.seed.models import SeedTable
from app.seed.service import (
    get_config,
    refresh_catalog,
    reset_demo_tenant,
    save_config,
    seed_new_tenant,
)
from app.tenants.models import Tenant

router = APIRouter(prefix="/seed", tags=["admin:seed"])


def _uid(claims: dict) -> int | None:
    sub = claims.get("sub", "")
    if isinstance(sub, str) and sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            return None
    return None


# ---- snapshot --------------------------------------------------------------


class SeedConfigOut(BaseModel):
    demo_enabled: bool
    demo_tenant_id: int | None
    demo_reset_hours: int
    demo_crud_enabled: bool
    seed_source_tenant_id: int | None
    last_refresh_at: str | None
    last_reset_at: str | None


class TenantRef(BaseModel):
    id: int
    name: str
    slug: str


class SeedSnapshot(BaseModel):
    config: SeedConfigOut
    tenants: list[TenantRef]
    enabled_table_count: int
    total_table_count: int


@router.get("", response_model=SeedSnapshot)
async def get_seed(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SeedSnapshot:
    cfg = await get_config(session)
    tenants = (
        await session.execute(select(Tenant).order_by(Tenant.name))
    ).scalars().all()
    total = (await session.execute(select(SeedTable))).scalars().all()
    enabled = [t for t in total if t.enabled]
    return SeedSnapshot(
        config=SeedConfigOut(**cfg),
        tenants=[TenantRef(id=t.id, name=t.name, slug=t.slug) for t in tenants],
        enabled_table_count=len(enabled),
        total_table_count=len(total),
    )


class SeedConfigIn(BaseModel):
    demo_enabled: bool
    demo_tenant_id: int | None = None
    demo_reset_hours: int = 6
    demo_crud_enabled: bool = True
    seed_source_tenant_id: int | None = None


@router.put("", response_model=SeedSnapshot)
async def put_seed(
    body: SeedConfigIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SeedSnapshot:
    if body.demo_enabled and body.demo_tenant_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "demo_tenant_id is required when demo_enabled is true",
        )
    if body.demo_reset_hours < 1 or body.demo_reset_hours > 24 * 7:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "demo_reset_hours must be 1..168")

    cfg = await get_config(session)
    cfg.update(body.model_dump())
    await save_config(session, cfg)
    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.seed.config_update", target_kind="platform_setting",
        target_id="seed", payload={"demo_enabled": body.demo_enabled},
    )
    await session.commit()
    return await get_seed(_claims=claims, session=session)


# ---- catalog ---------------------------------------------------------------


class CatalogRow(BaseModel):
    id: int
    schema: str
    name: str
    scope_column: str
    description: str | None
    enabled: bool
    last_seen_at: str


@router.get("/tables", response_model=list[CatalogRow])
async def list_tables(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[CatalogRow]:
    rows = (
        await session.execute(select(SeedTable).order_by(SeedTable.schema, SeedTable.name))
    ).scalars().all()
    return [
        CatalogRow(
            id=r.id, schema=r.schema, name=r.name, scope_column=r.scope_column,
            description=r.description, enabled=r.enabled,
            last_seen_at=r.last_seen_at.isoformat(),
        )
        for r in rows
    ]


class TablePatchIn(BaseModel):
    enabled: bool | None = None
    description: str | None = None


@router.put("/tables/{table_id}", response_model=CatalogRow)
async def patch_table(
    table_id: int,
    body: TablePatchIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CatalogRow:
    row = await session.get(SeedTable, table_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "table not found")
    if body.enabled is not None:
        row.enabled = body.enabled
    if body.description is not None:
        row.description = body.description.strip() or None
    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.seed.table_toggle", target_kind="seed_table",
        target_id=str(row.id), payload={"enabled": row.enabled},
    )
    await session.commit()
    return CatalogRow(
        id=row.id, schema=row.schema, name=row.name, scope_column=row.scope_column,
        description=row.description, enabled=row.enabled,
        last_seen_at=row.last_seen_at.isoformat(),
    )


@router.post("/refresh")
async def refresh_now(
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, Any]:
    summary = await refresh_catalog(session)
    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.seed.refresh", target_kind="seed_catalog",
        target_id="-", payload=summary,
    )
    await session.commit()
    return summary


@router.post("/reset-demo")
async def reset_demo_now(
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, Any]:
    summary = await reset_demo_tenant(session)
    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.seed.reset_demo", target_kind="tenant",
        target_id=str(summary.get("demo_tenant_id") or "-"), payload=summary,
    )
    await session.commit()
    return summary


@router.post("/apply/{tenant_id}")
async def apply_to_tenant(
    tenant_id: int,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, Any]:
    if (await session.get(Tenant, tenant_id)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant not found")
    summary = await seed_new_tenant(session, tenant_id)
    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.seed.apply", target_kind="tenant",
        target_id=str(tenant_id), payload=summary,
    )
    await session.commit()
    return summary
