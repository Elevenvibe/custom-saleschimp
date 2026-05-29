"""Super-admin Notification Settings.

  GET  /api/admin/notification-settings            full snapshot
  PUT  /api/admin/notification-settings            master toggles + type matrix
  PUT  /api/admin/notification-settings/pusher      Pusher Channels config
  PUT  /api/admin/notification-settings/beams       Pusher Beams config
  PUT  /api/admin/notification-settings/whatsapp     WhatsApp Cloud API config

Routing (master audience toggles + per-type channel matrix) lives in
platform_settings['notifications']; provider credentials live in their own
encrypted rows (see notifications/channels.py).
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
from app.notifications import channels
from app.notifications.service import ROUTING_KEY, _resolved_channels, get_routing
from app.notifications.types import NOTIFICATION_TYPES

router = APIRouter(prefix="/notification-settings", tags=["admin:notification-settings"])


def _uid(claims: dict) -> int | None:
    sub = claims.get("sub", "")
    if isinstance(sub, str) and sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            return None
    return None


# ---- snapshot -------------------------------------------------------------


class TypeRow(BaseModel):
    key: str
    label: str
    description: str
    audience: str
    channels: dict[str, bool]


class ProviderPusher(BaseModel):
    enabled: bool
    app_id: str
    key: str
    cluster: str
    has_secret: bool


class ProviderBeams(BaseModel):
    enabled: bool
    instance_id: str
    has_secret: bool


class ProviderWhatsApp(BaseModel):
    enabled: bool
    phone_number_id: str
    has_token: bool


class SettingsOut(BaseModel):
    send_to_tenants: bool
    send_to_admins: bool
    types: list[TypeRow]
    pusher: ProviderPusher
    beams: ProviderBeams
    whatsapp: ProviderWhatsApp


async def _snapshot(session: AsyncSession) -> SettingsOut:
    routing = await get_routing(session)
    rows = [
        TypeRow(
            key=t["key"],
            label=t["label"],
            description=t["description"],
            audience=t["audience"],
            channels=_resolved_channels(routing, t["key"]),
        )
        for t in NOTIFICATION_TYPES
    ]
    return SettingsOut(
        send_to_tenants=bool(routing.get("send_to_tenants", True)),
        send_to_admins=bool(routing.get("send_to_admins", True)),
        types=rows,
        pusher=ProviderPusher(**await channels.get_pusher_settings(session)),
        beams=ProviderBeams(**await channels.get_beams_settings(session)),
        whatsapp=ProviderWhatsApp(**await channels.get_whatsapp_settings(session)),
    )


@router.get("", response_model=SettingsOut)
async def get_settings(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SettingsOut:
    return await _snapshot(session)


# ---- routing (master toggles + type matrix) -------------------------------


class RoutingIn(BaseModel):
    send_to_tenants: bool
    send_to_admins: bool
    # {type_key: {bell, email, whatsapp}} — only the keys present are saved.
    types: dict[str, dict[str, bool]] = {}


@router.put("", response_model=SettingsOut)
async def put_routing(
    body: RoutingIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SettingsOut:
    row = (
        await session.execute(select(PlatformSetting).where(PlatformSetting.key == ROUTING_KEY))
    ).scalar_one_or_none()
    value: dict[str, Any] = dict(row.value) if row and row.value else {}
    value["send_to_tenants"] = body.send_to_tenants
    value["send_to_admins"] = body.send_to_admins
    # Normalize the incoming matrix to bool channels.
    types: dict[str, dict[str, bool]] = {}
    for key, chans in (body.types or {}).items():
        types[key] = {
            "bell": bool(chans.get("bell", True)),
            "email": bool(chans.get("email", False)),
            "whatsapp": bool(chans.get("whatsapp", False)),
        }
    value["types"] = types
    if row is None:
        session.add(PlatformSetting(key=ROUTING_KEY, value=value))
    else:
        row.value = value
    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.notifications.routing", target_kind="platform_setting",
        target_id=ROUTING_KEY,
        payload={"send_to_tenants": body.send_to_tenants, "send_to_admins": body.send_to_admins},
    )
    await session.commit()
    return await _snapshot(session)


# ---- provider configs -----------------------------------------------------


class PusherIn(BaseModel):
    enabled: bool
    app_id: str = ""
    key: str = ""
    cluster: str = ""
    secret: str | None = None  # write-only


@router.put("/pusher", response_model=ProviderPusher)
async def put_pusher(
    body: PusherIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProviderPusher:
    await channels.save_pusher_settings(
        session, enabled=body.enabled, app_id=body.app_id, key=body.key,
        cluster=body.cluster, secret=body.secret,
    )
    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.notifications.pusher", target_kind="platform_setting",
        target_id="notifications.pusher", payload={"enabled": body.enabled},
    )
    await session.commit()
    return ProviderPusher(**await channels.get_pusher_settings(session))


class BeamsIn(BaseModel):
    enabled: bool
    instance_id: str = ""
    secret: str | None = None  # write-only


@router.put("/beams", response_model=ProviderBeams)
async def put_beams(
    body: BeamsIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProviderBeams:
    await channels.save_beams_settings(
        session, enabled=body.enabled, instance_id=body.instance_id, secret=body.secret,
    )
    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.notifications.beams", target_kind="platform_setting",
        target_id="notifications.beams", payload={"enabled": body.enabled},
    )
    await session.commit()
    return ProviderBeams(**await channels.get_beams_settings(session))


class WhatsAppIn(BaseModel):
    enabled: bool
    phone_number_id: str = ""
    token: str | None = None  # write-only


@router.put("/whatsapp", response_model=ProviderWhatsApp)
async def put_whatsapp(
    body: WhatsAppIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProviderWhatsApp:
    await channels.save_whatsapp_settings(
        session, enabled=body.enabled, phone_number_id=body.phone_number_id, token=body.token,
    )
    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.notifications.whatsapp", target_kind="platform_setting",
        target_id="notifications.whatsapp", payload={"enabled": body.enabled},
    )
    await session.commit()
    return ProviderWhatsApp(**await channels.get_whatsapp_settings(session))
