from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_super_admin
from app.db import get_session
from app.plugins.models import InstalledPlugin

router = APIRouter(prefix="/plugins", tags=["admin:plugins"])


@router.get("")
async def list_plugins(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[dict]:
    """List installed plugins from the Control DB.

    Plugin discovery/install is P3+ work; for now this just reads what's
    recorded. The plugins/ folder on disk is scanned in P3 to populate this.
    """
    rows = (
        await session.execute(select(InstalledPlugin).order_by(InstalledPlugin.plugin_id))
    ).scalars().all()
    return [
        {
            "plugin_id": p.plugin_id,
            "version": p.version,
            "status": p.status,
            "manifest": p.manifest,
            "installed_at": p.installed_at.isoformat(),
            "updated_at": p.updated_at.isoformat(),
        }
        for p in rows
    ]
