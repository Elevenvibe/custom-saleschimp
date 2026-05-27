"""POST /api/auth/session-exchange — Dograh session → sc_customer_token.

The console (port 3040, served via nginx at /console/*) is same-origin with
Dograh's UI. After a customer logs into Dograh they have a `dograh_auth_token`
cookie. To call our `/api/tenant/*` routes, the console hands that token to
this endpoint, we verify it against Dograh's /api/v1/auth/me, look up the
matching TenantMember, and mint a normal sc_customer_token.

The console layout calls this on mount, stashes the resulting JWT in
localStorage as `sc_customer_token`, and every downstream `/api/tenant/*`
fetch sends `Authorization: Bearer <that>`. From then on the existing
require_customer / require_org_admin deps work unchanged.

Why not have the gateway read the cookie directly on every /api/tenant/*
request? Two reasons:
  1. CORS — gateway is on a different origin (8080) than the proxied
     console (8081). Cookies don't cross origins; tokens in headers do.
  2. One Dograh round-trip per gateway call would add latency to every
     hot-path read; exchanging once gives us a clean JWT cached locally.
"""

from typing import Annotated

import structlog
from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.service import issue_customer_token
from app.db import get_session
from app.dograh_client import DograhClient, DograhError
from app.tenants.models import Tenant, TenantMember

log = structlog.get_logger()

router = APIRouter(tags=["customer-auth:session-exchange"])


class ExchangeOut(BaseModel):
    access_token: str
    expires_in: int
    role: str
    org_id: int
    tenant_slug: str
    email: str


@router.post("/session-exchange", response_model=ExchangeOut)
async def exchange(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    # The console can pass the token in either an Authorization header
    # (which works through cross-origin fetches once we add CORS) or as
    # a cookie name we proxy through. Header is preferred — console reads
    # the dograh_auth_token cookie client-side and forwards it explicitly,
    # which keeps the gateway free of cookie-domain coupling.
    authorization: Annotated[str | None, Header()] = None,
    dograh_auth_token: Annotated[str | None, Cookie()] = None,
) -> ExchangeOut:
    token = _pick_token(authorization, dograh_auth_token)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing dograh auth token")

    client = DograhClient()
    try:
        dograh_user = await client.get_me(token=token)
    except DograhError as e:
        if e.status_code == 401:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "dograh session invalid") from None
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "could not verify dograh session") from None

    # Find the TenantMember that links this Dograh user to a tenant on our side.
    # If the user exists in Dograh but isn't on our rolls (e.g. signed up
    # directly through Dograh), we 404 — onboarding has to land them on a
    # tenant first via /api/auth/signup or /api/auth/accept-invite.
    member = (
        await session.execute(
            select(TenantMember)
            .where(TenantMember.dograh_user_id == dograh_user.id)
            .order_by(TenantMember.joined_at)
        )
    ).scalars().first()
    if member is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Dograh user has no SalesChimp tenant membership",
        )

    tenant = (
        await session.execute(select(Tenant).where(Tenant.id == member.tenant_id))
    ).scalar_one()
    if tenant.dograh_org_id is None:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "tenant has no dograh_org_id",
        )

    access_token, expires_in = issue_customer_token(
        dograh_user_id=dograh_user.id,
        email=dograh_user.email,
        org_id=tenant.dograh_org_id,
        role=member.role,
    )

    await record_audit(
        session,
        actor_kind="tenant",
        actor_user_id=dograh_user.id,
        action="console.session_exchange",
        target_kind="tenant",
        target_id=str(tenant.id),
        request=request,
        payload={"role": member.role},
    )
    await session.commit()

    log.info(
        "session_exchange.ok",
        dograh_user_id=dograh_user.id,
        tenant_id=tenant.id,
        role=member.role,
    )
    return ExchangeOut(
        access_token=access_token,
        expires_in=expires_in,
        role=member.role,
        org_id=tenant.dograh_org_id,
        tenant_slug=tenant.slug,
        email=dograh_user.email,
    )


def _pick_token(authorization: str | None, cookie: str | None) -> str | None:
    """Auth header wins; cookie is a fallback for same-origin SSR cases."""
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip() or None
    if cookie:
        return cookie.strip() or None
    return None
