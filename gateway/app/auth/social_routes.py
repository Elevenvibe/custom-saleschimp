"""Public social-login routes: button config + OAuth start + callback.

  GET /api/auth/social-config                 enabled providers (for buttons)
  GET /api/auth/social/{provider}/start        302 → provider authorize URL
  GET /api/auth/social/{provider}/callback     exchange code → resolve account → app

Account policy: resolve an EXISTING account by verified email and issue its
session; never create accounts (see app/auth/social.py).
"""

from __future__ import annotations

import secrets
from typing import Annotated
from urllib.parse import urlencode

import structlog
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import social
from app.auth.service import (
    find_platform_user_by_email,
    issue_customer_token,
    issue_super_admin_token,
)
from app.auth.tokens import InvalidToken, TokenExpired, issue as issue_state, verify as verify_state
from app.config import settings
from app.db import get_session
from app.tenants.models import Tenant, TenantMember

log = structlog.get_logger()

router = APIRouter(tags=["social-login"])

_STATE_TTL = 600  # 10 min to complete the round-trip


def _app_base(audience: str) -> str:
    return settings.admin_app_url if audience == "platform" else settings.customer_app_url


def _redirect_to_app(audience: str, fragment: dict[str, str]) -> RedirectResponse:
    # Token / error returned in the URL fragment so it never hits server logs
    # or the Referer header. The login page reads location.hash.
    base = _app_base(audience).rstrip("/")
    return RedirectResponse(url=f"{base}/login#{urlencode(fragment)}", status_code=302)


@router.get("/social-config")
async def social_config(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    return {"providers": await social.public_config(session)}


@router.get("/social/{provider}/start")
async def social_start(
    provider: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    audience: str = Query("customer"),
) -> RedirectResponse:
    audience = "platform" if audience == "platform" else "customer"
    if not social.is_known(provider):
        return _redirect_to_app(audience, {"social_error": "unknown provider"})
    cfg = await social.get_provider_config(session, provider)
    if not (cfg["enabled"] and cfg["client_id"] and cfg["secret"] and cfg["callback_url"]):
        return _redirect_to_app(audience, {"social_error": f"{provider} is not configured"})

    code_verifier = code_challenge = None
    if social.PROVIDERS[provider]["pkce"]:
        code_verifier, code_challenge = social.make_pkce()

    state = issue_state(
        {
            "p": provider,
            "aud": audience,
            "n": secrets.token_urlsafe(8),
            "cv": code_verifier,
        },
        ttl_seconds=_STATE_TTL,
    )
    url = social.build_authorize_url(provider, cfg, state=state, code_challenge=code_challenge)
    return RedirectResponse(url=url, status_code=302)


@router.get("/social/{provider}/callback")
async def social_callback(
    provider: str,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
) -> RedirectResponse:
    # Decode state first so we always know where to send the user back.
    audience = "customer"
    code_verifier = None
    if state:
        try:
            payload = verify_state(state)
            audience = "platform" if payload.get("aud") == "platform" else "customer"
            code_verifier = payload.get("cv")
            if payload.get("p") != provider:
                return _redirect_to_app(audience, {"social_error": "state mismatch"})
        except (InvalidToken, TokenExpired):
            return _redirect_to_app(audience, {"social_error": "invalid or expired login state"})
    else:
        return _redirect_to_app(audience, {"social_error": "missing state"})

    if error:
        return _redirect_to_app(audience, {"social_error": error})
    if not code:
        return _redirect_to_app(audience, {"social_error": "missing authorization code"})

    cfg = await social.get_provider_config(session, provider)
    if not (cfg["enabled"] and cfg["secret"]):
        return _redirect_to_app(audience, {"social_error": f"{provider} is not configured"})

    access_token = await social.exchange_code(provider, cfg, code=code, code_verifier=code_verifier)
    if not access_token:
        return _redirect_to_app(audience, {"social_error": "could not complete sign-in with the provider"})

    email, _name = await social.fetch_email(provider, access_token)
    if not email:
        return _redirect_to_app(
            audience,
            {"social_error": f"{social.PROVIDERS[provider]['name']} did not return a verified email"},
        )

    # Resolve an EXISTING account by email — never create one.
    if audience == "platform":
        user = await find_platform_user_by_email(session, email)
        if user is None:
            return _redirect_to_app(audience, {"social_error": "no admin account for this email"})
        token, _ = issue_super_admin_token(user)
        log.info("social.login.platform", provider=provider, user_id=user.id)
        return _redirect_to_app(audience, {"access_token": token, "role": user.role})

    # customer audience
    member = (
        await session.execute(
            select(TenantMember)
            .where(func.lower(TenantMember.email) == email)
            .order_by(TenantMember.joined_at)
        )
    ).scalars().first()
    if member is None or member.dograh_user_id is None:
        return _redirect_to_app(audience, {"social_error": "no workspace account for this email"})
    tenant = await session.get(Tenant, member.tenant_id)
    if tenant is None or tenant.dograh_org_id is None:
        return _redirect_to_app(audience, {"social_error": "account is not fully provisioned"})

    token, _ = issue_customer_token(
        dograh_user_id=member.dograh_user_id,
        email=email,
        org_id=tenant.dograh_org_id,
        role=member.role,
    )
    log.info("social.login.customer", provider=provider, tenant_id=tenant.id)
    return _redirect_to_app(audience, {"access_token": token, "role": member.role})
