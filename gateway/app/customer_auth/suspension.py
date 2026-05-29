"""Tenant-side suspension: info endpoint + enforcement middleware.

Enforcement lives in middleware (the spec's "suspension checks in
authentication middleware") so it applies uniformly to every
/api/tenant/* route without per-route edits. A small allowlist keeps the
support channel open while suspended:

  /api/tenant/suspension-info   so the /suspended page can render context
  /api/tenant/me                so the shell can resolve identity + status
  /api/tenant/tickets…          so the tenant can read + reply to the
                                suspension ticket (and any other)

Everything else 403s with {"detail": {"code": "tenant_suspended"}} — the
console AuthGate watches for that and redirects to /suspended. Because the
check reads tenant.status live from the DB on every request, suspension is
enforced on the tenant's very next call regardless of token validity (JWTs
are stateless and can't be individually revoked).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import decode_token
from app.customer_auth.deps import require_customer
from app.db import SessionLocal, get_session
from app.tenants.models import Tenant, TenantMember

router = APIRouter(tags=["customer-auth:suspension"])

# Path prefixes that remain reachable while a tenant is suspended.
_ALLOW_WHILE_SUSPENDED = (
    "/api/tenant/suspension-info",
    "/api/tenant/me",
    "/api/tenant/tickets",
)


class SuspensionInfoOut(BaseModel):
    status: str
    suspended: bool
    mode: str  # delayed | kill_live
    subject: str | None
    reason: str | None
    suspended_at: str | None
    ticket_id: int | None
    org_name: str
    logo_url: str | None


@router.get("/suspension-info", response_model=SuspensionInfoOut)
async def suspension_info(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SuspensionInfoOut:
    """Context for the /suspended page. Reachable while suspended."""
    sub = claims.get("sub", "")
    try:
        dograh_user_id = int(sub)
    except (ValueError, TypeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad sub claim") from None
    member = (
        await session.execute(
            select(TenantMember).where(TenantMember.dograh_user_id == dograh_user_id)
        )
    ).scalar_one_or_none()
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not a tenant member")
    tenant = await session.get(Tenant, member.tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tenant missing")
    return SuspensionInfoOut(
        status=tenant.status,
        suspended=tenant.status == "suspended",
        mode=tenant.suspension_mode or "delayed",
        subject=tenant.suspension_subject,
        reason=tenant.suspension_reason,
        suspended_at=tenant.suspended_at.isoformat() if tenant.suspended_at else None,
        ticket_id=tenant.suspension_ticket_id,
        org_name=tenant.name,
        logo_url=tenant.logo_url,
    )


def _allowed_while_suspended(path: str) -> bool:
    return any(path.startswith(p) for p in _ALLOW_WHILE_SUSPENDED)


async def _is_tenant_suspended(sub: str | int | None) -> bool:
    try:
        dograh_user_id = int(sub)  # type: ignore[arg-type]
    except (ValueError, TypeError):
        return False
    async with SessionLocal() as session:
        row = (
            await session.execute(
                select(Tenant.status)
                .select_from(TenantMember)
                .join(Tenant, Tenant.id == TenantMember.tenant_id)
                .where(TenantMember.dograh_user_id == dograh_user_id)
            )
        ).scalar_one_or_none()
    return row == "suspended"


async def suspension_middleware(request, call_next):
    """HTTP middleware: block suspended tenants from non-allowlisted
    /api/tenant/* routes. Registered in main.py."""
    path = request.url.path
    if path.startswith("/api/tenant/") and not _allowed_while_suspended(path):
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            try:
                claims = decode_token(auth[7:])
            except Exception:  # noqa: BLE001 — let the route's dep return 401
                claims = None
            if claims and claims.get("tenant_kind") == "customer":
                if await _is_tenant_suspended(claims.get("sub")):
                    return JSONResponse(
                        status_code=status.HTTP_403_FORBIDDEN,
                        content={
                            "detail": {
                                "code": "tenant_suspended",
                                "message": "Your organization is suspended.",
                            }
                        },
                    )
    return await call_next(request)
