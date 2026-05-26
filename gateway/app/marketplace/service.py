"""Plugin marketplace service.

Two responsibilities:
  1. Admin catalog CRUD.
  2. Tenant install / uninstall / list-installed — paid plugins
     (pricing_kind != 'free') charge the wallet at install time using
     the existing WalletService primitives. monthly pricing wires up
     in a follow-up; one_time charges land in the ledger with
     reason='charge', ref_kind='plugin_install'.
"""

from __future__ import annotations

from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.marketplace.models import PluginCatalogEntry, TenantPluginInstall
from app.wallet import service as wallet_service

log = structlog.get_logger()


class MarketplaceError(Exception):
    """Surfaced as a 400 in routes."""


async def list_catalog(
    session: AsyncSession, *, visible_only: bool = False
) -> list[PluginCatalogEntry]:
    q = select(PluginCatalogEntry).order_by(PluginCatalogEntry.name)
    if visible_only:
        q = q.where(PluginCatalogEntry.visible.is_(True))
    return list((await session.execute(q)).scalars().all())


async def upsert_entry(
    session: AsyncSession, *, slug: str, fields: dict[str, Any]
) -> PluginCatalogEntry:
    entry = (
        await session.execute(
            select(PluginCatalogEntry).where(PluginCatalogEntry.slug == slug)
        )
    ).scalar_one_or_none()
    if entry is None:
        entry = PluginCatalogEntry(slug=slug, name=fields.get("name") or slug)
        session.add(entry)
    for k, v in fields.items():
        if k == "slug":
            continue
        if hasattr(entry, k) and v is not None:
            setattr(entry, k, v)
    await session.flush()
    log.info("marketplace.upserted", slug=slug)
    return entry


async def delete_entry(session: AsyncSession, *, slug: str) -> bool:
    entry = (
        await session.execute(
            select(PluginCatalogEntry).where(PluginCatalogEntry.slug == slug)
        )
    ).scalar_one_or_none()
    if entry is None:
        return False
    await session.delete(entry)
    return True


async def list_installs(
    session: AsyncSession, *, tenant_id: int
) -> list[tuple[TenantPluginInstall, PluginCatalogEntry]]:
    rows = (
        await session.execute(
            select(TenantPluginInstall, PluginCatalogEntry)
            .join(PluginCatalogEntry, PluginCatalogEntry.id == TenantPluginInstall.plugin_id)
            .where(TenantPluginInstall.tenant_id == tenant_id)
            .order_by(TenantPluginInstall.installed_at.desc())
        )
    ).all()
    return [(r[0], r[1]) for r in rows]


async def install(
    session: AsyncSession,
    *,
    tenant_id: int,
    plugin_slug: str,
    settings: dict[str, Any] | None = None,
    actor_user_id: int | None = None,
) -> TenantPluginInstall:
    entry = (
        await session.execute(
            select(PluginCatalogEntry).where(PluginCatalogEntry.slug == plugin_slug)
        )
    ).scalar_one_or_none()
    if entry is None or not entry.visible:
        raise MarketplaceError("plugin not found")
    existing = (
        await session.execute(
            select(TenantPluginInstall).where(
                TenantPluginInstall.tenant_id == tenant_id,
                TenantPluginInstall.plugin_id == entry.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        if existing.status == "active":
            raise MarketplaceError("already installed")
        # Reactivate a previously paused install — no second charge.
        existing.status = "active"
        if settings is not None:
            existing.settings = settings
        await session.flush()
        return existing

    install_row = TenantPluginInstall(
        tenant_id=tenant_id,
        plugin_id=entry.id,
        status="active",
        settings=settings or {},
    )
    session.add(install_row)
    await session.flush()

    # Charge for one-time pricing. monthly / per_call land in the
    # ledger via cron / usage_records respectively — those wire up
    # alongside the runtime hook layer in a follow-up PR.
    if entry.pricing_kind == "one_time" and entry.price_micros > 0:
        try:
            ledger = await wallet_service.charge(
                session,
                tenant_id,
                entry.price_micros,
                currency=entry.currency,
                reason="charge",
                ref_kind="plugin_install",
                ref_id=str(install_row.id),
                actor_kind="tenant",
                actor_user_id=actor_user_id,
                notes=f"plugin install: {entry.slug}",
            )
            install_row.charge_ledger_id = ledger.id
        except Exception as e:  # noqa: BLE001
            # If the charge fails (e.g. insufficient balance), we don't
            # want a half-installed plugin sitting active. Mark it failed
            # and bubble up.
            install_row.status = "failed"
            await session.flush()
            raise MarketplaceError(f"charge failed: {e}") from None

    log.info(
        "marketplace.installed",
        tenant_id=tenant_id,
        slug=entry.slug,
        pricing_kind=entry.pricing_kind,
    )
    return install_row


async def uninstall(
    session: AsyncSession, *, tenant_id: int, plugin_slug: str
) -> bool:
    pair = (
        await session.execute(
            select(TenantPluginInstall, PluginCatalogEntry)
            .join(PluginCatalogEntry, PluginCatalogEntry.id == TenantPluginInstall.plugin_id)
            .where(TenantPluginInstall.tenant_id == tenant_id)
            .where(PluginCatalogEntry.slug == plugin_slug)
        )
    ).first()
    if pair is None:
        return False
    install_row = pair[0]
    install_row.status = "paused"
    await session.flush()
    return True
