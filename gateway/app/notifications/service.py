"""Notification service — create + query helpers shared by the admin and
tenant routers.

Other parts of the system call `create_notification` (or the typed
`notify_platform_user` / `notify_tenant` wrappers) to emit a bell
notification. The routers call `list_notifications`, `mark_read`, and
`mark_all_read`.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import structlog
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.notifications import channels
from app.notifications.models import Notification
from app.notifications.types import default_channels

log = structlog.get_logger()

ROUTING_KEY = "notifications"

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


# ---- Routing + multi-channel dispatch -------------------------------------
#
# dispatch_* is the high-level entrypoint other modules call. It consults the
# routing settings (master audience toggles + per-type channel matrix), writes
# the in-app bell row, and fans out to the enabled external channels (Pusher
# Channels nudge, Beams web-push, email, WhatsApp). Every external send is
# best-effort; the bell row is the source of truth.


def _default_routing() -> dict[str, Any]:
    return {"send_to_tenants": True, "send_to_admins": True, "types": {}}


async def get_routing(session: AsyncSession) -> dict[str, Any]:
    """Read the routing settings, falling back to defaults. Per-type channel
    config is merged over the registry defaults at read time."""
    from app.auth.models import PlatformSetting

    row = (
        await session.execute(
            select(PlatformSetting).where(PlatformSetting.key == ROUTING_KEY)
        )
    ).scalar_one_or_none()
    value = dict(row.value) if row and row.value else _default_routing()
    value.setdefault("send_to_tenants", True)
    value.setdefault("send_to_admins", True)
    value.setdefault("types", {})
    return value


def _resolved_channels(routing: dict[str, Any], type_key: str) -> dict[str, bool]:
    base = default_channels(type_key)
    override = (routing.get("types") or {}).get(type_key)
    if isinstance(override, dict):
        for ch in ("bell", "email", "whatsapp"):
            if ch in override:
                base[ch] = bool(override[ch])
    return base


def _audience_allowed(routing: dict[str, Any], recipient_kind: str) -> bool:
    if recipient_kind == "platform":
        return bool(routing.get("send_to_admins", True))
    return bool(routing.get("send_to_tenants", True))


async def dispatch_notification(
    session: AsyncSession,
    *,
    type_key: str,
    recipient_kind: str,
    recipient_id: int,
    title: str,
    body: str | None = None,
    link: str | None = None,
    email_to: str | None = None,
    phone: str | None = None,
    routing: dict[str, Any] | None = None,
) -> Notification | None:
    """Route a single notification across enabled channels. Returns the bell
    row (or None when the audience is disabled or the bell channel is off)."""
    routing = routing if routing is not None else await get_routing(session)
    if not _audience_allowed(routing, recipient_kind):
        return None

    ch = _resolved_channels(routing, type_key)
    note: Notification | None = None

    if ch.get("bell", True):
        note = await create_notification(
            session,
            recipient_kind=recipient_kind,
            recipient_id=recipient_id,
            title=title,
            body=body,
            link=link,
            category=type_key,
        )
        # Real-time nudges — the client re-fetches the authenticated list.
        await channels.publish_pusher_event(
            session,
            recipient_kind=recipient_kind,
            recipient_id=recipient_id,
            payload={"title": title, "category": type_key},
        )
        await channels.publish_beams(
            session,
            recipient_kind=recipient_kind,
            recipient_id=recipient_id,
            title=title,
            body=body,
            link=link,
        )

    if ch.get("email") and email_to:
        try:
            from app.tenants.suspension import notify_best_effort

            await notify_best_effort(
                session,
                to=[email_to],
                subject=title,
                body=body or title,
                tenant_id=recipient_id if recipient_kind == "tenant" else None,
            )
        except Exception as e:  # noqa: BLE001
            log.warning("notify.email_failed", error=str(e), type=type_key)

    if ch.get("whatsapp") and phone:
        try:
            await channels.send_whatsapp(
                session, to_phone=phone, text=f"{title}\n\n{body}" if body else title
            )
        except Exception as e:  # noqa: BLE001
            log.warning("notify.whatsapp_failed", error=str(e), type=type_key)

    return note


async def dispatch_to_tenant(
    session: AsyncSession,
    tenant_id: int,
    *,
    type_key: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
) -> Notification | None:
    """Dispatch to a tenant, resolving the org's email + phone for the
    email/WhatsApp channels."""
    from app.tenants.models import Tenant

    tenant = await session.get(Tenant, tenant_id)
    email_to = tenant.owner_email if tenant else None
    phone = tenant.company_phone if tenant else None
    return await dispatch_notification(
        session,
        type_key=type_key,
        recipient_kind="tenant",
        recipient_id=tenant_id,
        title=title,
        body=body,
        link=link,
        email_to=email_to,
        phone=phone,
    )


async def dispatch_to_all_admins(
    session: AsyncSession,
    *,
    type_key: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
) -> int:
    """Fan a platform notification out to every super-admin, resolving each
    one's email + mobile for the email/WhatsApp channels. Returns the count."""
    from app.auth.models import PlatformUser

    routing = await get_routing(session)
    if not _audience_allowed(routing, "platform"):
        return 0
    admins = (
        await session.execute(select(PlatformUser.id, PlatformUser.email, PlatformUser.mobile))
    ).all()
    for uid, email, mobile in admins:
        await dispatch_notification(
            session,
            type_key=type_key,
            recipient_kind="platform",
            recipient_id=int(uid),
            title=title,
            body=body,
            link=link,
            email_to=email,
            phone=mobile,
            routing=routing,
        )
    return len(admins)
