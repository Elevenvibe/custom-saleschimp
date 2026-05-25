from datetime import UTC, datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.auth.schemas import LoginIn, LoginOut
from app.auth.service import (
    find_platform_user_by_email,
    issue_super_admin_token,
    verify_password,
)
from app.db import get_session

log = structlog.get_logger()

router = APIRouter(tags=["auth"])


@router.post("/super-admin/login", response_model=LoginOut)
async def super_admin_login(
    body: LoginIn,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> LoginOut:
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
    return LoginOut(access_token=token, expires_in=expires_in, role=user.role)


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
