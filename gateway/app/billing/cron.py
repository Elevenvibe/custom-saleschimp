"""Background price-sync loop.

Started in the FastAPI lifespan when `settings.price_sync_enabled` is true.
On every tick (`price_sync_interval_seconds`) iterates every active cost
provider and idempotently upserts the catalog's reference prices for any
(variant, unit) that doesn't yet have a row — same logic the
POST /sync-prices endpoint runs, just batched across all providers.

When per-vendor adapters grow real `fetch_prices()` support, the loop will
prefer live data and fall back to the catalog automatically.

Pure asyncio — no external scheduler dep. Cancellable on shutdown.
"""

from __future__ import annotations

import asyncio

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.billing.integrated_catalog import find_provider
from app.billing.models import CostProvider, CostProviderPrice
from app.config import settings
from app.db import SessionLocal

log = structlog.get_logger()

_task: asyncio.Task | None = None


async def start_price_sync_loop() -> None:
    """Spawn the background task. No-op when disabled."""
    global _task
    if not settings.price_sync_enabled:
        log.info("price_sync.disabled")
        return
    if _task is not None and not _task.done():
        return  # already running
    _task = asyncio.create_task(_loop())
    log.info(
        "price_sync.started",
        interval_s=settings.price_sync_interval_seconds,
    )


async def stop_price_sync_loop() -> None:
    """Cancel + await on shutdown."""
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except asyncio.CancelledError:
        pass
    _task = None
    log.info("price_sync.stopped")


async def run_once() -> dict[str, int]:
    """Single iteration — exposed so tests + admin actions can trigger it."""
    upserted_total = 0
    skipped_total = 0
    provider_count = 0
    async with SessionLocal() as session:
        providers = (
            await session.execute(
                select(CostProvider).where(CostProvider.active.is_(True))
            )
        ).scalars().all()
        for provider in providers:
            up, sk = await _sync_one(session, provider)
            upserted_total += up
            skipped_total += sk
            provider_count += 1
        if upserted_total > 0:
            await record_audit(
                session,
                actor_kind="system",
                action="price_sync.run",
                payload={
                    "providers": provider_count,
                    "upserted": upserted_total,
                    "skipped": skipped_total,
                },
            )
        await session.commit()
    log.info(
        "price_sync.iteration_done",
        providers=provider_count,
        upserted=upserted_total,
        skipped=skipped_total,
    )
    return {
        "providers": provider_count,
        "upserted": upserted_total,
        "skipped": skipped_total,
    }


async def _loop() -> None:
    # Stagger the first run slightly so multiple worker bootstraps don't all
    # hit the DB at the same instant.
    await asyncio.sleep(min(5, settings.price_sync_interval_seconds))
    while True:
        try:
            await run_once()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("price_sync.iteration_failed", error=str(e))
        try:
            await asyncio.sleep(settings.price_sync_interval_seconds)
        except asyncio.CancelledError:
            raise


async def _sync_one(
    session: AsyncSession, provider: CostProvider
) -> tuple[int, int]:
    """For one provider: scan catalog models and upsert any missing price rows."""
    catalog_hit = find_provider(provider.slug)
    if catalog_hit is None:
        return 0, 0
    _kind, integrated = catalog_hit
    upserted = 0
    skipped = 0
    for model in integrated["models"]:
        for price in model["prices"]:
            existing = await session.execute(
                select(CostProviderPrice.id)
                .where(CostProviderPrice.cost_provider_id == provider.id)
                .where(CostProviderPrice.variant == model["variant"])
                .where(CostProviderPrice.unit == price["unit"])
                .where(CostProviderPrice.currency == "USD")
            )
            if existing.first() is not None:
                skipped += 1
                continue
            session.add(
                CostProviderPrice(
                    cost_provider_id=provider.id,
                    unit=price["unit"],
                    variant=model["variant"],
                    price_micros=price["price_micros"],
                    currency="USD",
                    notes="auto-synced from integrated catalog",
                )
            )
            upserted += 1
    return upserted, skipped
