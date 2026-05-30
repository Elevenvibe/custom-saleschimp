"""Seed Settings — config, catalog refresh, seeding, demo reset, lockdown.

Three concerns:

  Config         platform_settings['seed'] holds operator choices
                 (demo_tenant_id, demo_reset_hours, demo_crud_enabled,
                 seed_source_tenant_id).

  Catalog        seed_tables is the discovered list of seedable tables.
                 refresh_catalog() introspects both DBs for any table with a
                 tenant_id / organization_id column and upserts the catalog.
                 New tables that appear when the app rolls out a feature are
                 picked up by the cron automatically.

  Apply          seed_new_tenant(tenant_id) clones rows from the source
                 tenant for each ENABLED catalog table. Best-effort per table:
                 a failure on one table does not block the others.

  Demo reset     reset_demo_tenant() wipes (TRUNCATEs by tenant_id) every
                 catalog table for the demo tenant, then re-seeds it. Driven
                 by the demo_reset cron.

  Lockdown       is_demo_locked(claims) is the gate the suspension-style
                 middleware uses to 403 writes on the demo tenant when CRUD
                 is disabled.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import structlog
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.auth.models import PlatformSetting
from app.config import settings
from app.db import SessionLocal
from app.seed.models import SeedTable
from app.tenants.models import Tenant

log = structlog.get_logger()

_KEY = "seed"

# Tables we never seed even if they have a tenant_id column — they're either
# audit/log surfaces (history isn't shared between tenants), encrypted token
# stores, or the tenant identity itself.
_EXCLUDE_CONTROL = {
    "tenants",
    "tenant_members",
    "invites",
    "audit_log",
    "audit_logs",
    "google_links",  # encrypted per-tenant OAuth tokens
    "contacts",  # imported per tenant
    "support_tickets",
    "support_ticket_messages",
    "notifications",
    "custom_field_values",  # values are per-record, not seed defaults
    "wallets",
    "wallet_ledger",
    "payment_intents",
    "payment_methods",
    "usage_records",
}

# Dograh tables to skip when cloning. Workflows + their runs are big +
# referenced by many rows; cloning needs Dograh-specific logic and is a
# follow-up. We still LIST them in the catalog so operators see them.
_EXCLUDE_DOGRAH = {
    "workflow_runs",
    "users",
    "organizations",
    "alembic_version",
}


# ---- config storage --------------------------------------------------------


def _default_config() -> dict[str, Any]:
    return {
        "demo_enabled": False,
        "demo_tenant_id": None,
        "demo_reset_hours": 6,
        "demo_crud_enabled": True,
        "seed_source_tenant_id": None,
        "last_refresh_at": None,
        "last_reset_at": None,
    }


async def get_config(session: AsyncSession) -> dict[str, Any]:
    row = (
        await session.execute(select(PlatformSetting).where(PlatformSetting.key == _KEY))
    ).scalar_one_or_none()
    cfg = _default_config()
    if row and row.value:
        cfg.update(dict(row.value))
    return cfg


async def save_config(session: AsyncSession, value: dict[str, Any]) -> None:
    row = (
        await session.execute(select(PlatformSetting).where(PlatformSetting.key == _KEY))
    ).scalar_one_or_none()
    if row is None:
        session.add(PlatformSetting(key=_KEY, value=value))
    else:
        row.value = value


# ---- Dograh DB access ------------------------------------------------------

_dograh_engine: AsyncEngine | None = None
_DograhSession: async_sessionmaker[AsyncSession] | None = None


def _dograh() -> async_sessionmaker[AsyncSession]:
    """Lazy Dograh DB sessionmaker. The gateway already has a dograh URL in
    config (set via DOGRAH_DATABASE_URL). NullPool keeps things safe across
    workers / event loops."""
    global _dograh_engine, _DograhSession
    if _DograhSession is None:
        from sqlalchemy.pool import NullPool

        _dograh_engine = create_async_engine(
            settings.dograh_database_url, poolclass=NullPool, future=True
        )
        _DograhSession = async_sessionmaker(_dograh_engine, expire_on_commit=False)
    return _DograhSession


# ---- catalog refresh -------------------------------------------------------


async def _introspect(
    session: AsyncSession, schema_label: str, scope_columns: tuple[str, ...]
) -> list[dict[str, str]]:
    """Return every table in the connected DB that has one of `scope_columns`.

    schema_label is just the label we store on seed_tables.schema so the UI
    can group; the actual SQL schema is the connected DB's `public`.
    """
    cols_in = ", ".join(f"'{c}'" for c in scope_columns)
    q = text(
        f"""
        SELECT c.table_name AS name, c.column_name AS scope
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE c.table_schema = 'public'
           AND t.table_type = 'BASE TABLE'
           AND c.column_name IN ({cols_in})
        """
    )
    rows = (await session.execute(q)).all()
    return [{"name": r.name, "scope": r.scope} for r in rows]


async def refresh_catalog(session: AsyncSession) -> dict[str, int]:
    """Introspect both DBs and upsert seed_tables. Returns a small summary."""
    added = updated = 0
    now = datetime.now(timezone.utc)

    # Control DB (the session passed in).
    control_tables = await _introspect(session, "control", ("tenant_id",))
    for row in control_tables:
        if row["name"] in _EXCLUDE_CONTROL or row["name"].startswith("alembic"):
            continue
        existing = (
            await session.execute(
                select(SeedTable).where(SeedTable.schema == "control", SeedTable.name == row["name"])
            )
        ).scalar_one_or_none()
        if existing is None:
            session.add(
                SeedTable(
                    schema="control",
                    name=row["name"],
                    scope_column=row["scope"],
                    last_seen_at=now,
                )
            )
            added += 1
        else:
            existing.last_seen_at = now
            existing.scope_column = row["scope"]
            updated += 1

    # Dograh DB.
    try:
        async with _dograh()() as ds:
            dograh_tables = await _introspect(ds, "dograh", ("organization_id",))
        for row in dograh_tables:
            if row["name"] in _EXCLUDE_DOGRAH:
                continue
            existing = (
                await session.execute(
                    select(SeedTable).where(SeedTable.schema == "dograh", SeedTable.name == row["name"])
                )
            ).scalar_one_or_none()
            if existing is None:
                session.add(
                    SeedTable(
                        schema="dograh",
                        name=row["name"],
                        scope_column=row["scope"],
                        last_seen_at=now,
                    )
                )
                added += 1
            else:
                existing.last_seen_at = now
                existing.scope_column = row["scope"]
                updated += 1
    except Exception as e:  # noqa: BLE001 — dograh DB unreachable in some envs
        log.warning("seed.catalog.dograh_introspect_failed", error=str(e))

    cfg = await get_config(session)
    cfg["last_refresh_at"] = now.isoformat()
    await save_config(session, cfg)
    await session.commit()
    log.info("seed.catalog.refreshed", added=added, updated=updated)
    return {"added": added, "updated": updated}


# ---- seed apply ------------------------------------------------------------


async def _enabled_tables(session: AsyncSession) -> list[SeedTable]:
    return (
        await session.execute(select(SeedTable).where(SeedTable.enabled.is_(True)))
    ).scalars().all()


async def _clone_table_rows(
    *,
    src_session: AsyncSession,
    dst_session: AsyncSession,
    table_name: str,
    scope_column: str,
    src_scope_id: Any,
    dst_scope_id: Any,
) -> int:
    """SELECT every row in `table_name` for src_scope_id, INSERT them with
    dst_scope_id (clearing the PK). Best-effort — schemas that need careful
    re-keying (FKs) will fail and be skipped per table."""
    # Discover columns.
    cols_rows = (
        await src_session.execute(
            text(
                """
                SELECT column_name, is_identity, column_default
                  FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = :t
                 ORDER BY ordinal_position
                """
            ),
            {"t": table_name},
        )
    ).all()
    if not cols_rows:
        return 0
    all_cols = [c.column_name for c in cols_rows]
    # Skip identity / serial PKs (column_default startswith nextval) so the
    # destination gets fresh ids.
    auto_cols = {
        c.column_name
        for c in cols_rows
        if (c.is_identity == "YES")
        or (c.column_default and str(c.column_default).startswith("nextval("))
    }
    insert_cols = [c for c in all_cols if c not in auto_cols]
    select_cols = ", ".join(f'"{c}"' for c in insert_cols)
    src_rows = (
        await src_session.execute(
            text(f'SELECT {select_cols} FROM "{table_name}" WHERE "{scope_column}" = :sid'),
            {"sid": src_scope_id},
        )
    ).mappings().all()
    if not src_rows:
        return 0

    count = 0
    for row in src_rows:
        params = {c: row[c] for c in insert_cols}
        params[scope_column] = dst_scope_id
        placeholders = ", ".join(f":{c}" for c in insert_cols)
        await dst_session.execute(
            text(f'INSERT INTO "{table_name}" ({select_cols}) VALUES ({placeholders})'),
            params,
        )
        count += 1
    return count


async def _seed_one_db(
    *,
    session: AsyncSession,
    schema_label: str,
    src_id: Any,
    dst_id: Any,
) -> dict[str, int]:
    """Seed all enabled tables of one schema (same session for src+dst).
    Catches per-table errors so a bad table doesn't block the rest."""
    if src_id is None or src_id == dst_id:
        return {"tables": 0, "rows": 0}
    tables = (
        await session.execute(
            select(SeedTable).where(SeedTable.enabled.is_(True), SeedTable.schema == schema_label)
        )
    ).scalars().all()
    tables_done = rows_done = 0
    for t in tables:
        try:
            n = await _clone_table_rows(
                src_session=session,
                dst_session=session,
                table_name=t.name,
                scope_column=t.scope_column,
                src_scope_id=src_id,
                dst_scope_id=dst_id,
            )
            rows_done += n
            tables_done += 1
        except Exception as e:  # noqa: BLE001
            log.warning("seed.clone_failed", schema=schema_label, table=t.name, error=str(e))
            await session.rollback()
    return {"tables": tables_done, "rows": rows_done}


