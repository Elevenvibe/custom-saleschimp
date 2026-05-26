"""Dograh → gateway usage ingest cron.

We can't edit Dograh (it's a submodule pinned to upstream) and Dograh
doesn't fire post-call webhooks. So the gateway *pulls* call data from
its `/api/v1/organizations/usage/runs` endpoint per tenant, on a
schedule, walking forward an id cursor so we never double-book a run.

For each new workflow_run we synthesize one `usage_record` + one
wallet charge. Cost resolution lives in our calculator (P2.A1) — when
Dograh ships a `charge_usd` we trust it as the raw provider cost; our
package's markup/apply_markup decide what the tenant is actually
billed. Free/zero-cost calls still get a usage_record (so the
customer's /reports page shows them) but don't move the wallet.

The cron is opt-in (`settings.usage_ingest_enabled=true`) so dev
environments without a populated Dograh DB don't spam log lines.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import jwt
import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import SessionLocal
from app.tenants.models import Tenant, TenantMember
from app.wallet import usage_service
from app.wallet.models import UsageRecord

log = structlog.get_logger()

_task: asyncio.Task | None = None
_last_run: dict[str, Any] = {"at": None, "tenants": 0, "ingested": 0, "errors": 0}


def get_status() -> dict[str, Any]:
    return {
        "enabled": settings.usage_ingest_enabled,
        "interval_seconds": settings.usage_ingest_interval_seconds,
        "running": _task is not None and not _task.done(),
        "last_run_at": _last_run["at"].isoformat() if _last_run["at"] else None,
        "last_tenants": _last_run["tenants"],
        "last_ingested": _last_run["ingested"],
        "last_errors": _last_run["errors"],
    }


async def start_usage_ingest_loop() -> None:
    global _task
    if not settings.usage_ingest_enabled:
        log.info("usage_ingest.disabled")
        return
    if _task is not None and not _task.done():
        return
    _task = asyncio.create_task(_loop())
    log.info("usage_ingest.started", interval_s=settings.usage_ingest_interval_seconds)


async def stop_usage_ingest_loop() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except asyncio.CancelledError:
        pass
    _task = None
    log.info("usage_ingest.stopped")


def _mint_tenant_token(dograh_user_id: int, org_id: int, email: str) -> str:
    """Mint a short-lived JWT impersonating a tenant member so we can
    call Dograh's per-org endpoints. Same secret/algorithm Dograh
    expects (set via OSS_JWT_SECRET) — Dograh resolves the user via
    `sub` and ignores our extra claims."""
    payload = {
        "sub": str(dograh_user_id),
        "email": email,
        "iat": datetime.now(UTC),
        "exp": datetime.now(UTC) + timedelta(minutes=5),
        "tenant_kind": "customer",
        "org_id": org_id,
        "role": "org_owner",
        "scopes": ["tenant:org_owner"],
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


async def _pick_principal_user(session: AsyncSession, tenant_id: int) -> TenantMember | None:
    """Pick one tenant member to impersonate — prefers org_owner so the
    Dograh-side authz check has the broadest read of the org's data."""
    from sqlalchemy import case

    role_priority = case(
        (TenantMember.role == "org_owner", 0),
        (TenantMember.role == "org_admin", 1),
        else_=2,
    )
    member = (
        await session.execute(
            select(TenantMember)
            .where(TenantMember.tenant_id == tenant_id)
            .where(TenantMember.dograh_user_id.is_not(None))
            .order_by(role_priority.asc(), TenantMember.id.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return member


async def _latest_occurred_at(session: AsyncSession, tenant_id: int) -> datetime | None:
    return (
        await session.execute(
            select(func.max(UsageRecord.occurred_at))
            .where(UsageRecord.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()


def _to_micros(usd: float | None) -> int:
    if usd is None:
        return 0
    return int(round(float(usd) * 1_000_000))


async def _ingest_one_tenant(
    session: AsyncSession,
    client: httpx.AsyncClient,
    tenant: Tenant,
) -> tuple[int, int]:
    """Ingest new runs for a single tenant. Returns (ingested, errors).

    We don't have a server-side cursor on Dograh, so we pull pages
    starting from the last `occurred_at` we recorded (minus a small
    overlap to catch any reordering at the boundary) and dedupe per
    row via `external_ref`."""
    if tenant.dograh_org_id is None:
        return 0, 0

    member = await _pick_principal_user(session, tenant.id)
    if member is None or member.dograh_user_id is None:
        return 0, 0

    last_at = await _latest_occurred_at(session, tenant.id)
    start_iso = (
        (last_at - timedelta(minutes=5)).isoformat()
        if last_at
        else (datetime.now(UTC) - timedelta(days=7)).isoformat()
    )

    token = _mint_tenant_token(
        member.dograh_user_id, tenant.dograh_org_id, member.email
    )

    ingested = 0
    errors = 0
    page = 1
    limit = settings.usage_ingest_page_size

    while True:
        try:
            resp = await client.get(
                f"{settings.dograh_api_url}/api/v1/organizations/usage/runs",
                headers={"Authorization": f"Bearer {token}"},
                params={"start_date": start_iso, "page": page, "limit": limit},
                timeout=15.0,
            )
            if resp.status_code != 200:
                log.warning(
                    "usage_ingest.dograh_non_200",
                    tenant_id=tenant.id,
                    status=resp.status_code,
                )
                errors += 1
                break
            payload = resp.json()
        except (httpx.HTTPError, ValueError) as e:
            log.warning("usage_ingest.fetch_failed", tenant_id=tenant.id, error=str(e))
            errors += 1
            break

        runs: list[dict[str, Any]] = payload.get("runs", [])
        if not runs:
            break

        for run in runs:
            try:
                external_ref = str(run["id"])
                billed_micros = _to_micros(run.get("charge_usd"))
                duration_s = int(run.get("call_duration_seconds") or 0)
                occurred_at = datetime.fromisoformat(
                    run["created_at"].replace("Z", "+00:00")
                )

                await usage_service.record(
                    session,
                    usage_service.UsageInput(
                        tenant_id=tenant.id,
                        external_ref=external_ref,
                        # quantity_micros stores duration in micro-minutes
                        # so the same field generalizes to per_sec/per_min
                        # billing intervals later.
                        quantity_micros=duration_s * 1_000_000 // 60,
                        raw_cost_micros=billed_micros,
                        markup_micros=0,
                        billed_micros=billed_micros,
                        currency="USD",
                        kind="call",
                        unit="per_min",
                        occurred_at=occurred_at,
                        cost_breakdown={
                            "workflow_id": run.get("workflow_id"),
                            "workflow_name": run.get("workflow_name"),
                            "disposition": run.get("disposition"),
                            "duration_seconds": duration_s,
                            "dograh_tokens": run.get("dograh_token_usage"),
                            "caller_number": run.get("caller_number"),
                            "called_number": run.get("called_number"),
                        },
                    ),
                )
                ingested += 1
            except usage_service.DuplicateUsage:
                # Already recorded — expected on the overlap window.
                continue
            except Exception as e:  # noqa: BLE001
                log.warning(
                    "usage_ingest.row_failed",
                    tenant_id=tenant.id,
                    run_id=run.get("id"),
                    error=str(e),
                )
                errors += 1

        await session.commit()

        if page >= payload.get("total_pages", 1):
            break
        page += 1

    return ingested, errors


async def run_once() -> dict[str, int]:
    ingested_total = 0
    errors_total = 0
    tenant_count = 0
    async with SessionLocal() as session:
        tenants = (
            await session.execute(
                select(Tenant).where(Tenant.dograh_org_id.is_not(None))
            )
        ).scalars().all()
        async with httpx.AsyncClient() as client:
            for tenant in tenants:
                try:
                    ing, err = await _ingest_one_tenant(session, client, tenant)
                    ingested_total += ing
                    errors_total += err
                    tenant_count += 1
                except Exception as e:  # noqa: BLE001
                    log.warning(
                        "usage_ingest.tenant_failed",
                        tenant_id=tenant.id,
                        error=str(e),
                    )
                    errors_total += 1
    _last_run["at"] = datetime.now(UTC)
    _last_run["tenants"] = tenant_count
    _last_run["ingested"] = ingested_total
    _last_run["errors"] = errors_total
    log.info(
        "usage_ingest.iteration_done",
        tenants=tenant_count,
        ingested=ingested_total,
        errors=errors_total,
    )
    return {
        "tenants": tenant_count,
        "ingested": ingested_total,
        "errors": errors_total,
    }


async def _loop() -> None:
    # First tick offset so multiple workers don't all wake on the same
    # second; same pattern as price_sync.
    await asyncio.sleep(min(10, settings.usage_ingest_interval_seconds))
    while True:
        try:
            await run_once()
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            log.warning("usage_ingest.iteration_failed", error=str(e))
        try:
            await asyncio.sleep(settings.usage_ingest_interval_seconds)
        except asyncio.CancelledError:
            raise
