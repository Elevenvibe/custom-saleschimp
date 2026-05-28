"""Tenant-side audit log surface.

Mirrors the super-admin /api/admin/audit endpoint but scopes results to
the caller's own tenant — derived from the JWT claims, never from a
client-supplied tenant_id. The Logs page on the tenant sidebar reads
from here.

Filtering is intentionally narrower than the admin surface: tenants get
limit/offset and an optional `action` prefix filter. They can't pass
target_kind / target_id since the only target_kind that's relevant to
them is their own tenant (set automatically).

We also fall back to filtering by actor_user_id matching one of the
tenant's members for actor_kind='customer' rows. That picks up events
recorded by customer-side code that didn't write target_kind=tenant.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.models import AuditLog
from app.customer_auth.deps import require_customer
from app.db import get_session
from app.tenants.models import TenantMember


router = APIRouter(prefix="/logs", tags=["tenant:logs"])


@router.get("")
async def list_my_logs(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    # Action prefix filter — e.g. "tenant.ticket" matches all ticket
    # actions; "admin.tenant" lets a curious tenant see what super-admins
    # have done to their org (legitimate transparency).
    action: str | None = None,
) -> dict:
    dograh_user_id = claims.get("sub")
    if dograh_user_id is None:
        raise HTTPException(401, "missing sub claim")
    member = (
        await session.execute(
            select(TenantMember).where(TenantMember.dograh_user_id == int(dograh_user_id))
        )
    ).scalar_one_or_none()
    if member is None:
        raise HTTPException(403, "not a tenant member")
    tenant_id = member.tenant_id

    # Two paths to "this tenant's events":
    #   1. target_kind='tenant' AND target_id matches
    #   2. actor_kind='customer' AND actor_user_id is one of this
    #      tenant's members (catches events that didn't bother to set
    #      target_kind, like a tenant updating their own profile)
    member_ids = (
        await session.execute(
            select(TenantMember.dograh_user_id).where(TenantMember.tenant_id == tenant_id)
        )
    ).scalars().all()
    member_ids = [m for m in member_ids if m is not None]

    stmt = select(AuditLog)
    where_clauses = [
        (AuditLog.target_kind == "tenant") & (AuditLog.target_id == str(tenant_id))
    ]
    if member_ids:
        where_clauses.append(
            (AuditLog.actor_kind == "customer")
            & (AuditLog.actor_user_id.in_(member_ids))
        )
    stmt = stmt.where(or_(*where_clauses))

    if action:
        stmt = stmt.where(AuditLog.action.like(f"{action}%"))

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = int((await session.execute(count_stmt)).scalar_one())
    rows = (
        await session.execute(
            stmt.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
        )
    ).scalars().all()
    return {
        "total": total,
        "items": [
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
