"""Tenant integrations — link a Google account + import Google Contacts.

  GET    /api/tenant/integrations/google               status (available / linked / counts)
  GET    /api/tenant/integrations/google/link/start     -> {url} (Google consent)
  GET    /api/tenant/integrations/google/link/callback   store tokens (public; signed state)
  POST   /api/tenant/integrations/google/contacts/import import via People API
  DELETE /api/tenant/integrations/google/link            unlink
  GET    /api/tenant/integrations/contacts               list imported contacts

Platform Google OAuth credentials come from Settings → Integrations (super-
admin). Each tenant links their own Google account against them; tokens are
Fernet-encrypted per tenant. Contacts import is idempotent (deduped per
resource_name) and tagged with an optional label.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Annotated, Any
from urllib.parse import urlencode

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.integrations import google_config
from app.auth.tokens import InvalidToken, TokenExpired, issue as issue_state, verify as verify_state
from app.config import settings
from app.customer_auth.deps import require_customer
from app.customer_auth.plans import _tenant_id_for
from app.db import get_session
from app.email.crypto import decrypt_dict, encrypt_dict
from app.integrations import google_client as gc
from app.integrations.models import Contact, GoogleLink

log = structlog.get_logger()

router = APIRouter(prefix="/integrations", tags=["tenant:integrations"])

_STATE_TTL = 600


async def _link(session: AsyncSession, tenant_id: int) -> GoogleLink | None:
    return (
        await session.execute(select(GoogleLink).where(GoogleLink.tenant_id == tenant_id))
    ).scalar_one_or_none()


async def _valid_access_token(
    session: AsyncSession, cfg: dict[str, Any], link: GoogleLink
) -> str | None:
    now = datetime.now(timezone.utc)
    if link.access_token_enc and link.token_expiry and link.token_expiry > now:
        try:
            return decrypt_dict(link.access_token_enc).get("secret")
        except Exception:  # noqa: BLE001
            pass
    if not link.refresh_token_enc:
        return None
    try:
        refresh = decrypt_dict(link.refresh_token_enc).get("secret")
    except Exception:  # noqa: BLE001
        return None
    tok = await gc.refresh_access_token(cfg, refresh_token=refresh)
    if not tok or not tok.get("access_token"):
        return None
    link.access_token_enc = encrypt_dict({"secret": tok["access_token"]})
    link.token_expiry = gc.expiry_from(tok)
    await session.commit()
    return tok["access_token"]


# ---- status ---------------------------------------------------------------


class GoogleStatus(BaseModel):
    available: bool  # platform configured this integration
    enabled_services: list[str]
    linked: bool
    google_email: str | None
    contact_count: int
    labels: list[str]


@router.get("/google", response_model=GoogleStatus)
async def google_status(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> GoogleStatus:
    tenant_id = await _tenant_id_for(session, claims)
    cfg = await google_config(session)
    available = bool(cfg["enabled"] and cfg["client_id"] and cfg["secret"] and cfg["callback_url"])
    link = await _link(session, tenant_id)
    count = (
        await session.execute(
            select(func.count()).select_from(Contact).where(Contact.tenant_id == tenant_id)
        )
    ).scalar_one()
    labels = (
        await session.execute(
            select(Contact.label)
            .where(Contact.tenant_id == tenant_id, Contact.label.is_not(None))
            .distinct()
        )
    ).scalars().all()
    return GoogleStatus(
        available=available,
        enabled_services=[s.split("/")[-1] for s in cfg["scopes"]],
        linked=link is not None and link.access_token_enc is not None,
        google_email=link.google_email if link else None,
        contact_count=int(count),
        labels=[lbl for lbl in labels if lbl],
    )


# ---- link flow ------------------------------------------------------------


@router.get("/google/link/start")
async def link_start(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    tenant_id = await _tenant_id_for(session, claims)
    cfg = await google_config(session)
    if not (cfg["enabled"] and cfg["client_id"] and cfg["secret"] and cfg["callback_url"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Google integration is not configured")
    state = issue_state(
        {"t": tenant_id, "n": secrets.token_urlsafe(8)}, ttl_seconds=_STATE_TTL
    )
    return {"url": gc.build_authorize_url(cfg, state=state)}


def _back(fragment: dict[str, str]) -> RedirectResponse:
    base = settings.customer_app_url.rstrip("/")
    return RedirectResponse(url=f"{base}/integrations#{urlencode(fragment)}", status_code=302)


@router.get("/google/link/callback")
async def link_callback(
    session: Annotated[AsyncSession, Depends(get_session)],
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
) -> RedirectResponse:
    if error:
        return _back({"google_error": error})
    if not state:
        return _back({"google_error": "missing state"})
    try:
        payload = verify_state(state)
    except (InvalidToken, TokenExpired):
        return _back({"google_error": "invalid or expired state"})
    tenant_id = int(payload.get("t", 0))
    if not tenant_id or not code:
        return _back({"google_error": "invalid callback"})

    cfg = await google_config(session)
    tok = await gc.exchange_code(cfg, code=code)
    if not tok or not tok.get("access_token"):
        return _back({"google_error": "could not complete Google sign-in"})

    email = await gc.fetch_email(tok["access_token"])
    link = await _link(session, tenant_id)
    if link is None:
        link = GoogleLink(tenant_id=tenant_id)
        session.add(link)
    link.google_email = email
    link.access_token_enc = encrypt_dict({"secret": tok["access_token"]})
    if tok.get("refresh_token"):
        link.refresh_token_enc = encrypt_dict({"secret": tok["refresh_token"]})
    link.token_expiry = gc.expiry_from(tok)
    link.scopes = tok.get("scope")
    await session.commit()
    log.info("google.linked", tenant_id=tenant_id, email=email)
    return _back({"google_linked": "1"})


@router.delete("/google/link", status_code=status.HTTP_204_NO_CONTENT)
async def unlink(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    tenant_id = await _tenant_id_for(session, claims)
    link = await _link(session, tenant_id)
    if link is not None:
        await session.delete(link)
        await session.commit()


# ---- contacts import ------------------------------------------------------


class ImportIn(BaseModel):
    label: str | None = None


class ImportOut(BaseModel):
    imported: int
    updated: int
    total_fetched: int


@router.post("/google/contacts/import", response_model=ImportOut)
async def import_contacts(
    body: ImportIn,
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ImportOut:
    tenant_id = await _tenant_id_for(session, claims)
    link = await _link(session, tenant_id)
    if link is None or link.access_token_enc is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "connect a Google account first")
    cfg = await google_config(session)
    token = await _valid_access_token(session, cfg, link)
    if not token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Google session expired — reconnect your account")

    people = await gc.list_connections(token)
    label = (body.label or "").strip() or None

    existing = {
        c.resource_name: c
        for c in (
            await session.execute(
                select(Contact).where(Contact.tenant_id == tenant_id, Contact.source == "google")
            )
        ).scalars().all()
        if c.resource_name
    }

    imported = updated = 0
    for p in people:
        rn = p.get("resource_name")
        if not rn:
            continue
        row = existing.get(rn)
        if row is None:
            session.add(
                Contact(
                    tenant_id=tenant_id,
                    source="google",
                    label=label,
                    display_name=p.get("display_name"),
                    email=p.get("email"),
                    phone=p.get("phone"),
                    resource_name=rn,
                )
            )
            imported += 1
        else:
            row.display_name = p.get("display_name")
            row.email = p.get("email")
            row.phone = p.get("phone")
            if label:
                row.label = label
            updated += 1
    await session.commit()
    log.info("google.contacts_imported", tenant_id=tenant_id, imported=imported, updated=updated)
    return ImportOut(imported=imported, updated=updated, total_fetched=len(people))


class ContactOut(BaseModel):
    id: int
    source: str
    label: str | None
    display_name: str | None
    email: str | None
    phone: str | None


@router.get("/contacts", response_model=list[ContactOut])
async def list_contacts(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
    label: str | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
) -> list[ContactOut]:
    tenant_id = await _tenant_id_for(session, claims)
    stmt = select(Contact).where(Contact.tenant_id == tenant_id)
    if label:
        stmt = stmt.where(Contact.label == label)
    stmt = stmt.order_by(Contact.display_name).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()
    return [
        ContactOut(
            id=c.id, source=c.source, label=c.label,
            display_name=c.display_name, email=c.email, phone=c.phone,
        )
        for c in rows
    ]
