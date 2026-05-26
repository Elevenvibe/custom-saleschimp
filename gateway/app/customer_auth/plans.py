"""Customer-facing plans + plan selection.

GET  /api/tenant/plans                — list visible packages for the
                                        org's currency, plus the tenant's
                                        currently-active plan (if any)
POST /api/tenant/me/plan              — switch the caller's tenant onto a
                                        given package (org_admin+). Annual
                                        + contact_sales packages can't be
                                        self-selected — that flow goes
                                        through a Contact Sales handoff.
"""

from datetime import UTC, datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.customer_auth.deps import require_customer, require_org_admin
from app.db import get_session
from app.packages.models import Package, PackagePlugin
from app.tenants.models import TenantMember

log = structlog.get_logger()

# Note: TenantPackage rows live in the tenant_packages table from migration
# 0001_initial. Keep the row count tight per tenant — at most one active row
# per tenant — so plan resolution is a simple SELECT.

router = APIRouter(tags=["customer-auth:plans"])


class PlanOut(BaseModel):
    id: int
    slug: str
    name: str
    description: str | None
    kind: str  # "payg" | "annual"
    billing_period: str
    monthly_price_cents: int
    bundled_minutes: int
    overage_per_minute_micros: int
    concurrency_included: int
    currency: str
    contact_sales: bool
    plugins: list[str]
    allowed_provider_kinds: list[str]
    usage_only: bool
    allowed_countries: list[str]


class PlansRes(BaseModel):
    current_plan_id: int | None
    plans: list[PlanOut]


class SelectPlanIn(BaseModel):
    package_id: int


def _serialize(pkg: Package, plugins: list[str]) -> PlanOut:
    return PlanOut(
        id=pkg.id,
        slug=pkg.slug,
        name=pkg.name,
        description=pkg.description,
        kind=pkg.kind,
        billing_period=pkg.billing_period,
        monthly_price_cents=pkg.monthly_price_cents,
        bundled_minutes=pkg.bundled_minutes,
        overage_per_minute_micros=pkg.overage_per_minute_micros,
        concurrency_included=pkg.concurrency_included,
        currency=pkg.currency,
        contact_sales=pkg.contact_sales,
        plugins=plugins,
    )


async def _tenant_id_for(session: AsyncSession, claims: dict) -> int:
    sub = claims.get("sub", "")
    try:
        dograh_user_id = int(sub)
    except (ValueError, TypeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad sub claim") from None
    row = (
        await session.execute(
            select(TenantMember.tenant_id).where(TenantMember.dograh_user_id == dograh_user_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "caller is not a tenant member")
    return int(row)


async def _current_package_id_for(session: AsyncSession, tenant_id: int) -> int | None:
    from sqlalchemy import text

    res = await session.execute(
        text("SELECT package_id FROM tenant_packages WHERE tenant_id = :tid"),
        {"tid": tenant_id},
    )
    row = res.first()
    return int(row[0]) if row else None


@router.get("/plans", response_model=PlansRes)
async def list_plans(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PlansRes:
    tenant_id = await _tenant_id_for(session, claims)
    current = await _current_package_id_for(session, tenant_id)

    pkgs = (
        await session.execute(
            select(Package)
            .where(Package.visible.is_(True))
            .order_by(Package.kind, Package.monthly_price_cents)
        )
    ).scalars().all()
    out: list[PlanOut] = []
    for pkg in pkgs:
        plugins = (
            await session.execute(
                select(PackagePlugin.plugin_id).where(PackagePlugin.package_id == pkg.id)
            )
        ).scalars().all()
        out.append(_serialize(pkg, list(plugins)))
    return PlansRes(current_plan_id=current, plans=out)


@router.post("/me/plan", response_model=PlansRes)
async def select_plan(
    body: SelectPlanIn,
    request: Request,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PlansRes:
    """Switch the caller's tenant onto `package_id`.

    `contact_sales` packages can't be selected directly — those are
    intentionally a sales-led flow. Customer app shows a Contact button
    instead of Select on those plans.
    """
    from sqlalchemy import text

    tenant_id = await _tenant_id_for(session, claims)
    pkg = await session.get(Package, body.package_id)
    if pkg is None or not pkg.visible:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "plan not found")
    if pkg.contact_sales:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "this plan requires contacting sales — it can't be self-selected",
        )

    now = datetime.now(UTC)
    # Upsert tenant_packages — one active row per tenant.
    await session.execute(
        text(
            """
            INSERT INTO tenant_packages (tenant_id, package_id, started_at, source)
            VALUES (:tid, :pid, :now, 'manual')
            ON CONFLICT (tenant_id) DO UPDATE SET
                package_id = EXCLUDED.package_id,
                started_at = EXCLUDED.started_at,
                source     = 'manual'
            """
        ),
        {"tid": tenant_id, "pid": pkg.id, "now": now},
    )

    actor_id: int | None = None
    sub = claims.get("sub", "")
    try:
        actor_id = int(sub)
    except (ValueError, TypeError):
        actor_id = None

    await record_audit(
        session,
        actor_kind="tenant",
        actor_user_id=actor_id,
        action="tenant.plan.select",
        target_kind="tenant",
        target_id=str(tenant_id),
        request=request,
        payload={"package_id": pkg.id, "slug": pkg.slug, "kind": pkg.kind},
    )
    await session.commit()

    log.info(
        "tenant.plan.select",
        tenant_id=tenant_id,
        package_id=pkg.id,
        slug=pkg.slug,
    )

    # Return the same shape /plans does so the UI can refresh from one response.
    return await list_plans(claims, session)
