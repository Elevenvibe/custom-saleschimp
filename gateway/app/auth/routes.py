import random
from datetime import UTC, datetime, timedelta
from typing import Annotated

import pyotp
import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.auth.schemas import LoginIn, LoginResultOut
from app.auth.service import (
    find_platform_user_by_email,
    issue_super_admin_token,
    verify_password,
)
from app.db import get_session
from app.email.crypto import decrypt_dict
from app.tenants.suspension import notify_best_effort

log = structlog.get_logger()

router = APIRouter(tags=["auth"])

_EMAIL_2FA_TTL_MINUTES = 10


def _totp_secret(user) -> str | None:
    if not user.totp_secret_enc:
        return None
    try:
        return decrypt_dict(user.totp_secret_enc).get("secret")
    except Exception:
        return None


@router.post("/super-admin/login", response_model=LoginResultOut)
async def super_admin_login(
    body: LoginIn,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> LoginResultOut:
    user = await find_platform_user_by_email(session, body.email)
    if user is None or not verify_password(body.password, user.password_hash):
        # Audit the attempt without leaking which half failed.
        await record_audit(
            session,
            actor_kind="system",
            action="auth.super_admin.login.failed",
            target_kind="email",
            target_id=body.email,
            request=request,
        )
        await session.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")

    # ---- 2FA gate ----
    if user.totp_enabled or user.email_2fa_enabled:
        if not body.code:
            # First step: issue a challenge. For email 2FA, mail a code now.
            methods: list[str] = []
            if user.totp_enabled:
                methods.append("totp")
            if user.email_2fa_enabled:
                methods.append("email")
                code = f"{random.randint(0, 999999):06d}"
                user.login_2fa_code = code
                user.login_2fa_expires_at = datetime.now(UTC) + timedelta(
                    minutes=_EMAIL_2FA_TTL_MINUTES
                )
                await session.commit()
                await notify_best_effort(
                    session,
                    to=[user.email],
                    subject="Your login verification code",
                    body=f"Your login code is {code}. It expires in {_EMAIL_2FA_TTL_MINUTES} minutes.",
                    tenant_id=None,
                )
            else:
                await session.commit()
            return LoginResultOut(requires_2fa=True, methods=methods)

        # Second step: verify the supplied code (TOTP first, then email).
        code = body.code.strip()
        ok = False
        secret = _totp_secret(user)
        if user.totp_enabled and secret and pyotp.TOTP(secret).verify(code, valid_window=1):
            ok = True
        if (
            not ok
            and user.email_2fa_enabled
            and user.login_2fa_code
            and code == user.login_2fa_code
            and user.login_2fa_expires_at
            and user.login_2fa_expires_at >= datetime.now(UTC)
        ):
            ok = True
        if not ok:
            await record_audit(
                session, actor_kind="system", action="auth.super_admin.2fa.failed",
                target_kind="platform_user", target_id=str(user.id), request=request,
            )
            await session.commit()
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired 2FA code")
        user.login_2fa_code = None
        user.login_2fa_expires_at = None

    user.last_login_at = datetime.now(UTC)
    token, expires_in = issue_super_admin_token(user)

    await record_audit(
        session,
        actor_user_id=user.id,
        actor_kind="platform",
        action="auth.super_admin.login.succeeded",
        target_kind="platform_user",
        target_id=str(user.id),
        request=request,
    )
    await session.commit()

    log.info("super_admin.login", user_id=user.id, email=user.email)
    return LoginResultOut(access_token=token, expires_in=expires_in, role=user.role)


@router.get("/super-admin/me")
async def super_admin_me(
    claims: Annotated[dict, Depends(require_super_admin)],
) -> dict:
    """Echo the validated claims — handy for smoke-testing auth."""
    return {
        "sub": claims["sub"],
        "email": claims["email"],
        "role": claims["role"],
        "scopes": claims.get("scopes", []),
        "exp": claims["exp"],
    }
