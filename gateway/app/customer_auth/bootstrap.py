"""First-boot creation of a demo customer tenant from env vars.

When all four GATEWAY_BOOTSTRAP_DEMO_TENANT_* vars are set AND no tenant with
that owner_email already exists, this:
    1. Calls Dograh's /auth/signup → creates the Dograh user + auto org
    2. Writes a `tenants` row mirroring the Dograh org + a `tenant_members`
       row marking the user as org_owner
    3. Logs the credentials loudly

Intended for local dev only. Idempotent on the "tenant already exists" check.
"""

from __future__ import annotations

import structlog
from sqlalchemy import select

from app.config import settings
from app.customer_auth.service import slug_for_company
from app.db import SessionLocal
from app.dograh_client import DograhClient, DograhError
from app.tenants.models import Tenant, TenantMember

log = structlog.get_logger()


async def bootstrap_demo_tenant_if_needed() -> None:
    cfg = (
        settings.bootstrap_demo_tenant_email,
        settings.bootstrap_demo_tenant_password,
        settings.bootstrap_demo_tenant_full_name,
        settings.bootstrap_demo_tenant_company_name,
    )
    if not all(cfg):
        return

    email = settings.bootstrap_demo_tenant_email.lower()
    password = settings.bootstrap_demo_tenant_password
    full_name = settings.bootstrap_demo_tenant_full_name
    company = settings.bootstrap_demo_tenant_company_name

    async with SessionLocal() as session:
        existing = await session.execute(
            select(Tenant.id).where(Tenant.owner_email == email)
        )
        if existing.first() is not None:
            log.info("bootstrap.demo_tenant.skip", reason="tenant already exists", email=email)
            return

        # 1. Sign up in Dograh — creates user + auto-org and returns the IDs.
        client = DograhClient()
        try:
            dograh_user = await client.signup(
                email=email, password=password, name=full_name
            )
        except DograhError as e:
            # If Dograh already has a user for this email, fall through gracefully —
            # we'll just skip the bootstrap so a fresh restart doesn't crash.
            log.warning(
                "bootstrap.demo_tenant.dograh_signup_failed",
                email=email,
                status=e.status_code,
                detail=e.detail,
            )
            return

        # 2. Mirror into Control DB.
        slug = await slug_for_company(session, company)
        tenant = Tenant(
            name=company,
            slug=slug,
            owner_email=email,
            status="active",
            dograh_org_id=dograh_user.organization_id,
            signup_metadata={"bootstrap": True, "onboarding_completed": False},
        )
        session.add(tenant)
        await session.flush()

        member = TenantMember(
            tenant_id=tenant.id,
            dograh_user_id=dograh_user.id,
            email=email,
            role="org_owner",
        )
        session.add(member)
        await session.commit()

        log.warning(
            "bootstrap.demo_tenant.created",
            email=email,
            tenant_id=tenant.id,
            dograh_user_id=dograh_user.id,
            dograh_org_id=dograh_user.organization_id,
            note="rotate this password from the customer app's settings",
        )
