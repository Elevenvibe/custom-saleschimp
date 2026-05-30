"""Seed crons.

Two loops, both cancellable on shutdown:

  catalog_refresh   every settings.seed_catalog_refresh_minutes — picks up
                    newly-added tables (a new feature shipping with a
                    tenant_id column appears in the catalog without any
                    manual nudge).

  demo_reset        every cfg['demo_reset_hours'] (or 6h default) — wipes
                    and re-seeds the demo tenant so it stays clean.

Both no-op when their feature isn't enabled.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import structlog

from app.db import SessionLocal
from app.seed.service import get_config, refresh_catalog, reset_demo_tenant

log = structlog.get_logger()

_catalog_task: asyncio.Task | None = None
_reset_task: asyncio.Task | None = None


async def _catalog_loop(interval_seconds: int) -> None:
    while True:
        try:
            async with SessionLocal() as s:
                await refresh_catalog(s)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            log.warning("seed.catalog.tick_failed", error=str(e))
        await asyncio.sleep(interval_seconds)


async def _reset_loop() -> None:
    while True:
        # Re-read the config every iteration so the operator can change the
        # interval without restarting.
        try:
            async with SessionLocal() as s:
                cfg = await get_config(s)
            hours = max(1, int(cfg.get("demo_reset_hours") or 6))
            if cfg.get("demo_enabled") and cfg.get("demo_tenant_id"):
                last = cfg.get("last_reset_at")
                due = True
                if last:
                    try:
                        last_dt = datetime.fromisoformat(last)
                        due = (datetime.now(timezone.utc) - last_dt).total_seconds() >= hours * 3600
                    except Exception:  # noqa: BLE001
                        due = True
                if due:
                    async with SessionLocal() as s:
                        await reset_demo_tenant(s)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            log.warning("seed.reset.tick_failed", error=str(e))
        # Wake up every 15 minutes; the body decides whether it's time.
        await asyncio.sleep(15 * 60)


async def start_seed_loops(*, catalog_interval_seconds: int = 3600) -> None:
    global _catalog_task, _reset_task
    if _catalog_task is None:
        _catalog_task = asyncio.create_task(_catalog_loop(catalog_interval_seconds))
        log.info("seed.catalog.cron_started", interval_seconds=catalog_interval_seconds)
    if _reset_task is None:
        _reset_task = asyncio.create_task(_reset_loop())
        log.info("seed.demo_reset.cron_started")


async def stop_seed_loops() -> None:
    for t in (_catalog_task, _reset_task):
        if t is not None and not t.done():
            t.cancel()
            try:
                await t
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
