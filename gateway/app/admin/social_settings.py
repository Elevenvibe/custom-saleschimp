"""Super-admin Social login settings.

  GET  /api/admin/social-login            per-provider config snapshot
  PUT  /api/admin/social-login/{provider}  save one provider's config

Credentials (client id + secret + callback URL + enabled) per provider;
secret Fernet-encrypted, write-only. See app/auth/social.py for the registry
and OAuth machinery.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth import social
from app.auth.deps import require_super_admin
from app.db import get_session

router = APIRouter(prefix="/social-login", tags=["admin:social-login"])


def _uid(claims: dict) -> int | None:
    sub = claims.get("sub", "")
    if isinstance(sub, str) and sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            return None
    return None


@router.get("")
async def get_social(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, Any]:
    return {"providers": await social.get_admin_snapshot(session)}


class ProviderIn(BaseModel):
    enabled: bool
    client_id: str = ""
    callback_url: str = ""
    secret: str | None = None  # write-only


@router.put("/{provider}")
async def put_social(
    provider: str,
    body: ProviderIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, Any]:
    if not social.is_known(provider):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"unknown provider '{provider}'")
    await social.save_provider_config(
        session,
        provider,
        enabled=body.enabled,
        client_id=body.client_id,
        callback_url=body.callback_url,
        secret=body.secret,
    )
    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.social_login.update", target_kind="platform_setting",
        target_id=f"social_login.{provider}", payload={"enabled": body.enabled},
    )
    await session.commit()
    return {"providers": await social.get_admin_snapshot(session)}
