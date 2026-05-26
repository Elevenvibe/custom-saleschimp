"""Auto-reload sweep.

Walks every tenant whose `wallets.auto_reload_enabled` is true, checks
balance against threshold, and if below, asks the payments service to
charge their default method. The provider adapters short-circuit when
the provider isn't configured, so leaving e.g. Paystack unconfigured
on a Stripe-only deployment is safe — those tenants get a `not
configured` log line and stay below threshold until they switch methods.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.payments import service as payments_service
from app.wallet.models import Wallet

log = structlog.get_logger()

_task: asyncio.Task | None = None
_last_run: dict[str, Any] = {"at": None, "checked": 0, "reloaded": 0}


def get_status() -> dict[str, Any]:
    return {
        "enabled": settings.auto_reload_enabled,
        "interval_seconds": settings.auto_reload_interval_seconds,
        "running": _task is not None and not _task.done(),
        "last_run_at": _last_run["at"].isoformat() if _last_run["at"] else None,
        "last_checked": _last_run["checked"],
        "last_reloaded": _last_run["reloaded"],
    }


async def start_auto_reload_loop() -> None:
    global _task
    if not settings.auto_reload_enabled:
        log.info("auto_reload.disabled")
        return
    if _task is not None and not _task.done():
        return
    _task = asyncio.create_task(_loop())
    log.info("auto_reload.started", interval_s=settings.auto_reload_interval_seconds)


async def stop_auto_reload_loop() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except asyncio.CancelledError:
        pass
    _task = None
    log.info("auto_reload.stopped")


async def run_once() -> dict[str, int]:
    checked = 0
    reloaded = 0
    async with SessionLocal() as session:
        wallets = (
            await session.execute(
                select(Wallet).where(Wallet.auto_reload_enabled.is_(True))
            )
        ).scalars().all()
        for wallet in wallets:
            checked += 1
            try:
                outcome = await payments_service.try_auto_reload(session, wallet)
                if outcome == "reloaded":
                    reloaded += 1
                await session.commit()
            except Exception as e:  # noqa: BLE001
                log.warning(
                    "auto_reload.wallet_failed",
                    tenant_id=wallet.tenant_id,
                    error=str(e),
                )
                await session.rollback()
    _last_run["at"] = datetime.now(UTC)
    _last_run["checked"] = checked
    _last_run["reloaded"] = reloaded
    log.info("auto_reload.iteration_done", checked=checked, reloaded=reloaded)
    return {"checked": checked, "reloaded": reloaded}


async def _loop() -> None:
    await asyncio.sleep(min(15, settings.auto_reload_interval_seconds))
    while True:
        try:
            await run_once()
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            log.warning("auto_reload.iteration_failed", error=str(e))
        try:
            await asyncio.sleep(settings.auto_reload_interval_seconds)
        except asyncio.CancelledError:
            raise
