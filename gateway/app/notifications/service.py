"""Notification service — create + query helpers shared by the admin and
tenant routers.

Other parts of the system call `create_notification` (or the typed
`notify_platform_user` / `notify_tenant` wrappers) to emit a bell
notification. The routers call `list_notifications`, `mark_read`, and
`mark_all_read`.
"""

from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.notifications.models import Notification

# How many notifications the bell dropdown / page fetches by default.
DEFAULT_LIMIT = 20
MAX_LIMIT = 100


class NotificationOut(BaseModel):
    id: int
    category: str | None
    title: str
    body: str | None
    link: str | None
    read: bool
    created_at: str


class NotificationListOut(BaseModel):
    unread_count: int
    items: list[NotificationOut]


def _serialize(n: Notification) -> NotificationOut:
    return NotificationOut(
        id=n.id,
        category=n.category,
        title=n.title,
        body=n.body,
        link=n.link,
        read=n.read_at is not None,
        created_at=n.created_at.isoformat(),
    )


async def create_notification(
    session: AsyncSession,
    *,
    recipient_kind: str,
    recipient_id: int,
    title: str,
    body: str | None = None,
    link: str | None = None,
    category: str | None = None,
) -> Notification:
    """Persist a notification. Caller owns the commit so this can ride
    along inside a larger transaction (e.g. created alongside a ticket)."""
    if recipient_kind not in ("platform", "tenant"):
        raise ValueError("recipient_kind must be 'platform' or 'tenant'")
    n = Notification(
        recipient_kind=recipient_kind,
        recipient_id=recipient_id,
        title=title[:255],
        body=body,
        link=link,
        category=category,
    )
    session.add(n)
    await session.flush()
    return n


async def notify_platform_user(
    session: AsyncSession,
    user_id: int,
    *,
    title: str,
    body: str | None = None,
    link: str | None = None,
    category: str | None = None,
) -> Notification:
    return await create_notification(
        session,
        recipient_kind="platform",
        recipient_id=user_id,
        title=title,
        body=body,
        link=link,
        category=category,
    )


async def notify_all_platform_users(
    session: AsyncSession,
    *,
    title: str,
    body: str | None = None,
    link: str | None = None,
    category: str | None = None,
) -> int:
    """Fan a notification out to every super-admin. There's no single
    'platform inbox' concept — each platform_user has their own bell — so
    a system event (e.g. a new tenant ticket) creates one row per admin.
    Returns the number of admins notified."""
    # Local import to avoid a circular dependency at module load
    # (auth.models → ... → notifications).
    from app.auth.models import PlatformUser

    ids = (await session.execute(select(PlatformUser.id))).scalars().all()
    for uid in ids:
        await create_notification(
            session,
            recipient_kind="platform",
            recipient_id=int(uid),
            title=title,
            body=body,
            link=link,
            category=category,
        )
    return len(ids)


async def notify_tenant(
    session: AsyncSession,
    tenant_id: int,
    *,
    title: str,
    body: str | None = None,
    link: str | None = None,
    category: str | None = None,
) -> Notification:
    return await create_notification(
        session,
        recipient_kind="tenant",
        recipient_id=tenant_id,
        title=title,
        body=body,
        link=link,
        category=category,
    )


async def list_notifications(
    session: AsyncSession,
    *,
    recipient_kind: str,
    recipient_id: int,
    limit: int = DEFAULT_LIMIT,
    only_unread: bool = False,
) -> NotificationListOut:
    limit = max(1, min(limit, MAX_LIMIT))
    base = (
        select(Notification)
        .where(
            Notification.recipient_kind == recipient_kind,
            Notification.recipient_id == recipient_id,
        )
    )
    if only_unread:
        base = base.where(Notification.read_at.is_(None))
    rows = (
        await session.execute(
            base.order_by(Notification.created_at.desc()).limit(limit)
        )
    ).scalars().all()

    unread = (
        await session.execute(
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.recipient_kind == recipient_kind,
                Notification.recipient_id == recipient_id,
                Notification.read_at.is_(None),
            )
        )
    ).scalar_one()

    return NotificationListOut(
        unread_count=int(unread),
        items=[_serialize(n) for n in rows],
    )


async def mark_read(
    session: AsyncSession,
    *,
    recipient_kind: str,
    recipient_id: int,
    notification_id: int,
) -> bool:
    """Stamp read_at on a single notification the caller owns. Returns
    False if no matching unread/owned row was found."""
    n = await session.get(Notification, notification_id)
    if (
        n is None
        or n.recipient_kind != recipient_kind
        or n.recipient_id != recipient_id
    ):
        return False
    if n.read_at is None:
        n.read_at = datetime.now(timezone.utc)
    await session.commit()
    return True


async def mark_all_read(
    session: AsyncSession,
    *,
    recipient_kind: str,
    recipient_id: int,
) -> int:
    """Mark every unread notification for this recipient read. Returns the
    number of rows updated."""
    result = await session.execute(
        update(Notification)
        .where(
            Notification.recipient_kind == recipient_kind,
            Notification.recipient_id == recipient_id,
            Notification.read_at.is_(None),
        )
        .values(read_at=datetime.now(timezone.utc))
    )
    await session.commit()
    return int(result.rowcount or 0)
