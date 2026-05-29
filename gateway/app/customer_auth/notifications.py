"""Tenant notification bell.

  GET  /api/tenant/notifications            list (most-recent first) + unread count
  POST /api/tenant/notifications/{id}/read  mark one read
  POST /api/tenant/notifications/read-all   mark all read

Recipient is the caller's tenant (org-wide). Any authenticated member of
the tenant sees and can clear the org's notifications.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.customer_auth.deps import require_customer
from app.customer_auth.plans import _tenant_id_for
from app.db import get_session
from app.notifications import channels
from app.notifications.service import (
    NotificationListOut,
    list_notifications,
    mark_all_read,
    mark_read,
)

router = APIRouter(prefix="/notifications", tags=["customer-auth:notifications"])

_KIND = "tenant"


@router.get("", response_model=NotificationListOut)
async def list_notes(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = Query(20, ge=1, le=100),
    only_unread: bool = Query(False),
) -> NotificationListOut:
    tenant_id = await _tenant_id_for(session, claims)
    return await list_notifications(
        session,
        recipient_kind=_KIND,
        recipient_id=tenant_id,
        limit=limit,
        only_unread=only_unread,
    )


@router.get("/realtime-config")
async def realtime_config(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Public (no-secret) config for the browser to subscribe to live
    notifications for THIS tenant's channel/interest."""
    tenant_id = await _tenant_id_for(session, claims)
    return await channels.public_realtime_config(
        session, recipient_kind=_KIND, recipient_id=tenant_id
    )


@router.post("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def read_one(
    notification_id: int,
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    tenant_id = await _tenant_id_for(session, claims)
    ok = await mark_read(
        session,
        recipient_kind=_KIND,
        recipient_id=tenant_id,
        notification_id=notification_id,
    )
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "notification not found")


@router.post("/read-all")
async def read_all(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    tenant_id = await _tenant_id_for(session, claims)
    n = await mark_all_read(session, recipient_kind=_KIND, recipient_id=tenant_id)
    return {"updated": n}
