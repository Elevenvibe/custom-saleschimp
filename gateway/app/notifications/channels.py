"""External notification channels — Pusher Channels, Pusher Beams, WhatsApp.

All three are configured in Settings → Notifications and stored in
platform_settings (secrets Fernet-encrypted). Every send is best-effort and
gated on the provider being enabled + configured: a misconfiguration or
outage must never break the action that emitted the notification.

Implemented with httpx (async, no extra deps):

  - Pusher Channels: signed REST trigger. We publish to PUBLIC channels named
    per recipient (e.g. "notif-platform-3"); the event carries NO payload
    beyond a nudge, so the client re-fetches from the authenticated REST
    endpoint. Keeps secrets/PII out of Pusher entirely — no private-channel
    auth endpoint needed.
  - Pusher Beams: web-push publish to device interests named per recipient.
  - WhatsApp: Meta WhatsApp Cloud API (Graph) text message send.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import PlatformSetting
from app.email.crypto import decrypt_dict, encrypt_dict

log = structlog.get_logger()

_HTTP_TIMEOUT = 8.0

PUSHER_KEY = "notifications.pusher"
BEAMS_KEY = "notifications.beams"
WHATSAPP_KEY = "notifications.whatsapp"


# ---- settings row helpers -------------------------------------------------


async def _get_row(session: AsyncSession, key: str) -> PlatformSetting | None:
    return (
        await session.execute(select(PlatformSetting).where(PlatformSetting.key == key))
    ).scalar_one_or_none()


async def _get_value(session: AsyncSession, key: str) -> dict[str, Any]:
    row = await _get_row(session, key)
    return dict(row.value) if row and row.value else {}


async def _save_value(session: AsyncSession, key: str, value: dict[str, Any]) -> None:
    row = await _get_row(session, key)
    if row is None:
        session.add(PlatformSetting(key=key, value=value))
    else:
        row.value = value


def _secret(value: dict[str, Any], enc_field: str) -> str | None:
    enc = value.get(enc_field)
    if not enc:
        return None
    try:
        return decrypt_dict(enc).get("secret")
    except Exception:  # noqa: BLE001
        return None


# ---- recipient → channel/interest naming ----------------------------------


def channel_name(recipient_kind: str, recipient_id: int) -> str:
    return f"notif-{recipient_kind}-{recipient_id}"


def beams_interest(recipient_kind: str, recipient_id: int) -> str:
    # Beams interests allow [A-Za-z0-9_=@,.;-]; our naming is already safe.
    return f"notif-{recipient_kind}-{recipient_id}"


# ---- public (no-secret) config for the client -----------------------------


async def public_realtime_config(
    session: AsyncSession, *, recipient_kind: str, recipient_id: int
) -> dict[str, Any]:
    """What the browser needs to subscribe — never includes secrets."""
    pusher = await _get_value(session, PUSHER_KEY)
    beams = await _get_value(session, BEAMS_KEY)
    pusher_ready = bool(
        pusher.get("enabled")
        and pusher.get("key")
        and pusher.get("cluster")
        and _secret(pusher, "secret_enc")
        and pusher.get("app_id")
    )
    beams_ready = bool(beams.get("enabled") and beams.get("instance_id") and _secret(beams, "secret_enc"))
    return {
        "pusher": {
            "enabled": pusher_ready,
            "key": pusher.get("key") or "",
            "cluster": pusher.get("cluster") or "",
            "channel": channel_name(recipient_kind, recipient_id) if pusher_ready else "",
            "event": "notification",
        },
        "beams": {
            "enabled": beams_ready,
            "instance_id": beams.get("instance_id") or "",
            "interest": beams_interest(recipient_kind, recipient_id) if beams_ready else "",
        },
    }


# ---- Pusher Channels (signed REST trigger) ---------------------------------


async def publish_pusher_event(
    session: AsyncSession,
    *,
    recipient_kind: str,
    recipient_id: int,
    payload: dict[str, Any],
) -> None:
    cfg = await _get_value(session, PUSHER_KEY)
    if not cfg.get("enabled"):
        return
    app_id = cfg.get("app_id")
    key = cfg.get("key")
    cluster = cfg.get("cluster")
    secret = _secret(cfg, "secret_enc")
    if not (app_id and key and cluster and secret):
        return

    channel = channel_name(recipient_kind, recipient_id)
    event = "notification"
    body = json.dumps(
        {"name": event, "channels": [channel], "data": json.dumps(payload)},
        separators=(",", ":"),
    ).encode()

    path = f"/apps/{app_id}/events"
    body_md5 = hashlib.md5(body).hexdigest()
    params = {
        "auth_key": key,
        "auth_timestamp": str(int(time.time())),
        "auth_version": "1.0",
        "body_md5": body_md5,
    }
    query = "&".join(f"{k}={params[k]}" for k in sorted(params))
    to_sign = f"POST\n{path}\n{query}"
    signature = hmac.new(secret.encode(), to_sign.encode(), hashlib.sha256).hexdigest()
    url = f"https://api-{cluster}.pusher.com{path}?{query}&auth_signature={signature}"

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(url, content=body, headers={"Content-Type": "application/json"})
            if resp.status_code >= 300:
                log.warning("pusher.publish_failed", status=resp.status_code, body=resp.text[:200])
    except Exception as e:  # noqa: BLE001
        log.warning("pusher.publish_error", error=str(e))


# ---- Pusher Beams (web push) -----------------------------------------------


async def publish_beams(
    session: AsyncSession,
    *,
    recipient_kind: str,
    recipient_id: int,
    title: str,
    body: str | None,
    link: str | None,
) -> None:
    cfg = await _get_value(session, BEAMS_KEY)
    if not cfg.get("enabled"):
        return
    instance_id = cfg.get("instance_id")
    secret = _secret(cfg, "secret_enc")
    if not (instance_id and secret):
        return

    interest = beams_interest(recipient_kind, recipient_id)
    url = (
        f"https://{instance_id}.pushnotifications.pusher.com"
        f"/publish_api/v1/instances/{instance_id}/publishes/interests"
    )
    web_payload: dict[str, Any] = {
        "notification": {"title": title, "body": body or ""},
    }
    if link:
        web_payload["notification"]["deep_link"] = link
    data = {"interests": [interest], "web": web_payload}

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(
                url,
                json=data,
                headers={
                    "Authorization": f"Bearer {secret}",
                    "Content-Type": "application/json",
                },
            )
            if resp.status_code >= 300:
                log.warning("beams.publish_failed", status=resp.status_code, body=resp.text[:200])
    except Exception as e:  # noqa: BLE001
        log.warning("beams.publish_error", error=str(e))


# ---- WhatsApp (Meta Cloud API) ---------------------------------------------


async def send_whatsapp(
    session: AsyncSession,
    *,
    to_phone: str,
    text: str,
) -> bool:
    """Send a freeform text WhatsApp message via the Cloud API. Returns True
    on a 2xx. Note: outside the 24h customer-service window Meta requires an
    approved template; freeform text is fine for replies to recent inbound."""
    cfg = await _get_value(session, WHATSAPP_KEY)
    if not cfg.get("enabled"):
        return False
    phone_number_id = cfg.get("phone_number_id")
    token = _secret(cfg, "token_enc")
    if not (phone_number_id and token and to_phone):
        return False

    # Normalize: Cloud API wants digits only (E.164 without '+').
    to = "".join(ch for ch in to_phone if ch.isdigit())
    if not to:
        return False

    url = f"https://graph.facebook.com/v21.0/{phone_number_id}/messages"
    data = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"body": text[:4000]},
    }
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(
                url, json=data, headers={"Authorization": f"Bearer {token}"}
            )
            if resp.status_code >= 300:
                log.warning("whatsapp.send_failed", status=resp.status_code, body=resp.text[:200])
                return False
            return True
    except Exception as e:  # noqa: BLE001
        log.warning("whatsapp.send_error", error=str(e))
        return False


# ---- settings accessors for the admin router -------------------------------


async def get_pusher_settings(session: AsyncSession) -> dict[str, Any]:
    v = await _get_value(session, PUSHER_KEY)
    return {
        "enabled": bool(v.get("enabled")),
        "app_id": v.get("app_id") or "",
        "key": v.get("key") or "",
        "cluster": v.get("cluster") or "",
        "has_secret": bool(v.get("secret_enc")),
    }


async def save_pusher_settings(
    session: AsyncSession,
    *,
    enabled: bool,
    app_id: str,
    key: str,
    cluster: str,
    secret: str | None,
) -> None:
    v = await _get_value(session, PUSHER_KEY)
    v.update({"enabled": enabled, "app_id": app_id, "key": key, "cluster": cluster})
    if secret:
        v["secret_enc"] = encrypt_dict({"secret": secret})
    await _save_value(session, PUSHER_KEY, v)


async def get_beams_settings(session: AsyncSession) -> dict[str, Any]:
    v = await _get_value(session, BEAMS_KEY)
    return {
        "enabled": bool(v.get("enabled")),
        "instance_id": v.get("instance_id") or "",
        "has_secret": bool(v.get("secret_enc")),
    }


async def save_beams_settings(
    session: AsyncSession,
    *,
    enabled: bool,
    instance_id: str,
    secret: str | None,
) -> None:
    v = await _get_value(session, BEAMS_KEY)
    v.update({"enabled": enabled, "instance_id": instance_id})
    if secret:
        v["secret_enc"] = encrypt_dict({"secret": secret})
    await _save_value(session, BEAMS_KEY, v)


async def get_whatsapp_settings(session: AsyncSession) -> dict[str, Any]:
    v = await _get_value(session, WHATSAPP_KEY)
    return {
        "enabled": bool(v.get("enabled")),
        "phone_number_id": v.get("phone_number_id") or "",
        "has_token": bool(v.get("token_enc")),
    }


async def save_whatsapp_settings(
    session: AsyncSession,
    *,
    enabled: bool,
    phone_number_id: str,
    token: str | None,
) -> None:
    v = await _get_value(session, WHATSAPP_KEY)
    v.update({"enabled": enabled, "phone_number_id": phone_number_id})
    if token:
        v["token_enc"] = encrypt_dict({"secret": token})
    await _save_value(session, WHATSAPP_KEY, v)
