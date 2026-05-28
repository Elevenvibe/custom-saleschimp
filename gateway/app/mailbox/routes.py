"""Mailbox config endpoints (SMTP outbox + IMAP inbox).

Two routers sharing the same JSON shape:

  admin_router    /api/admin/mailbox        require_super_admin
                  scope_kind defaults to 'platform' (the shared mailbox
                  the super-admin's Email tab reads/writes).

  tenant_router   /api/tenant/mailbox       require_org_admin
                  scope_kind always 'tenant'; scope_id derived from
                  JWT claims so a tenant can't set another tenant's
                  mailbox.

Credentials are Fernet-encrypted on the way in and never returned in
plaintext from the GET endpoint — the response surfaces presence flags
and the public-safe fields (host, port, username) only.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.customer_auth.deps import require_org_admin
from app.db import get_session
from app.email.crypto import encrypt_dict, decrypt_dict
from app.mailbox.models import MailboxConfig
from app.tenants.models import TenantMember


# ---- Pydantic shapes ---------------------------------------------------


class SmtpConfigIn(BaseModel):
    host: str
    port: int
    username: str
    password: str
    use_tls: bool = True


class ImapConfigIn(BaseModel):
    host: str
    port: int
    username: str
    password: str
    use_ssl: bool = True


class MailboxOut(BaseModel):
    smtp_active: bool
    imap_active: bool
    from_email: str | None = None
    from_name: str | None = None
    # Safe-to-show preview fields. We deliberately drop password/username
    # so the GET response is safe to render in the browser. Host + port
    # come back so the user can confirm what's saved.
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_username: str | None = None
    imap_host: str | None = None
    imap_port: int | None = None
    imap_username: str | None = None


class MailboxUpsertIn(BaseModel):
    from_email: EmailStr | None = None
    from_name: str | None = None
    smtp: SmtpConfigIn | None = None  # None = leave unchanged; explicit reset uses smtp_active=false
    imap: ImapConfigIn | None = None
    smtp_active: bool | None = None
    imap_active: bool | None = None


def _decrypt_preview(blob: dict | None) -> dict:
    """Best-effort decrypt to surface host/port/username back to the UI.
    Returns empty dict if no blob or decryption fails — we never let an
    error here block reading the config; the user can re-enter creds."""
    if not blob:
        return {}
    try:
        return decrypt_dict(blob)
    except Exception:
        return {}


def _serialize(m: MailboxConfig) -> MailboxOut:
    smtp = _decrypt_preview(m.smtp_config_encrypted)
    imap = _decrypt_preview(m.imap_config_encrypted)
    return MailboxOut(
        smtp_active=m.smtp_active,
        imap_active=m.imap_active,
        from_email=m.from_email,
        from_name=m.from_name,
        smtp_host=smtp.get("host"),
        smtp_port=smtp.get("port"),
        smtp_username=smtp.get("username"),
        imap_host=imap.get("host"),
        imap_port=imap.get("port"),
        imap_username=imap.get("username"),
    )


async def _get_or_create(
    session: AsyncSession, scope_kind: Literal["platform", "tenant"], scope_id: int | None
) -> MailboxConfig:
    row = (
        await session.execute(
            select(MailboxConfig).where(
                MailboxConfig.scope_kind == scope_kind,
                MailboxConfig.scope_id == scope_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = MailboxConfig(scope_kind=scope_kind, scope_id=scope_id)
        session.add(row)
        await session.flush()
    return row


def _apply_upsert(row: MailboxConfig, body: MailboxUpsertIn) -> None:
    if body.from_email is not None:
        row.from_email = body.from_email
    if body.from_name is not None:
        row.from_name = body.from_name
    if body.smtp is not None:
        row.smtp_config_encrypted = encrypt_dict(body.smtp.model_dump())
    if body.imap is not None:
        row.imap_config_encrypted = encrypt_dict(body.imap.model_dump())
    if body.smtp_active is not None:
        row.smtp_active = body.smtp_active
    if body.imap_active is not None:
        row.imap_active = body.imap_active


# ---- Admin (platform-scope) -------------------------------------------

admin_router = APIRouter(prefix="/mailbox", tags=["admin:mailbox"])


@admin_router.get("", response_model=MailboxOut)
async def admin_get_mailbox(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MailboxOut:
    row = await _get_or_create(session, "platform", None)
    return _serialize(row)


@admin_router.put("", response_model=MailboxOut)
async def admin_upsert_mailbox(
    body: MailboxUpsertIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MailboxOut:
    row = await _get_or_create(session, "platform", None)
    _apply_upsert(row, body)
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=claims.get("uid"),
        action="admin.mailbox.upsert",
        target_kind="mailbox",
        target_id="platform",
        payload={"smtp_active": row.smtp_active, "imap_active": row.imap_active},
    )
    await session.commit()
    return _serialize(row)


# ---- Tenant-scope -----------------------------------------------------

tenant_router = APIRouter(prefix="/mailbox", tags=["tenant:mailbox"])


async def _tenant_id_from_claims(session: AsyncSession, claims: dict) -> int:
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


@tenant_router.get("", response_model=MailboxOut)
async def tenant_get_mailbox(
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MailboxOut:
    tenant_id = await _tenant_id_from_claims(session, claims)
    row = await _get_or_create(session, "tenant", tenant_id)
    return _serialize(row)


@tenant_router.put("", response_model=MailboxOut)
async def tenant_upsert_mailbox(
    body: MailboxUpsertIn,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MailboxOut:
    tenant_id = await _tenant_id_from_claims(session, claims)
    row = await _get_or_create(session, "tenant", tenant_id)
    _apply_upsert(row, body)
    await record_audit(
        session,
        actor_kind="customer",
        actor_user_id=None,
        action="tenant.mailbox.upsert",
        target_kind="tenant",
        target_id=str(tenant_id),
        payload={"smtp_active": row.smtp_active, "imap_active": row.imap_active},
    )
    await session.commit()
    return _serialize(row)
