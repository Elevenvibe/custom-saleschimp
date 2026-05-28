"""Background IMAP fetch loop.

Opt-in via `MAIL_FETCHER_ENABLED=true`. Walks every mailbox_configs row
with imap_active=true and pulls new messages via app.mailbox.service.
fetch_one. Same shape as fx/cron.py: a single asyncio task started in
lifespan, broken cleanly on shutdown.

One tick = one full sweep. Per-mailbox errors are isolated so one
broken host doesn't take down the whole cycle.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

import structlog
from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.mailbox.models import MailboxConfig
from app.mailbox.service import fetch_one

log = structlog.get_logger()

_task: asyncio.Task | None = None
_last_run: dict[str, Any] = {"at": None, "fetched": 0, "errors": 0}


def get_status() -> dict[str, Any]:
    return {
        "enabled": settings.mail_fetcher_enabled,
        "interval_seconds": settings.mail_fetcher_interval_seconds,
        "running": _task is not None and not _task.done(),
        "last_run_at": _last_run["at"].isoformat() if _last_run["at"] else None,
        "last_fetched": _last_run["fetched"],
        "last_errors": _last_run["errors"],
    }


async def _tick() -> None:
    """One sweep across every active mailbox. Per-row errors are caught
    so a broken IMAP host doesn't poison the whole loop."""
    total_fetched = 0
    total_errors = 0
    async with SessionLocal() as session:
        active = (
            await session.execute(
                select(MailboxConfig).where(MailboxConfig.imap_active.is_(True))
            )
        ).scalars().all()
        for mb in active:
            try:
                stats = await fetch_one(session, mb)
                total_fetched += stats.get("fetched", 0)
                total_errors += stats.get("errors", 0)
            except Exception as e:
                total_errors += 1
                log.warning(
                    "mail.cron.scope_failed",
                    scope_kind=mb.scope_kind,
                    scope_id=mb.scope_id,
                    error=str(e),
                )
    _last_run["at"] = datetime.now(timezone.utc)
    _last_run["fetched"] = total_fetched
    _last_run["errors"] = total_errors
    if total_fetched or total_errors:
        log.info(
            "mail.cron.tick",
            fetched=total_fetched,
            errors=total_errors,
        )


async def _loop() -> None:
    interval = max(15, int(settings.mail_fetcher_interval_seconds))
    while True:
        try:
            await _tick()
        except Exception as e:
            log.exception("mail.cron.tick_unhandled", error=str(e))
        await asyncio.sleep(interval)


async def start_mail_fetcher_loop() -> None:
    global _task
    if not settings.mail_fetcher_enabled:
        log.info("mail.cron.disabled")
        return
    if _task is not None and not _task.done():
        return
    _task = asyncio.create_task(_loop(), name="mail-fetcher")
    log.info("mail.cron.started", interval=settings.mail_fetcher_interval_seconds)


async def stop_mail_fetcher_loop() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except (asyncio.CancelledError, Exception):
        pass
    _task = None
