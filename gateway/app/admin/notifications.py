"""Super-admin notification bell.

  GET  /api/admin/notifications            list (most-recent first) + unread count
  POST /api/admin/notifications/{id}/read  mark one read
  POST /api/admin/notifications/read-all   mark all read

Recipient is the calling super-admin (platform_users.id from the JWT sub).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_super_admin
from app.db import get_session
from app.notifications import channels
from app.notifications.service import (
    NotificationListOut,
    list_notifications,
    mark_all_read,
    mark_read,
)

router = APIRouter(prefix="/notifications", tags=["admin:notifications"])

_KIND = "platform"


def _uid(claims: dict) -> int:
    sub = claims.get("sub", "")
    if isinstance(sub, str) and sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            pass
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot resolve platform user")


@router.get("", response_model=NotificationListOut)
async def list_notes(
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = Query(20, ge=1, le=100),
    only_unread: bool = Query(False),
) -> NotificationListOut:
    return await list_notifications(
        session,
        recipient_kind=_KIND,
        recipient_id=_uid(claims),
        limit=limit,
        only_unread=only_unread,
    )


@router.get("/realtime-config")
async def realtime_config(
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Public (no-secret) config for the browser to subscribe to live
    notifications for THIS super-admin's channel/interest."""
    return await channels.public_realtime_config(
        session, recipient_kind=_KIND, recipient_id=_uid(claims)
    )


@router.post("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def read_one(
    notification_id: int,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    ok = await mark_read(
        session,
        recipient_kind=_KIND,
        recipient_id=_uid(claims),
        notification_id=notification_id,
    )
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "notification not found")


@router.post("/read-all")
async def read_all(
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    n = await mark_all_read(session, recipient_kind=_KIND, recipient_id=_uid(claims))
    return {"updated": n}
