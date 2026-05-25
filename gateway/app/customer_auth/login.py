"""Org-user login.

Validates credentials against Dograh's auth API, then augments the resulting
session with our tenant claims (org_id, role, tier, plugins) using the
caller's tenant_members row.

Multi-tenant membership (a single Dograh user belonging to several of our
tenants) is allowed by the schema but rare today. We pick the membership
matching Dograh's `selected_organization_id` if there's one; otherwise the
oldest membership wins. Future versions can prompt the user to choose.
"""

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.service import issue_customer_token
from app.config import settings
from app.db import get_session
from app.dograh_client import DograhClient, DograhError
from app.tenants.models import Tenant, TenantMember

log = structlog.get_logger()

router = APIRouter(tags=["customer-auth:login"])


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class LoginOut(BaseModel):
    access_token: str
    expires_in: int
    role: str
    org_id: int
    redirect: str


@router.post("/login", response_model=LoginOut)
async def login(
    body: LoginIn,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> LoginOut:
    client = DograhClient()
    try:
        dograh_user = await client.login(email=body.email, password=body.password)
    except DograhError as e:
        if e.status_code == 401:
            await record_audit(
                session,
                actor_kind="system",
                action="login.failed",
                target_kind="email",
                target_id=body.email.lower(),
                request=request,
            )
            await session.commit()
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials") from None
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "could not authenticate via Dograh") from None

    # Find the caller's tenant membership. Prefer the one Dograh thinks is
    # selected; fall back to the oldest.
    members = (
        await session.execute(
            select(TenantMember)
            .where(TenantMember.dograh_user_id == dograh_user.id)
            .order_by(TenantMember.joined_at)
        )
    ).scalars().all()
    if not members:
        # User exists in Dograh but isn't on our platform's tenant rolls.
        await record_audit(
            session,
            actor_kind="system",
            action="login.rejected.no_tenant_member",
            target_kind="dograh_user",
            target_id=str(dograh_user.id),
            request=request,
        )
        await session.commit()
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "this account is not a member of any SalesChimp tenant",
        )

    chosen = members[0]
    for m in members:
        org_id = await _tenant_dograh_org_id(session, m.tenant_id)
        if org_id == dograh_user.organization_id:
            chosen = m
            break

    org_id = await _tenant_dograh_org_id(session, chosen.tenant_id)
    if org_id is None:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "membership references a tenant with no dograh_org_id",
        )

    token, expires_in = issue_customer_token(
        dograh_user_id=dograh_user.id,
        email=dograh_user.email,
        org_id=org_id,
        role=chosen.role,
    )

    await record_audit(
        session,
        actor_kind="tenant",
        actor_user_id=dograh_user.id,
        action="login.succeeded",
        target_kind="tenant",
        target_id=str(chosen.tenant_id),
        request=request,
        payload={"role": chosen.role, "org_id": org_id},
    )
    await session.commit()

    log.info("login.succeeded", dograh_user_id=dograh_user.id, tenant_id=chosen.tenant_id)
    return LoginOut(
        access_token=token,
        expires_in=expires_in,
        role=chosen.role,
        org_id=org_id,
        redirect=settings.post_verify_redirect,
    )


async def _tenant_dograh_org_id(session: AsyncSession, tenant_id: int) -> int | None:
    row = await session.execute(
        select(Tenant.dograh_org_id).where(Tenant.id == tenant_id)
    )
    return row.scalar_one_or_none()