async def seed_new_tenant(session: AsyncSession, tenant_id: int) -> dict[str, int]:
    """Apply enabled seeds to a freshly-active tenant. Called from /verify
    (and admin complete-signup). Errors are swallowed per-table; the tenant
    is created either way."""
    cfg = await get_config(session)
    src_tenant_id = cfg.get("seed_source_tenant_id")
    if not src_tenant_id or int(src_tenant_id) == tenant_id:
        return {"tables": 0, "rows": 0}

    # Resolve src + dst Dograh org ids for the dograh-schema seeds.
    src_t = await session.get(Tenant, int(src_tenant_id))
    dst_t = await session.get(Tenant, tenant_id)
    summary = {"control_tables": 0, "control_rows": 0, "dograh_tables": 0, "dograh_rows": 0}

    cs = await _seed_one_db(
        session=session, schema_label="control", src_id=int(src_tenant_id), dst_id=tenant_id
    )
    summary["control_tables"] = cs["tables"]
    summary["control_rows"] = cs["rows"]
    await session.commit()

    if src_t and dst_t and src_t.dograh_org_id and dst_t.dograh_org_id:
        try:
            async with _dograh()() as ds:
                ds_summary = await _seed_one_db(
                    session=ds,
                    schema_label="dograh",
                    src_id=src_t.dograh_org_id,
                    dst_id=dst_t.dograh_org_id,
                )
                await ds.commit()
                summary["dograh_tables"] = ds_summary["tables"]
                summary["dograh_rows"] = ds_summary["rows"]
        except Exception as e:  # noqa: BLE001
            log.warning("seed.dograh_failed", tenant_id=tenant_id, error=str(e))

    log.info("seed.applied", tenant_id=tenant_id, **summary)
    return summary


