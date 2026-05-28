"""Admin endpoints for the background mail-fetcher cron.

Mirrors app/admin/price_sync.py's shape so the Cronjob settings page in
admin-ui can render both crons with the same UI primitives.

GET  /api/admin/mail-cron/status — loop state + last tick stats
POST /api/admin/mail-cron/run    — fire one tick immediately
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth.deps import require_super_admin
from app.mailbox.cron import _tick, get_status

router = APIRouter(prefix="/mail-cron", tags=["admin:mail-cron"])


@router.get("/status")
async def status(
    _claims: Annotated[dict, Depends(require_super_admin)],
) -> dict:
    return get_status()


@router.post("/run")
async def run_now(
    _claims: Annotated[dict, Depends(require_super_admin)],
) -> dict:
    """Trigger one fetch sweep immediately. Useful for hitting "Run now"
    after configuring a fresh mailbox without waiting up to interval
    seconds for the next tick."""
    await _tick()
    return get_status()
