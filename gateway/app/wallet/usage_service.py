"""UsageService — record one billable event and charge the wallet.

The record + the charge land in a single SQL transaction so we can't
end up with a "ghost" usage row whose money was never deducted, or
vice versa. The Dograh ingest cron is the primary caller; admins can
also POST a usage row directly for backfill.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.wallet import service as wallet_service
from app.wallet.models import UsageRecord

log = structlog.get_logger()


@dataclass(slots=True)
class UsageInput:
    """Caller-provided shape — keeps the service signature tight even
    as Dograh adds more columns to its workflow_run response."""

    tenant_id: int
    external_ref: str
    quantity_micros: int
    raw_cost_micros: int
    markup_micros: int
    billed_micros: int
    package_id: int | None = None
    kind: str = "call"
    unit: str = "per_min"
    currency: str = "USD"
    cost_breakdown: dict[str, Any] | None = None
    occurred_at: datetime | None = None


class DuplicateUsage(Exception):
    """The (tenant, external_ref) pair has already been recorded.

    Raised instead of returning the existing row so the caller can
    distinguish "I just inserted this" from "this was already there" —
    the ingest cron treats it as a no-op, the admin route returns 409.
    """


async def record(session: AsyncSession, payload: UsageInput) -> UsageRecord:
    """Insert one usage_record + charge the wallet. Idempotent on
    (tenant_id, external_ref). Raises `DuplicateUsage` if we've already
    booked this run."""
    # Cheap pre-check so duplicates don't poison the outer transaction.
    # Race-safe enough: if two ingest workers ever fight on the same
    # workflow_run, the unique constraint catches it at flush time and
    # we surface DuplicateUsage either way.
    existing = (
        await session.execute(
            select(UsageRecord.id)
            .where(UsageRecord.tenant_id == payload.tenant_id)
            .where(UsageRecord.external_ref == payload.external_ref)
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise DuplicateUsage(payload.external_ref)

    rec = UsageRecord(
        tenant_id=payload.tenant_id,
        external_ref=payload.external_ref,
        package_id=payload.package_id,
        kind=payload.kind,
        unit=payload.unit,
        quantity_micros=payload.quantity_micros,
        raw_cost_micros=payload.raw_cost_micros,
        markup_micros=payload.markup_micros,
        billed_micros=payload.billed_micros,
        currency=payload.currency,
        cost_breakdown=payload.cost_breakdown or {},
        occurred_at=payload.occurred_at or datetime.utcnow(),
    )
    session.add(rec)
    try:
        await session.flush()
    except IntegrityError:
        # Lost a race against another ingest worker. Don't rollback the
        # whole session — callers structure their transactions around us.
        raise DuplicateUsage(payload.external_ref) from None

    # Only charge if there's something to charge. A free/included call
    # (billed_micros=0) still gets a usage_record so the customer's
    # reports page shows it — the wallet just doesn't move.
    if payload.billed_micros > 0:
        entry = await wallet_service.charge(
            session,
            payload.tenant_id,
            payload.billed_micros,
            reason="charge",
            ref_kind="usage_record",
            ref_id=str(rec.id),
            actor_kind="system",
            notes=f"{payload.kind} {payload.external_ref}",
        )
        rec.ledger_id = entry.id
        await session.flush()

    log.info(
        "usage.recorded",
        tenant_id=payload.tenant_id,
        external_ref=payload.external_ref,
        billed_micros=payload.billed_micros,
    )
    return rec


async def list_for_tenant(
    session: AsyncSession,
    tenant_id: int,
    *,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(UsageRecord)
            .where(UsageRecord.tenant_id == tenant_id)
            .order_by(UsageRecord.occurred_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    return [
        {
            "id": r.id,
            "external_ref": r.external_ref,
            "package_id": r.package_id,
            "kind": r.kind,
            "unit": r.unit,
            "quantity_micros": r.quantity_micros,
            "raw_cost_micros": r.raw_cost_micros,
            "markup_micros": r.markup_micros,
            "billed_micros": r.billed_micros,
            "currency": r.currency,
            "cost_breakdown": r.cost_breakdown,
            "occurred_at": r.occurred_at.isoformat(),
        }
        for r in rows
    ]


async def daily_aggregates(
    session: AsyncSession,
    tenant_id: int,
    *,
    days: int = 30,
) -> list[dict[str, Any]]:
    """One bucket per day for the customer chart. Postgres-flavoured
    DATE_TRUNC so we lean on the index without pulling rows into Python."""
    from sqlalchemy import func, text

    res = await session.execute(
        text(
            """
            SELECT
                date_trunc('day', occurred_at)::date AS day,
                COUNT(*) AS call_count,
                COALESCE(SUM(quantity_micros), 0) AS quantity_micros,
                COALESCE(SUM(billed_micros), 0) AS billed_micros
            FROM usage_records
            WHERE tenant_id = :tid
              AND occurred_at >= now() - make_interval(days => :days)
            GROUP BY 1
            ORDER BY 1 ASC
            """
        ),
        {"tid": tenant_id, "days": days},
    )
    return [
        {
            "day": row.day.isoformat(),
            "call_count": int(row.call_count),
            "quantity_micros": int(row.quantity_micros),
            "billed_micros": int(row.billed_micros),
        }
        for row in res
    ]
