"""Super-admin Integrations settings — Google Services.

  GET  /api/admin/integrations/google     config snapshot (no secret)
  PUT  /api/admin/integrations/google     save config

Platform-level Google OAuth credentials that power the tenant-facing Google
integrations (Calendar, Docs, Contacts). The super-admin registers ONE Google
Cloud OAuth app here; tenants then link their own Google account against it
(per-tenant linking + Contacts import is the next chunk and builds on this).

Secret Fernet-encrypted, write-only. Stored in
platform_settings['integrations_google'].
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.auth.models import PlatformSetting
from app.db import get_session
from app.email.crypto import decrypt_dict, encrypt_dict

router = APIRouter(prefix="/integrations", tags=["admin:integrations"])

_KEY = "integrations_google"

# Google service → the OAuth scope it needs + a human label. Tenants consent
# to the union of the enabled services' scopes when they link their account.
GOOGLE_SERVICES = {
    "contacts": {
        "label": "Google Contacts",
        "scope": "https://www.googleapis.com/auth/contacts.readonly",
        "description": "Let tenants import contacts from their Google account.",
    },
    "calendar": {
        "label": "Google Calendar",
        "scope": "https://www.googleapis.com/auth/calendar",
        "description": "Let agent tools read/write calendar events.",
    },
    "docs": {
        "label": "Google Docs",
        "scope": "https://www.googleapis.com/auth/documents",
        "description": "Let agent tools read/write Google Docs.",
    },
}


def _uid(claims: dict) -> int | None:
    sub = claims.get("sub", "")
    if isinstance(sub, str) and sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            return None
    return None


async def _row(session: AsyncSession) -> PlatformSetting | None:
    return (
        await session.execute(select(PlatformSetting).where(PlatformSetting.key == _KEY))
    ).scalar_one_or_none()


async def _value(session: AsyncSession) -> dict[str, Any]:
    row = await _row(session)
    return dict(row.value) if row and row.value else {}


class ServiceOut(BaseModel):
    key: str
    label: str
    description: str
    scope: str
    enabled: bool


class GoogleOut(BaseModel):
    enabled: bool
    client_id: str
    callback_url: str
    has_secret: bool
    services: list[ServiceOut]


def _serialize(v: dict[str, Any]) -> GoogleOut:
    svc_state = v.get("services") or {}
    services = [
        ServiceOut(
            key=k,
            label=meta["label"],
            description=meta["description"],
            scope=meta["scope"],
            enabled=bool(svc_state.get(k, k == "contacts")),  # contacts on by default
        )
        for k, meta in GOOGLE_SERVICES.items()
    ]
    return GoogleOut(
        enabled=bool(v.get("enabled")),
        client_id=v.get("client_id") or "",
        callback_url=v.get("callback_url") or "",
        has_secret=bool(v.get("secret_enc")),
        services=services,
    )


@router.get("/google", response_model=GoogleOut)
async def get_google(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> GoogleOut:
    return _serialize(await _value(session))


class GoogleIn(BaseModel):
    enabled: bool
    client_id: str = ""
    callback_url: str = ""
    secret: str | None = None  # write-only
    services: dict[str, bool] = {}


@router.put("/google", response_model=GoogleOut)
async def put_google(
    body: GoogleIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> GoogleOut:
    v = await _value(session)
    v["enabled"] = body.enabled
    v["client_id"] = body.client_id.strip()
    v["callback_url"] = body.callback_url.strip()
    if body.secret:
        v["secret_enc"] = encrypt_dict({"secret": body.secret})
    # Only persist known service keys.
    svc = dict(v.get("services") or {})
    for k in GOOGLE_SERVICES:
        if k in body.services:
            svc[k] = bool(body.services[k])
    v["services"] = svc

    row = await _row(session)
    if row is None:
        session.add(PlatformSetting(key=_KEY, value=v))
    else:
        row.value = v
    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.integrations.google", target_kind="platform_setting",
        target_id=_KEY, payload={"enabled": body.enabled},
    )
    await session.commit()
    return _serialize(v)


# ---- shared accessors (used by the tenant link/import flow next chunk) -----


async def google_config(session: AsyncSession) -> dict[str, Any]:
    """Decrypted config + the active scope set for enabled services."""
    v = await _value(session)
    enc = v.get("secret_enc")
    secret = None
    if enc:
        try:
            secret = decrypt_dict(enc).get("secret")
        except Exception:  # noqa: BLE001
            secret = None
    svc_state = v.get("services") or {}
    scopes = [
        meta["scope"]
        for k, meta in GOOGLE_SERVICES.items()
        if svc_state.get(k, k == "contacts")
    ]
    return {
        "enabled": bool(v.get("enabled")),
        "client_id": v.get("client_id") or "",
        "callback_url": v.get("callback_url") or "",
        "secret": secret,
        "scopes": scopes,
    }
