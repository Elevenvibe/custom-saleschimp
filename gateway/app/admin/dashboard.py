from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.models import AuditLog
from app.auth.deps import require_super_admin
from app.auth.models import PlatformUser
from app.db import get_session
from app.packages.models import Package
from app.payments.models import PaymentIntent
from app.plugins.models import InstalledPlugin
from app.tenants.models import Tenant, TenantMember
from app.wallet.models import UsageRecord

router = APIRouter()

# Statuses we treat as "active" for tenants. Everything else (suspended,
# cancelled, pending_verification) counts as inactive.
_ACTIVE_TENANT_STATUS = "active"


@router.get("/dashboard")
async def dashboard(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    async def count(model) -> int:
        result = await session.execute(select(func.count()).select_from(model))
        return int(result.scalar_one())

    recent = await session.execute(
        select(AuditLog).order_by(AuditLog.created_at.desc()).limit(10)
    )
    rows = recent.scalars().all()

    return {
        "counts": {
            "tenants": await count(Tenant),
            "platform_users": await count(PlatformUser),
            "packages": await count(Package),
            "installed_plugins": await count(InstalledPlugin),
        },
        "recent_audit": [
            {
                "id": r.id,
                "actor_kind": r.actor_kind,
                "actor_user_id": r.actor_user_id,
                "action": r.action,
                "target_kind": r.target_kind,
                "target_id": r.target_id,
                "ip": r.ip,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
    }


def _month_key(dt: datetime) -> str:
    return f"{dt.year:04d}-{dt.month:02d}"


@router.get("/dashboard/overview")
async def dashboard_overview(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    year: int = Query(default=0, description="Calendar year for the registration/subscription charts; 0 = current"),
) -> dict:
    """One aggregation call for the OODA super-admin dashboard Overview tab.

    Real data is pulled where the schema supports it (tenants, packages,
    tenant_packages, usage_records, payment_intents, tenant_members);
    sections without a data path are flagged coming_soon in the response so
    the UI can render a placeholder. Money is returned in its stored unit
    (usage = micros, payments = cents); the UI formats.
    """
    now = datetime.now(UTC)
    yr = year or now.year
    year_start = datetime(yr, 1, 1, tzinfo=UTC)
    next_year = datetime(yr + 1, 1, 1, tzinfo=UTC)
    this_month_start = datetime(now.year, now.month, 1, tzinfo=UTC)
    this_year_start = datetime(now.year, 1, 1, tzinfo=UTC)
    in_30_days = now + timedelta(days=30)

    # ---- tenant status counts (active vs inactive) ----
    status_rows = (
        await session.execute(select(Tenant.status, func.count()).group_by(Tenant.status))
    ).all()
    tenants_active = sum(c for s, c in status_rows if s == _ACTIVE_TENANT_STATUS)
    tenants_total = sum(c for _, c in status_rows)
    tenants_inactive = tenants_total - tenants_active

    # ---- package counts (visible = active) ----
    pkg_rows = (
        await session.execute(select(Package.visible, func.count()).group_by(Package.visible))
    ).all()
    pkg_active = sum(c for v, c in pkg_rows if v)
    pkg_total = sum(c for _, c in pkg_rows)

    platform_users = int(
        (await session.execute(select(func.count()).select_from(PlatformUser))).scalar_one()
    )
    installed_plugins = int(
        (await session.execute(select(func.count()).select_from(InstalledPlugin))).scalar_one()
    )

    # ---- earnings (markup = catalog profit) + sales (billed) ----
    # All-time totals.
    totals = (
        await session.execute(
            select(
                func.coalesce(func.sum(UsageRecord.markup_micros), 0),
                func.coalesce(func.sum(UsageRecord.billed_micros), 0),
            )
        )
    ).one()
    total_earnings, total_sales = int(totals[0]), int(totals[1])

    # This-year monthly buckets (for this_month, this_year, last 3 months).
    month_rows = (
        await session.execute(
            select(
                func.date_trunc("month", UsageRecord.occurred_at).label("m"),
                func.coalesce(func.sum(UsageRecord.markup_micros), 0),
                func.coalesce(func.sum(UsageRecord.billed_micros), 0),
            )
            .where(UsageRecord.occurred_at >= this_year_start)
            .group_by(text("m"))
        )
    ).all()
    earn_by_month: dict[str, int] = {}
    sales_by_month: dict[str, int] = {}
    for m, mk, bl in month_rows:
        key = _month_key(m)
        earn_by_month[key] = int(mk)
        sales_by_month[key] = int(bl)

    def last_3_months(by_month: dict[str, int]) -> list[dict]:
        # Oldest → newest: two months ago, last month, current.
        out = []
        for i in (2, 1, 0):
            y, mo = now.year, now.month - i
            while mo <= 0:
                mo += 12
                y -= 1
            key = f"{y:04d}-{mo:02d}"
            out.append(
                {"month": datetime(y, mo, 1).strftime("%b %Y"), "value": by_month.get(key, 0)}
            )
        return out

    this_month_key = _month_key(now)
    earnings = {
        "total": total_earnings,
        "this_month": earn_by_month.get(this_month_key, 0),
        "this_year": sum(earn_by_month.values()),
        "last_3_months": last_3_months(earn_by_month),
    }
    sales = {
        "total": total_sales,
        "this_month": sales_by_month.get(this_month_key, 0),
        "this_year": sum(sales_by_month.values()),
        "last_3_months": last_3_months(sales_by_month),
    }

    # ---- top paying tenants (sum billed per tenant) ----
    top_rows = (
        await session.execute(
            select(
                UsageRecord.tenant_id,
                func.coalesce(func.sum(UsageRecord.billed_micros), 0).label("amt"),
            )
            .group_by(UsageRecord.tenant_id)
            .order_by(text("amt DESC"))
            .limit(10)
        )
    ).all()
    tenant_names = await _tenant_name_map(session, [t for t, _ in top_rows])
    top_paying = [
        {"tenant_id": t, "name": tenant_names.get(t, f"#{t}"), "amount_micros": int(a)}
        for t, a in top_rows
    ]

    # ---- payment gateway breakdown (succeeded intents by provider) ----
    pg_rows = (
        await session.execute(
            select(
                PaymentIntent.provider,
                func.coalesce(func.sum(PaymentIntent.amount_cents), 0),
                func.count(),
            )
            .where(PaymentIntent.status.in_(("succeeded", "captured", "paid")))
            .group_by(PaymentIntent.provider)
        )
    ).all()
    payment_gateways = [
        {"provider": p, "amount_cents": int(a), "count": int(c)} for p, a, c in pg_rows
    ]

    # ---- subscriptions (tenant_packages) ----
    sub_active = int(
        (
            await session.execute(
                text(
                    "SELECT count(*) FROM tenant_packages tp "
                    "JOIN tenants t ON t.id = tp.tenant_id WHERE t.status = 'active'"
                )
            )
        ).scalar_one()
    )
    sub_new_month = int(
        (
            await session.execute(
                text("SELECT count(*) FROM tenant_packages WHERE started_at >= :s"),
                {"s": this_month_start},
            )
        ).scalar_one()
    )
    sub_monthly_rows = (
        await session.execute(
            text(
                "SELECT to_char(date_trunc('month', started_at), 'YYYY-MM') m, count(*) c "
                "FROM tenant_packages WHERE started_at >= :s GROUP BY m ORDER BY m"
            ),
            {"s": this_year_start},
        )
    ).all()
    subscriptions = {
        "active": sub_active,
        "new_this_month": sub_new_month,
        "monthly": [{"month": m, "count": int(c)} for m, c in sub_monthly_rows],
    }

    # ---- package counts (orgs subscribed per package) ----
    pkgcount_rows = (
        await session.execute(
            text(
                "SELECT p.name, count(tp.tenant_id) c FROM packages p "
                "LEFT JOIN tenant_packages tp ON tp.package_id = p.id "
                "GROUP BY p.id, p.name ORDER BY c DESC"
            )
        )
    ).all()
    package_counts = [{"name": n, "count": int(c)} for n, c in pkgcount_rows]

    # ---- newly registered tenants ----
    newly_rows = (
        await session.execute(
            text(
                "SELECT t.id, t.name, t.logo_url, t.created_at, p.name pkg "
                "FROM tenants t "
                "LEFT JOIN tenant_packages tp ON tp.tenant_id = t.id "
                "LEFT JOIN packages p ON p.id = tp.package_id "
                "ORDER BY t.created_at DESC LIMIT 8"
            )
        )
    ).all()
    newly_registered = [
        {
            "id": r[0],
            "name": r[1],
            "logo_url": r[2],
            "created_at": r[3].isoformat() if r[3] else None,
            "package": r[4],
        }
        for r in newly_rows
    ]

    # ---- recent subscriptions (most-recent tenant_packages) ----
    recent_sub_rows = (
        await session.execute(
            text(
                "SELECT t.name, p.name pkg, tp.started_at, tp.source "
                "FROM tenant_packages tp "
                "JOIN tenants t ON t.id = tp.tenant_id "
                "JOIN packages p ON p.id = tp.package_id "
                "ORDER BY tp.started_at DESC LIMIT 8"
            )
        )
    ).all()
    recent_subscriptions = [
        {
            "name": r[0],
            "package": r[1],
            "started_at": r[2].isoformat() if r[2] else None,
            "source": r[3],
        }
        for r in recent_sub_rows
    ]

    # ---- upcoming renewals + expiring subs (tenant_packages.ends_at ≤ 30d) ----
    expiring_rows = (
        await session.execute(
            text(
                "SELECT t.name, p.name pkg, tp.ends_at, p.monthly_price_cents, p.currency "
                "FROM tenant_packages tp "
                "JOIN tenants t ON t.id = tp.tenant_id "
                "JOIN packages p ON p.id = tp.package_id "
                "WHERE tp.ends_at IS NOT NULL AND tp.ends_at <= :until "
                "ORDER BY tp.ends_at ASC LIMIT 20"
            ),
            {"until": in_30_days},
        )
    ).all()
    expiring = [
        {
            "name": r[0],
            "package": r[1],
            "ends_at": r[2].isoformat() if r[2] else None,
            "amount_cents": int(r[3] or 0),
            "currency": r[4] or "USD",
        }
        for r in expiring_rows
    ]

    # ---- org with most users (member count) ----
    members_rows = (
        await session.execute(
            select(TenantMember.tenant_id, func.count().label("c"))
            .group_by(TenantMember.tenant_id)
            .order_by(text("c DESC"))
            .limit(8)
        )
    ).all()
    member_names = await _tenant_name_map(session, [t for t, _ in members_rows], with_logo=True)
    org_most_users = [
        {
            "tenant_id": t,
            "name": member_names.get(t, {}).get("name", f"#{t}"),
            "logo_url": member_names.get(t, {}).get("logo_url"),
            "members": int(c),
        }
        for t, c in members_rows
    ]

    # ---- registration chart (tenants by month for `yr`) ----
    reg_rows = (
        await session.execute(
            select(
                func.date_trunc("month", Tenant.created_at).label("m"),
                func.count(),
            )
            .where(Tenant.created_at >= year_start, Tenant.created_at < next_year)
            .group_by(text("m"))
        )
    ).all()
    reg_by_month = {_month_key(m): int(c) for m, c in reg_rows}
    registration = {
        "year": yr,
        "months": [
            {
                "month": datetime(yr, mo, 1).strftime("%b"),
                "n": mo,
                "quarter": (mo - 1) // 3 + 1,
                "count": reg_by_month.get(f"{yr:04d}-{mo:02d}", 0),
            }
            for mo in range(1, 13)
        ],
    }

    return {
        "snapshot": {
            "tenants": {"active": tenants_active, "inactive": tenants_inactive, "total": tenants_total},
            "packages": {"active": pkg_active, "inactive": pkg_total - pkg_active, "total": pkg_total},
            "platform_users": platform_users,
            "installed_plugins": installed_plugins,
            # multi-org per tenant isn't modelled yet (1:1 tenant↔org today).
            "organizations": {"coming_soon": True},
        },
        "earnings": earnings,
        "sales": sales,
        "subscriptions": subscriptions,
        "top_paying_tenants": top_paying,
        "payment_gateways": payment_gateways,
        "package_counts": package_counts,
        "newly_registered": newly_registered,
        "recent_subscriptions": recent_subscriptions,
        "expiring_subscriptions": expiring,
        "upcoming_renewals": expiring,  # same source (ends_at ≤ 30d); UI labels differ
        "org_most_users": org_most_users,
        "registration": registration,
        # explicitly flagged coming-soon per the spec / missing data path
        "coming_soon": {
            "invoices_due": True,          # no invoice model
            "multi_org": True,             # tenant↔org is 1:1 today
            "user_role_breakdown": True,   # agents/employees/clients split
        },
    }


async def _tenant_name_map(
    session: AsyncSession, ids: list[int], with_logo: bool = False
) -> dict:
    if not ids:
        return {}
    rows = (
        await session.execute(
            select(Tenant.id, Tenant.name, Tenant.logo_url).where(Tenant.id.in_(ids))
        )
    ).all()
    if with_logo:
        return {r[0]: {"name": r[1], "logo_url": r[2]} for r in rows}
    return {r[0]: r[1] for r in rows}
