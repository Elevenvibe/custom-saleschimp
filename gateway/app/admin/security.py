"""Super-admin security settings — 2FA + reCAPTCHA.

  GET   /api/admin/security                  status (both tabs)
  POST  /api/admin/security/totp/init        start TOTP setup → QR + secret
  POST  /api/admin/security/totp/enable      confirm a code → enable TOTP
  POST  /api/admin/security/totp/disable     disable TOTP (needs a valid code)
  POST  /api/admin/security/email-2fa        toggle email-code 2FA
  GET   /api/admin/security/recaptcha        reCAPTCHA config (no secret)
  PUT   /api/admin/security/recaptcha        save reCAPTCHA config

TOTP secrets are Fernet-encrypted at rest (app.email.crypto). The
reCAPTCHA secret key is likewise encrypted and never returned in full.
Login enforcement lives in auth/routes.py (super_admin_login).
"""

from __future__ import annotations

import base64
import io
from typing import Annotated, Literal

import pyotp
import segno
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.auth.models import PlatformSetting, PlatformUser
from app.db import get_session
from app.email.crypto import decrypt_dict, encrypt_dict
from app.email.service import _find_active  # presence check for email 2FA

router = APIRouter(prefix="/security", tags=["admin:security"])

_TOTP_ISSUER = "SalesChimp"


def _uid(claims: dict) -> int:
    sub = claims.get("sub", "")
    if isinstance(sub, str) and sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            pass
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot resolve platform user")


async def _user(session: AsyncSession, claims: dict) -> PlatformUser:
    u = await session.get(PlatformUser, _uid(claims))
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    return u


async def _email_provider_configured(session: AsyncSession) -> bool:
    """Is there an active transactional email provider? Email-2FA needs one
    to deliver login codes."""
    try:
        cfg = await _find_active(session, scope_kind="platform", scope_id=None)
        return cfg is not None
    except Exception:
        return False


# ---- status ----------------------------------------------------------

class SecurityStatus(BaseModel):
    email: str
    totp_enabled: bool
    email_2fa_enabled: bool
    email_provider_configured: bool


@router.get("", response_model=SecurityStatus)
async def get_status(
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SecurityStatus:
    u = await _user(session, claims)
    return SecurityStatus(
        email=u.email,
        totp_enabled=u.totp_enabled,
        email_2fa_enabled=u.email_2fa_enabled,
        email_provider_configured=await _email_provider_configured(session),
    )


# ---- TOTP ------------------------------------------------------------

class TotpInitOut(BaseModel):
    secret: str
    otpauth_uri: str
    qr_svg_data_uri: str


@router.post("/totp/init", response_model=TotpInitOut)
async def totp_init(
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TotpInitOut:
    u = await _user(session, claims)
    secret = pyotp.random_base32()
    u.totp_pending_enc = encrypt_dict({"secret": secret})
    await session.commit()

    uri = pyotp.totp.TOTP(secret).provisioning_uri(name=u.email, issuer_name=_TOTP_ISSUER)
    # Render the QR server-side (segno, pure-python) so the UI needs no QR lib.
    buf = io.BytesIO()
    segno.make(uri, error="m").save(buf, kind="svg", scale=4)
    svg_b64 = base64.b64encode(buf.getvalue()).decode()
    return TotpInitOut(
        secret=secret,
        otpauth_uri=uri,
        qr_svg_data_uri=f"data:image/svg+xml;base64,{svg_b64}",
    )


class CodeIn(BaseModel):
    code: str


def _pending_secret(u: PlatformUser) -> str | None:
    if not u.totp_pending_enc:
        return None
    try:
        return decrypt_dict(u.totp_pending_enc).get("secret")
    except Exception:
        return None


def _active_secret(u: PlatformUser) -> str | None:
    if not u.totp_secret_enc:
        return None
    try:
        return decrypt_dict(u.totp_secret_enc).get("secret")
    except Exception:
        return None


@router.post("/totp/enable", response_model=SecurityStatus)
async def totp_enable(
    body: CodeIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SecurityStatus:
    u = await _user(session, claims)
    secret = _pending_secret(u)
    if not secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "start setup first (totp/init)")
    if not pyotp.TOTP(secret).verify(body.code.strip(), valid_window=1):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "incorrect code")
    u.totp_secret_enc = u.totp_pending_enc
    u.totp_pending_enc = None
    u.totp_enabled = True
    await record_audit(
        session, actor_kind="platform", actor_user_id=u.id,
        action="admin.security.totp.enable", target_kind="platform_user",
        target_id=str(u.id), payload={},
    )
    await session.commit()
    return SecurityStatus(
        email=u.email, totp_enabled=True, email_2fa_enabled=u.email_2fa_enabled,
        email_provider_configured=await _email_provider_configured(session),
    )


@router.post("/totp/disable", response_model=SecurityStatus)
async def totp_disable(
    body: CodeIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SecurityStatus:
    u = await _user(session, claims)
    secret = _active_secret(u)
    if not u.totp_enabled or not secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "TOTP is not enabled")
    if not pyotp.TOTP(secret).verify(body.code.strip(), valid_window=1):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "incorrect code")
    u.totp_enabled = False
    u.totp_secret_enc = None
    u.totp_pending_enc = None
    await record_audit(
        session, actor_kind="platform", actor_user_id=u.id,
        action="admin.security.totp.disable", target_kind="platform_user",
        target_id=str(u.id), payload={},
    )
    await session.commit()
    return SecurityStatus(
        email=u.email, totp_enabled=False, email_2fa_enabled=u.email_2fa_enabled,
        email_provider_configured=await _email_provider_configured(session),
    )


