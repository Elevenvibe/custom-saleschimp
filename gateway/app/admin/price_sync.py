"""Admin endpoints for the background price-sync cron.

GET  /api/admin/price-sync/status — current loop state + last iteration stats
POST /api/admin/price-sync/run    — fire run_once() immediately
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.billing.cron import get_status, run_once
from app.db import get_session
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/price-sync", tags=["admin:price-sync"])


@router.get("/status")
async def status(
    _claims: Annotated[dict, Depends(require_super_admin)],
) -> dict:
    return get_status()


@router.post("/run")
async def run_now(
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    stats = await run_once()
    # The run_once() helper records its own audit row when it upserts. We also
    # record a manual-trigger row so the audit log shows who clicked the button.
    actor_id: int | None = None
    sub = claims.get("sub", "")
    if sub.startswith("p_"):
        try:
            actor_id = int(sub[2:])
        except ValueError:
            actor_id = None
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=actor_id,
        action="admin.price_sync.run_now",
        payload=stats,
    )
    await session.commit()
    return stats
