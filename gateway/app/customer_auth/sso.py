"""Public SSO surface — what the customer login page calls.

Two endpoints today:

  GET /api/auth/sso/{slug}/info
      Returns non-secret config metadata so the login page can render
      the right "Sign in with X" button. 404 when the tenant slug
      has no active SSO config.

  GET /api/auth/sso/{slug}/start?return_to=...
      Placeholder for P2.B.2 — returns 501. Concrete OIDC redirect
      goes here once we've decided on the Dograh user provisioning
      story (see sso/service.py docstring).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.sso import service as sso_service

router = APIRouter(prefix="/sso", tags=["customer-auth:sso"])


class SsoInfoOut(BaseModel):
    tenant_slug: str
    tenant_name: str
    idp_kind: str
    display_name: str
    force_sso: bool


@router.get("/{slug}/info", response_model=SsoInfoOut)
async def get_info(
    slug: str,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SsoInfoOut:
    pair = await sso_service.get_config_by_slug(session, slug)
    if pair is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no SSO config")
    tenant, cfg = pair
    return SsoInfoOut(
        tenant_slug=tenant.slug,
        tenant_name=tenant.name,
        idp_kind=cfg.idp_kind,
        display_name=cfg.display_name,
        force_sso=cfg.force_sso,
    )


@router.get("/{slug}/start")
async def start_sso(slug: str) -> dict:
    # P2.B.2 will populate this with the OIDC redirect + state row.
    # Returning 501 makes the contract explicit — the login page can
    # show a friendly "SSO sign-in coming soon" pill instead of a
    # broken redirect.
    raise HTTPException(
        status.HTTP_501_NOT_IMPLEMENTED,
        "SSO sign-in redirect lands in P2.B.2",
    )