class EmailTwoFaIn(BaseModel):
    enabled: bool


@router.post("/email-2fa", response_model=SecurityStatus)
async def toggle_email_2fa(
    body: EmailTwoFaIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SecurityStatus:
    u = await _user(session, claims)
    if body.enabled and not await _email_provider_configured(session):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Email SMTP settings not configured — configure an email provider first.",
        )
    u.email_2fa_enabled = body.enabled
    await record_audit(
        session, actor_kind="platform", actor_user_id=u.id,
        action="admin.security.email_2fa", target_kind="platform_user",
        target_id=str(u.id), payload={"enabled": body.enabled},
    )
    await session.commit()
    return SecurityStatus(
        email=u.email, totp_enabled=u.totp_enabled, email_2fa_enabled=body.enabled,
        email_provider_configured=True,
    )


# ---- reCAPTCHA -------------------------------------------------------

class RecaptchaOut(BaseModel):
    enabled: bool
    version: Literal["v2", "v3"]
    site_key: str
    has_secret: bool


class RecaptchaIn(BaseModel):
    enabled: bool
    version: Literal["v2", "v3"]
    site_key: str = ""
    secret_key: str | None = None  # write-only; omit to keep existing


async def _get_recaptcha_row(session: AsyncSession) -> PlatformSetting | None:
    return (
        await session.execute(select(PlatformSetting).where(PlatformSetting.key == "recaptcha"))
    ).scalar_one_or_none()


@router.get("/recaptcha", response_model=RecaptchaOut)
async def get_recaptcha(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> RecaptchaOut:
    row = await _get_recaptcha_row(session)
    v = (row.value if row else {}) or {}
    return RecaptchaOut(
        enabled=bool(v.get("enabled")),
        version=v.get("version") or "v2",
        site_key=v.get("site_key") or "",
        has_secret=bool(v.get("secret_key_enc")),
    )


@router.put("/recaptcha", response_model=RecaptchaOut)
async def put_recaptcha(
    body: RecaptchaIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> RecaptchaOut:
    row = await _get_recaptcha_row(session)
    value = dict(row.value) if row and row.value else {}
    value["enabled"] = body.enabled
    value["version"] = body.version
    value["site_key"] = body.site_key
    if body.secret_key:
        value["secret_key_enc"] = encrypt_dict({"secret": body.secret_key})
    if row is None:
        # New rows need an explicit value; mutating .value in place on an
        # existing row isn't picked up by JSONB, so reassign either way.
        session.add(PlatformSetting(key="recaptcha", value=value))
    else:
        row.value = value
    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.security.recaptcha", target_kind="platform_setting",
        target_id="recaptcha", payload={"enabled": body.enabled, "version": body.version},
    )
    await session.commit()
    return RecaptchaOut(
        enabled=body.enabled, version=body.version, site_key=body.site_key,
        has_secret=bool(value.get("secret_key_enc")),
    )