# ---- demo reset ------------------------------------------------------------


async def reset_demo_tenant(session: AsyncSession) -> dict[str, Any]:
    """Wipe + re-seed the demo tenant's catalog tables. Idempotent."""
    cfg = await get_config(session)
    demo_id = cfg.get("demo_tenant_id")
    if not (cfg.get("demo_enabled") and demo_id):
        return {"skipped": True, "reason": "demo_disabled"}
    demo_id = int(demo_id)
    src_id = cfg.get("seed_source_tenant_id")

    # Wipe control-schema rows.
    control = (
        await session.execute(
            select(SeedTable).where(SeedTable.enabled.is_(True), SeedTable.schema == "control")
        )
    ).scalars().all()
    wiped_control = 0
    for t in control:
        try:
            await session.execute(
                text(f'DELETE FROM "{t.name}" WHERE "{t.scope_column}" = :sid'),
                {"sid": demo_id},
            )
            wiped_control += 1
        except Exception as e:  # noqa: BLE001
            log.warning("seed.demo.wipe_failed", table=t.name, error=str(e))
            await session.rollback()
    await session.commit()

    # Wipe dograh-schema rows.
    wiped_dograh = 0
    demo_t = await session.get(Tenant, demo_id)
    if demo_t and demo_t.dograh_org_id:
        try:
            async with _dograh()() as ds:
                dograh = (
                    await session.execute(
                        select(SeedTable).where(
                            SeedTable.enabled.is_(True), SeedTable.schema == "dograh"
                        )
                    )
                ).scalars().all()
                for t in dograh:
                    try:
                        await ds.execute(
                            text(f'DELETE FROM "{t.name}" WHERE "{t.scope_column}" = :sid'),
                            {"sid": demo_t.dograh_org_id},
                        )
                        wiped_dograh += 1
                    except Exception as e:  # noqa: BLE001
                        log.warning("seed.demo.wipe_failed_dograh", table=t.name, error=str(e))
                await ds.commit()
        except Exception as e:  # noqa: BLE001
            log.warning("seed.demo.dograh_unreachable", error=str(e))

    # Re-seed from source.
    seeded = {"control_tables": 0, "control_rows": 0, "dograh_tables": 0, "dograh_rows": 0}
    if src_id:
        seeded = await seed_new_tenant(session, demo_id)

    cfg["last_reset_at"] = datetime.now(timezone.utc).isoformat()
    await save_config(session, cfg)
    await session.commit()
    summary = {
        "demo_tenant_id": demo_id,
        "wiped_control_tables": wiped_control,
        "wiped_dograh_tables": wiped_dograh,
        "reseeded": seeded,
    }
    log.info("seed.demo.reset", **summary)
    return summary


# ---- demo CRUD lockdown ----------------------------------------------------


async def _config_cached() -> dict[str, Any]:
    """Read config in its own short-lived session — used by middleware."""
    async with SessionLocal() as s:
        return await get_config(s)


async def is_demo_locked_for_tenant(tenant_id: int) -> bool:
    cfg = await _config_cached()
    return bool(
        cfg.get("demo_enabled")
        and cfg.get("demo_tenant_id") == tenant_id
        and not cfg.get("demo_crud_enabled")
    )
