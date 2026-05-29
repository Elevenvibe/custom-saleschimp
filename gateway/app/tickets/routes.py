"""Support-ticket routes.

Two routers:

  tenant_router   — mounted at /api/tenant/tickets, gated by require_customer.
                    Tenants only see their own tickets (tenant_id filter
                    derived from the JWT claims; client-supplied tenant_id
                    is ignored).

  admin_router    — mounted at /api/admin/tickets, gated by require_super_admin.
                    Platform staff can list/respond/close across all
                    tenants. The `tenant_id` query param scopes the list.

Both routers share the same response shape so the admin-ui can re-use
the customer types where it makes sense.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.customer_auth.deps import require_customer
from app.db import get_session
from app.notifications.service import notify_all_platform_users, notify_tenant
from app.tenants.models import Tenant, TenantMember
from app.tickets.models import SupportTicket, SupportTicketMessage


def _now() -> datetime:
    """Timezone-aware UTC now.

    The ticket columns are DateTime(timezone=True). Feeding a naive
    datetime.utcnow() back makes the in-memory row's read_at offset-
    naive while updated_at (loaded from postgres) stays offset-aware,
    and the `read_at < updated_at` comparison in _serialize_ticket
    raises TypeError → 500 on every detail fetch. The fix is to keep
    every datetime we *write* aware too.
    """
    return datetime.now(timezone.utc)


# ---- Pydantic shapes ---------------------------------------------------

TicketStatus = Literal["open", "in_progress", "resolved", "closed"]
TicketPriority = Literal["low", "normal", "high", "urgent"]


class TicketOut(BaseModel):
    id: int
    tenant_id: int
    subject: str
    status: TicketStatus
    priority: TicketPriority
    created_by_email: str
    created_at: str
    updated_at: str
    # True iff the platform has never opened the ticket OR a tenant
    # reply has come in since the last open. Powers the unread badge
    # on the Gmail-style ticket list.
    unread: bool = False


class TicketMessageOut(BaseModel):
    id: int
    ticket_id: int
    author_kind: Literal["tenant", "platform"]
    author_email: str
    body: str
    created_at: str


class TicketDetailOut(BaseModel):
    ticket: TicketOut
    messages: list[TicketMessageOut]


class TicketCreateIn(BaseModel):
    subject: str = Field(..., min_length=3, max_length=200)
    body: str = Field(..., min_length=1, max_length=10_000)
    priority: TicketPriority = "normal"


class TicketReplyIn(BaseModel):
    body: str = Field(..., min_length=1, max_length=10_000)


class TicketStatusIn(BaseModel):
    status: TicketStatus


def _serialize_ticket(t: SupportTicket) -> TicketOut:
    unread = t.read_at is None or t.read_at < t.updated_at
    return TicketOut(
        id=t.id,
        tenant_id=t.tenant_id,
        subject=t.subject,
        status=t.status,  # type: ignore[arg-type]
        priority=t.priority,  # type: ignore[arg-type]
        created_by_email=t.created_by_email,
        created_at=t.created_at.isoformat(),
        updated_at=t.updated_at.isoformat(),
        unread=unread,
    )


def _serialize_message(m: SupportTicketMessage) -> TicketMessageOut:
    return TicketMessageOut(
        id=m.id,
        ticket_id=m.ticket_id,
        author_kind=m.author_kind,  # type: ignore[arg-type]
        author_email=m.author_email,
        body=m.body,
        created_at=m.created_at.isoformat(),
    )


async def _resolve_tenant_id(session: AsyncSession, claims: dict) -> int:
    """Customer JWT → tenant_id. Looking up via the dograh user id is the
    same lookup require_customer-protected routes use elsewhere."""
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
    return member.tenant_id


# ---- Tenant-side router -----------------------------------------------

tenant_router = APIRouter(prefix="/tickets", tags=["tenant:tickets"])


@tenant_router.get("", response_model=list[TicketOut])
async def list_my_tickets(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status_filter: Annotated[
        TicketStatus | None,
        Query(alias="status", description="Filter to one of: open/in_progress/resolved/closed"),
    ] = None,
) -> list[TicketOut]:
    tenant_id = await _resolve_tenant_id(session, claims)
    stmt = select(SupportTicket).where(SupportTicket.tenant_id == tenant_id)
    if status_filter:
        stmt = stmt.where(SupportTicket.status == status_filter)
    rows = (await session.execute(stmt.order_by(desc(SupportTicket.updated_at)))).scalars().all()
    return [_serialize_ticket(t) for t in rows]


@tenant_router.post("", response_model=TicketOut, status_code=status.HTTP_201_CREATED)
async def open_ticket(
    body: TicketCreateIn,
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TicketOut:
    tenant_id = await _resolve_tenant_id(session, claims)
    email = claims.get("email") or "unknown"
    ticket = SupportTicket(
        tenant_id=tenant_id,
        subject=body.subject,
        priority=body.priority,
        status="open",
        created_by_email=email,
    )
    session.add(ticket)
    await session.flush()
    session.add(
        SupportTicketMessage(
            ticket_id=ticket.id,
            author_kind="tenant",
            author_email=email,
            body=body.body,
        )
    )
    await record_audit(
        session,
        actor_kind="customer",
        actor_user_id=None,
        action="tenant.ticket.open",
        target_kind="tenant",
        target_id=str(tenant_id),
        payload={"ticket_id": ticket.id, "subject": body.subject},
    )
    await _notify_platform_of_ticket(
        session,
        tenant_id=tenant_id,
        ticket_id=ticket.id,
        title="New support ticket",
        subject=body.subject,
    )
    await session.commit()
    return _serialize_ticket(ticket)


@tenant_router.get("/{ticket_id}", response_model=TicketDetailOut)
async def get_ticket(
    ticket_id: int,
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TicketDetailOut:
    tenant_id = await _resolve_tenant_id(session, claims)
    ticket = (
        await session.execute(
            select(SupportTicket).where(
                SupportTicket.id == ticket_id, SupportTicket.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if ticket is None:
        raise HTTPException(404, "ticket not found")
    msgs = (
        await session.execute(
            select(SupportTicketMessage)
            .where(SupportTicketMessage.ticket_id == ticket_id)
            .order_by(SupportTicketMessage.created_at)
        )
    ).scalars().all()
    return TicketDetailOut(
        ticket=_serialize_ticket(ticket),
        messages=[_serialize_message(m) for m in msgs],
    )


@tenant_router.post(
    "/{ticket_id}/reply", response_model=TicketMessageOut, status_code=status.HTTP_201_CREATED
)
async def tenant_reply(
    ticket_id: int,
    body: TicketReplyIn,
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TicketMessageOut:
    tenant_id = await _resolve_tenant_id(session, claims)
    ticket = (
        await session.execute(
            select(SupportTicket).where(
                SupportTicket.id == ticket_id, SupportTicket.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if ticket is None:
        raise HTTPException(404, "ticket not found")
    if ticket.status == "closed":
        raise HTTPException(409, "ticket is closed; open a new ticket")
    email = claims.get("email") or "unknown"
    msg = SupportTicketMessage(
        ticket_id=ticket_id,
        author_kind="tenant",
        author_email=email,
        body=body.body,
    )
    session.add(msg)
    # A tenant reply on a resolved ticket re-opens it — same convention
    # as Zendesk + Linear. Avoids stale "resolved" states when the
    # customer comes back with a follow-up.
    if ticket.status == "resolved":
        ticket.status = "open"
    ticket.updated_at = _now()
    await session.flush()
    await _notify_platform_of_ticket(
        session,
        tenant_id=tenant_id,
        ticket_id=ticket.id,
        title="New reply on a support ticket",
        subject=ticket.subject,
    )
    await session.commit()
    return _serialize_message(msg)


async def _notify_platform_of_ticket(
    session: AsyncSession,
    *,
    tenant_id: int,
    ticket_id: int,
    title: str,
    subject: str,
) -> None:
    """Emit a bell notification to every super-admin about tenant ticket
    activity. Best-effort: a notification failure must not fail the reply."""
    try:
        tenant = await session.get(Tenant, tenant_id)
        org = tenant.name if tenant else f"tenant #{tenant_id}"
        await notify_all_platform_users(
            session,
            title=title,
            body=f"{org}: {subject}",
            link=f"/tenants/{tenant_id}?tab=tickets&ticket={ticket_id}",
            category="ticket",
        )
    except Exception:  # noqa: BLE001 — notifications are non-critical
        pass


# ---- Admin-side router ------------------------------------------------

admin_router = APIRouter(prefix="/tickets", tags=["admin:tickets"])


@admin_router.get("", response_model=list[TicketOut])
async def list_all_tickets(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    tenant_id: int | None = None,
    status_filter: Annotated[TicketStatus | None, Query(alias="status")] = None,
    priority_filter: Annotated[TicketPriority | None, Query(alias="priority")] = None,
    # Search across subject + creator email. Case-insensitive substring.
    q: str | None = Query(None, min_length=1, max_length=200),
    created_from: str | None = Query(None, description="ISO YYYY-MM-DD, inclusive"),
    created_to: str | None = Query(None, description="ISO YYYY-MM-DD, inclusive"),
) -> list[TicketOut]:
    from datetime import date as _date, datetime as _dt, timedelta
    from sqlalchemy import func as _func, or_

    stmt = select(SupportTicket)
    if tenant_id is not None:
        stmt = stmt.where(SupportTicket.tenant_id == tenant_id)
    if status_filter:
        stmt = stmt.where(SupportTicket.status == status_filter)
    if priority_filter:
        stmt = stmt.where(SupportTicket.priority == priority_filter)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                _func.lower(SupportTicket.subject).like(like),
                _func.lower(SupportTicket.created_by_email).like(like),
            )
        )

    def _parse(d: str) -> _date:
        return _dt.strptime(d, "%Y-%m-%d").date()

    if created_from:
        try:
            stmt = stmt.where(SupportTicket.created_at >= _parse(created_from))
        except ValueError as e:
            raise HTTPException(400, f"created_from must be YYYY-MM-DD: {e}") from None
    if created_to:
        try:
            stmt = stmt.where(
                SupportTicket.created_at < _parse(created_to) + timedelta(days=1)
            )
        except ValueError as e:
            raise HTTPException(400, f"created_to must be YYYY-MM-DD: {e}") from None
    rows = (
        await session.execute(stmt.order_by(desc(SupportTicket.updated_at)))
    ).scalars().all()
    return [_serialize_ticket(t) for t in rows]


# Admin-side ticket creation — open a ticket on behalf of a tenant.
# Useful when staff captures a phone or live-chat issue and wants to
# track it in the same inbox the tenant can see.
class AdminTicketCreateIn(BaseModel):
    tenant_id: int
    subject: str = Field(..., min_length=3, max_length=200)
    body: str = Field(..., min_length=1, max_length=10_000)
    priority: TicketPriority = "normal"


@admin_router.post("", response_model=TicketOut, status_code=status.HTTP_201_CREATED)
async def admin_open_ticket(
    body: AdminTicketCreateIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TicketOut:
    # author_kind='platform' on the first message so the tenant can see
    # that staff opened this on their behalf.
    ticket = SupportTicket(
        tenant_id=body.tenant_id,
        subject=body.subject,
        priority=body.priority,
        status="open",
        created_by_email=claims.get("email") or "platform",
        read_at=_now(),  # we authored it; trivially read on our side
    )
    session.add(ticket)
    await session.flush()
    session.add(
        SupportTicketMessage(
            ticket_id=ticket.id,
            author_kind="platform",
            author_email=claims.get("email") or "platform",
            body=body.body,
        )
    )
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=claims.get("uid"),
        action="admin.ticket.open",
        target_kind="tenant",
        target_id=str(body.tenant_id),
        payload={"ticket_id": ticket.id, "subject": body.subject},
    )
    await session.commit()
    return _serialize_ticket(ticket)


@admin_router.get("/{ticket_id}", response_model=TicketDetailOut)
async def admin_get_ticket(
    ticket_id: int,
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TicketDetailOut:
    ticket = (
        await session.execute(select(SupportTicket).where(SupportTicket.id == ticket_id))
    ).scalar_one_or_none()
    if ticket is None:
        raise HTTPException(404, "ticket not found")
    # Mark as read by the platform side every time the detail is fetched.
    # Putting it here (vs a separate POST /read) keeps the read marker
    # in step with what the super-admin has actually viewed, no client
    # bookkeeping needed.
    ticket.read_at = _now()
    msgs = (
        await session.execute(
            select(SupportTicketMessage)
            .where(SupportTicketMessage.ticket_id == ticket_id)
            .order_by(SupportTicketMessage.created_at)
        )
    ).scalars().all()
    out = TicketDetailOut(
        ticket=_serialize_ticket(ticket),
        messages=[_serialize_message(m) for m in msgs],
    )
    await session.commit()
    return out


class TicketActionIn(BaseModel):
    ids: list[int] = Field(..., min_length=1, max_length=500)
    action: Literal["delete", "mark_read", "mark_unread"]


@admin_router.post("/actions")
async def admin_ticket_actions(
    body: TicketActionIn,
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Bulk delete / mark-read / mark-unread for tickets. Delete cascades
    to support_ticket_messages via the FK. Returns {affected: n}."""
    rows = (
        await session.execute(
            select(SupportTicket).where(SupportTicket.id.in_(body.ids))
        )
    ).scalars().all()
    affected = 0
    for t in rows:
        if body.action == "delete":
            await session.delete(t)
            affected += 1
        elif body.action == "mark_read":
            t.read_at = _now()
            affected += 1
        elif body.action == "mark_unread":
            t.read_at = None
            affected += 1
    await session.commit()
    return {"affected": affected}


