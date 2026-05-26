"""Live FX rate fetcher.

Opt-in via `FX_FETCHER_ENABLED=true`. Pulls rates from a free public
source (`FX_FETCHER_URL`, defaults to open.er-api.com/v6/latest/USD)
and upserts them into `fx_rates` with source='live'.

Two important rules:
  1. Manual entries (source='manual') win. The cron skips any pair
     where a manual row already exists, so an admin override stays put
     even if the live source disagrees.
  2. Identity rate (USD->USD) is left alone. The 0010 migration seeds
     it with source='seed' and there's never a reason to refetch.

Schedule is configurable via `FX_FETCHER_INTERVAL_SECONDS`; defaults
to 3600 (hourly) because FX rates don't move fast enough to justify
hammering a free endpoint.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

import httpx
import structlog
from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.fx import service as fx_service
from app.fx.models import FxRate

log = structlog.get_logger()

_task: asyncio.Task | None = None
_last_run: dict[str, Any] = {
    "at": None,
    "fetched": 0,
    "upserted": 0,
    "skipped_manual": 0,
    "error": None,
}


def get_status() -> dict[str, Any]:
    return {
        "enabled": settings.fx_fetcher_enabled,
        "interval_seconds": settings.fx_fetcher_interval_seconds,
        "url": settings.fx_fetcher_url,
        "base_currency": settings.fx_fetcher_base_currency,
        "running": _task is not None and not _task.done(),
        "last_run_at": _last_run["at"].isoformat() if _last_run["at"] else None,
        "last_fetched": _last_run["fetched"],
        "last_upserted": _last_run["upserted"],
        "last_skipped_manual": _last_run["skipped_manual"],
        "last_error": _last_run["error"],
    }


def _allowed_currencies() -> set[str] | None:
    raw = (settings.fx_fetcher_currencies or "").strip()
    if not raw:
        return None
    return {c.strip().upper() for c in raw.split(",") if c.strip()}


async def run_once() -> dict[str, int]:
    """One pass. Always returns a {fetched, upserted, skipped_manual}
    summary even on partial failure. Network / 5xx errors are logged
    but don't propagate — the cron should keep trying."""
    base = settings.fx_fetcher_base_currency.upper()
    allowed = _allowed_currencies()
    summary = {"fetched": 0, "upserted": 0, "skipped_manual": 0, "error": None}
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(settings.fx_fetcher_url)
            resp.raise_for_status()
            payload = resp.json()
    except (httpx.HTTPError, ValueError) as e:
        summary["error"] = str(e)
        log.warning("fx_fetcher.fetch_failed", error=str(e))
        _store_last(summary)
        return summary

    # Both exchangerate.host and open.er-api.com expose `rates` as a
    # currency→float map and accept the base as a path/query arg.
    rates = payload.get("rates") or payload.get("conversion_rates") or {}
    if not isinstance(rates, dict):
        summary["error"] = f"unexpected payload shape: {list(payload.keys())[:5]}"
        log.warning("fx_fetcher.bad_payload", keys=list(payload.keys())[:5])
        _store_last(summary)
        return summary

    summary["fetched"] = len(rates)
    async with SessionLocal() as session:
        for quote_raw, rate_raw in rates.items():
            quote = str(quote_raw).upper()
            if quote == base:
                continue
            if allowed is not None and quote not in allowed:
                continue
            try:
                rate_float = float(rate_raw)
            except (TypeError, ValueError):
                continue
            if rate_float <= 0:
                continue

            existing = (
                await session.execute(
                    select(FxRate).where(
                        FxRate.base_currency == base,
                        FxRate.quote_currency == quote,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None and existing.source == "manual":
                # Manual override wins — leave it alone.
                summary["skipped_manual"] += 1
                continue

            rate_micros = int(round(rate_float * 1_000_000))
            await fx_service.upsert_rate(
                session,
                base=base,
                quote=quote,
                rate_micros=rate_micros,
                source="live",
            )
            summary["upserted"] += 1
        await session.commit()

    _store_last(summary)
    log.info(
        "fx_fetcher.iteration_done",
        fetched=summary["fetched"],
        upserted=summary["upserted"],
        skipped_manual=summary["skipped_manual"],
    )
    return summary


def _store_last(summary: dict[str, Any]) -> None:
    _last_run["at"] = datetime.now(UTC)
    _last_run["fetched"] = summary.get("fetched", 0)
    _last_run["upserted"] = summary.get("upserted", 0)
    _last_run["skipped_manual"] = summary.get("skipped_manual", 0)
    _last_run["error"] = summary.get("error")


async def start_fx_fetcher_loop() -> None:
    global _task
    if not settings.fx_fetcher_enabled:
        log.info("fx_fetcher.disabled")
        return
    if _task is not None and not _task.done():
        return
    _task = asyncio.create_task(_loop())
    log.info(
        "fx_fetcher.started",
        url=settings.fx_fetcher_url,
        interval_s=settings.fx_fetcher_interval_seconds,
    )


async def stop_fx_fetcher_loop() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except asyncio.CancelledError:
        pass
    _task = None
    log.info("fx_fetcher.stopped")


async def _loop() -> None:
    # Light initial delay so the first hit happens after the gateway
    # is serving requests.
    await asyncio.sleep(min(15, settings.fx_fetcher_interval_seconds))
    while True:
        try:
            await run_once()
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            log.warning("fx_fetcher.iteration_failed", error=str(e))
        try:
            await asyncio.sleep(settings.fx_fetcher_interval_seconds)
        except asyncio.CancelledError:
            raise
