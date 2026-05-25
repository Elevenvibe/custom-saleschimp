from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.models import AuditLog
from app.auth.deps import require_super_admin
from app.auth.models import PlatformUser
from app.db import get_session
from app.packages.models import Package
from app.plugins.models import InstalledPlugin
from app.tenants.models import Tenant

router = APIRouter()


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
