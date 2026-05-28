"""Mail list + send endpoints.

Two routers — same shape, different scope.

  admin_router    /api/admin/mail     scope=platform (the shared inbox)
  tenant_router   /api/tenant/mail    scope=tenant   (tenant's own inbox)

Both expose:
  GET    /                          list messages (inbox-style)
  GET    /{id}                      fetch one, mark read
  POST   /send                      enqueue an SMTP send
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_super_admin
from app.customer_auth.deps import require_org_admin
from app.db import get_session
from app.mailbox.mail_message import MailMessage
from app.mailbox.models import MailboxConfig
from app.mailbox.service import send_one
from app.tenants.models import TenantMember


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---- shapes -----------------------------------------------------------


class MailMessageOut(BaseModel):
    id: int
    direction: Literal["inbound", "outbound"]
    from_email: str
    from_name: str | None
    to_emails: list[str]
    subject: str
    body_text: str
    received_at: str
    read_at: str | None
    in_reply_to: str | None
    message_id: str | None
    unread: bool


class MailSendIn(BaseModel):
    to: list[EmailStr] = Field(..., min_length=1)
    subject: str = Field(..., max_length=500)
    body: str = Field(..., max_length=200_000)
    in_reply_to: str | None = None


def _serialize(m: MailMessage) -> MailMessageOut:
    return MailMessageOut(
        id=m.id,
        direction=m.direction,  # type: ignore[arg-type]
        from_email=m.from_email,
        from_name=m.from_name,
        to_emails=m.to_emails or [],
        subject=m.subject,
        body_text=m.body_text,
        received_at=m.received_at.isoformat(),
        read_at=m.read_at.isoformat() if m.read_at else None,
        in_reply_to=m.in_reply_to,
        message_id=m.message_id,
        unread=m.direction == "inbound" and m.read_at is None,
    )


async def _get_mailbox(
    session: AsyncSession,
    scope_kind: Literal["platform", "tenant"],
    scope_id: int | None,
) -> MailboxConfig:
    mb = (
        await session.execute(
            select(MailboxConfig).where(
                MailboxConfig.scope_kind == scope_kind,
                MailboxConfig.scope_id == scope_id,
            )
        )
    ).scalar_one_or_none()
    if mb is None:
        raise HTTPException(400, "No mailbox is configured for this scope.")
    return mb


async def _list_messages(
    session: AsyncSession,
    scope_kind: Literal["platform", "tenant"],
    scope_id: int | None,
    limit: int,
) -> list[MailMessageOut]:
    stmt = (
        select(MailMessage)
        .where(MailMessage.scope_kind == scope_kind, MailMessage.scope_id == scope_id)
        .order_by(desc(MailMessage.received_at))
        .limit(limit)
    )
    rows = (await session.execute(stmt)).scalars().all()
    return [_serialize(m) for m in rows]


async def _get_message(
    session: AsyncSession,
    scope_kind: Literal["platform", "tenant"],
    scope_id: int | None,
    msg_id: int,
) -> MailMessageOut:
    m = (
        await session.execute(
            select(MailMessage).where(
                MailMessage.id == msg_id,
                MailMessage.scope_kind == scope_kind,
                MailMessage.scope_id == scope_id,
            )
        )
    ).scalar_one_or_none()
    if m is None:
        raise HTTPException(404, "message not found")
    if m.direction == "inbound" and m.read_at is None:
        m.read_at = _now()
        await session.commit()
    return _serialize(m)


# ---- admin (platform scope) -------------------------------------------

admin_router = APIRouter(prefix="/mail", tags=["admin:mail"])


@admin_router.get("", response_model=list[MailMessageOut])
async def admin_list_mail(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = Query(100, ge=1, le=500),
) -> list[MailMessageOut]:
    return await _list_messages(session, "platform", None, limit)


@admin_router.get("/{msg_id}", response_model=MailMessageOut)
async def admin_get_mail(
    msg_id: int,
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MailMessageOut:
    return await _get_message(session, "platform", None, msg_id)


@admin_router.post("/send", response_model=MailMessageOut, status_code=status.HTTP_201_CREATED)
async def admin_send_mail(
    body: MailSendIn,
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MailMessageOut:
    mb = await _get_mailbox(session, "platform", None)
    try:
        row = await send_one(
            session,
            mb,
            to=[str(t) for t in body.to],
            subject=body.subject,
            body=body.body,
            in_reply_to=body.in_reply_to,
        )
    except RuntimeError as e:
        raise HTTPException(400, str(e)) from None
    return _serialize(row)


# ---- tenant scope -----------------------------------------------------

tenant_router = APIRouter(prefix="/mail", tags=["tenant:mail"])


async def _tenant_scope_id(session: AsyncSession, claims: dict) -> int:
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


@tenant_router.get("", response_model=list[MailMessageOut])
async def tenant_list_mail(
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = Query(100, ge=1, le=500),
) -> list[MailMessageOut]:
    tenant_id = await _tenant_scope_id(session, claims)
    return await _list_messages(session, "tenant", tenant_id, limit)


@tenant_router.get("/{msg_id}", response_model=MailMessageOut)
async def tenant_get_mail(
    msg_id: int,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MailMessageOut:
    tenant_id = await _tenant_scope_id(session, claims)
    return await _get_message(session, "tenant", tenant_id, msg_id)


@tenant_router.post("/send", response_model=MailMessageOut, status_code=status.HTTP_201_CREATED)
async def tenant_send_mail(
    body: MailSendIn,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MailMessageOut:
    tenant_id = await _tenant_scope_id(session, claims)
    mb = await _get_mailbox(session, "tenant", tenant_id)
    try:
        row = await send_one(
            session,
            mb,
            to=[str(t) for t in body.to],
            subject=body.subject,
            body=body.body,
            in_reply_to=body.in_reply_to,
        )
    except RuntimeError as e:
        raise HTTPException(400, str(e)) from None
    return _serialize(row)