@admin_router.post(
    "/{ticket_id}/reply", response_model=TicketMessageOut, status_code=status.HTTP_201_CREATED
)
async def admin_reply(
    ticket_id: int,
    body: TicketReplyIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TicketMessageOut:
    ticket = (
        await session.execute(select(SupportTicket).where(SupportTicket.id == ticket_id))
    ).scalar_one_or_none()
    if ticket is None:
        raise HTTPException(404, "ticket not found")
    email = claims.get("email") or "platform"
    msg = SupportTicketMessage(
        ticket_id=ticket_id,
        author_kind="platform",
        author_email=email,
        body=body.body,
    )
    session.add(msg)
    # Platform reply on an open ticket moves it to in_progress so the
    # status column reflects "we've seen this".
    if ticket.status == "open":
        ticket.status = "in_progress"
    ticket.updated_at = _now()
    await session.flush()
    # Tell the tenant their ticket got a reply. Best-effort.
    try:
        await notify_tenant(
            session,
            ticket.tenant_id,
            title="Support replied to your ticket",
            body=ticket.subject,
            link="/tickets",
            category="ticket",
        )
    except Exception:  # noqa: BLE001
        pass
    await session.commit()
    return _serialize_message(msg)


@admin_router.patch("/{ticket_id}/status", response_model=TicketOut)
async def admin_set_status(
    ticket_id: int,
    body: TicketStatusIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TicketOut:
    ticket = (
        await session.execute(select(SupportTicket).where(SupportTicket.id == ticket_id))
    ).scalar_one_or_none()
    if ticket is None:
        raise HTTPException(404, "ticket not found")
    ticket.status = body.status
    ticket.updated_at = _now()
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=claims.get("uid"),
        action="admin.ticket.status",
        target_kind="ticket",
        target_id=str(ticket_id),
        payload={"status": body.status, "tenant_id": ticket.tenant_id},
    )
    await session.commit()
    return _serialize_ticket(ticket)
