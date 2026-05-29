"""reCAPTCHA verification, shared by every gateway-owned auth endpoint.

Config lives in platform_settings['recaptcha'] (set on Settings → Security):
  {enabled, version: v2|v3, site_key, secret_key_enc}

verify_recaptcha() is a no-op when reCAPTCHA is disabled/unconfigured, so
auth keeps working until an admin turns it on. When enabled it requires a
token and validates it against Google's siteverify; for v3 it also enforces
a minimum score.

public_config() exposes only the safe-to-render fields (enabled, version,
site_key) so login/signup pages can mount the widget.
"""

from __future__ import annotations

import httpx
import structlog
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import PlatformSetting
from app.email.crypto import decrypt_dict

log = structlog.get_logger()

_SITEVERIFY = "https://www.google.com/recaptcha/api/siteverify"
_V3_MIN_SCORE = 0.5


async def _config(session: AsyncSession) -> dict:
    row = (
        await session.execute(select(PlatformSetting).where(PlatformSetting.key == "recaptcha"))
    ).scalar_one_or_none()
    return (row.value if row else {}) or {}


async def public_config(session: AsyncSession) -> dict:
    v = await _config(session)
    return {
        "enabled": bool(v.get("enabled")) and bool(v.get("site_key")),
        "version": v.get("version") or "v2",
        "site_key": v.get("site_key") or "",
    }


async def verify_recaptcha(
    session: AsyncSession, token: str | None, *, remote_ip: str | None = None
) -> None:
    """Raise 400 if reCAPTCHA is enabled and the token is missing/invalid.
    No-op when disabled or unconfigured."""
    v = await _config(session)
    if not v.get("enabled"):
        return
    secret_enc = v.get("secret_key_enc")
    if not secret_enc:
        # Enabled but no secret saved — misconfiguration; don't hard-block
        # logins on it (would lock everyone out). Log loudly instead.
        log.warning("recaptcha.enabled_without_secret")
        return
    if not token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "reCAPTCHA verification required")
    try:
        secret = decrypt_dict(secret_enc).get("secret", "")
    except Exception:
        log.warning("recaptcha.secret_decrypt_failed")
        return
    if not secret:
        return

    data = {"secret": secret, "response": token}
    if remote_ip:
        data["remoteip"] = remote_ip
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(_SITEVERIFY, data=data)
        body = resp.json()
    except Exception as e:  # network error verifying — fail closed (it's auth).
        log.warning("recaptcha.verify_error", error=str(e))
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "could not verify reCAPTCHA") from None

    if not body.get("success"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "reCAPTCHA failed")
    if (v.get("version") or "v2") == "v3":
        score = body.get("score")
        if score is not None and float(score) < _V3_MIN_SCORE:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "reCAPTCHA score too low")
