from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.models import AuditLog
from app.auth.deps import require_super_admin
from app.db import get_session

router = APIRouter(prefix="/audit", tags=["admin:audit"])


@router.get("")
async def list_audit(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    actor_kind: str | None = None,
    action: str | None = None,
    # Target filters — letting the Logs tab on /tenants/[id] pull only
    # entries that touch a single tenant. target_kind+target_id are the
    # exact pair we record everywhere a tenant is the action's target
    # (admin.tenant.create, customer.org.update, etc.).
    target_kind: str | None = None,
    target_id: str | None = None,
) -> dict:
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc())
    count_stmt = select(func.count()).select_from(AuditLog)
    if actor_kind:
        stmt = stmt.where(AuditLog.actor_kind == actor_kind)
        count_stmt = count_stmt.where(AuditLog.actor_kind == actor_kind)
    if action:
        stmt = stmt.where(AuditLog.action.like(f"{action}%"))
        count_stmt = count_stmt.where(AuditLog.action.like(f"{action}%"))
    if target_kind:
        stmt = stmt.where(AuditLog.target_kind == target_kind)
        count_stmt = count_stmt.where(AuditLog.target_kind == target_kind)
    if target_id:
        stmt = stmt.where(AuditLog.target_id == target_id)
        count_stmt = count_stmt.where(AuditLog.target_id == target_id)

    total = int((await session.execute(count_stmt)).scalar_one())
    rows = (await session.execute(stmt.limit(limit).offset(offset))).scalars().all()
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
                "payload": r.payload,
                "ip": r.ip,
                "ua": r.ua,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
    }
