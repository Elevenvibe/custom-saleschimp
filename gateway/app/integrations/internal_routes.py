"""Internal service-to-service routes for agent tools.

Dograh agent tools (Calendar / Docs / Contacts) run inside Dograh and need a
live Google access token for the tenant they're acting on behalf of. The
OAuth tokens live in THIS gateway (google_links), keyed by our tenant_id;
Dograh only knows its organization_id. This endpoint bridges that:

  GET /internal/integrations/google/token?org_id=<dograh_org_id>
      header: X-Internal-Token: <settings.internal_api_token>
      → { access_token, expires_at, google_email, services: [...] }

The token is refreshed if expired. Guarded by the shared internal token, not
a user session, since the caller is a server (Dograh), not a browser.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.integrations import google_config
from app.config import settings
from app.customer_auth.integrations import _link, _valid_access_token
from app.db import get_session
from app.tenants.models import Tenant

router = APIRouter(prefix="/internal/integrations", tags=["internal:integrations"])


def _require_internal(x_internal_token: Annotated[str | None, Header()] = None) -> None:
    if not x_internal_token or x_internal_token != settings.internal_api_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid internal token")


class TokenOut(BaseModel):
    access_token: str
    expires_at: str | None
    google_email: str | None
    services: list[str]


@router.get("/google/token", response_model=TokenOut)
async def google_token(
    _auth: Annotated[None, Depends(_require_internal)],
    session: Annotated[AsyncSession, Depends(get_session)],
    org_id: int = Query(..., description="Dograh organization id"),
) -> TokenOut:
    cfg = await google_config(session)
    if not cfg["enabled"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Google integration is not enabled")

    tenant = (
        await session.execute(select(Tenant).where(Tenant.dograh_org_id == org_id))
    ).scalar_one_or_none()
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no tenant for that org_id")

    link = await _link(session, tenant.id)
    if link is None or link.access_token_enc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant has not linked a Google account")

    token = await _valid_access_token(session, cfg, link)
    if not token:
        raise HTTPException(status.HTTP_409_CONFLICT, "Google session expired — tenant must reconnect")

    return TokenOut(
        access_token=token,
        expires_at=link.token_expiry.isoformat() if link.token_expiry else None,
        google_email=link.google_email,
        services=[s.split("/")[-1] for s in cfg["scopes"]],
    )
