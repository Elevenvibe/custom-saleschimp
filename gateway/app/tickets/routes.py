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

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.customer_auth.deps import require_customer
from app.db import get_session
from app.tenants.models import TenantMember
from app.tickets.models import SupportTicket, SupportTicketMessage


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
    return TicketOut(
        id=t.id,
        tenant_id=t.tenant_id,
        subject=t.subject,
        status=t.status,  # type: ignore[arg-type]
        priority=t.priority,  # type: ignore[arg-type]
        created_by_email=t.created_by_email,
        created_at=t.created_at.isoformat(),
        updated_at=t.updated_at.isoformat(),
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
    ticket.updated_at = datetime.utcnow()
    await session.flush()
    await session.commit()
    return _serialize_message(msg)


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
) -> list[TicketOut]:
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
    rows = (
        await session.execute(stmt.order_by(desc(SupportTicket.updated_at)))
    ).scalars().all()
    return [_serialize_ticket(t) for t in rows]


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
    ticket.updated_at = datetime.utcnow()
    await session.flush()
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
    ticket.updated_at = datetime.utcnow()
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
