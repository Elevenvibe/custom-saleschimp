"""Signup + verification logic.

Flow:
    POST /api/auth/signup  → stash a pending tenant + send verification email
    GET  /api/auth/verify  → call Dograh's signup, link the org, issue JWT

The password is held briefly between those two steps. It's Fernet-encrypted
into `tenants.signup_metadata.pwd_enc` so it never sits at rest in cleartext,
and it's deleted on verify success.
"""

from __future__ import annotations

import re
import secrets
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.tokens import issue as issue_token
from app.config import settings
from app.email.crypto import decrypt_dict, encrypt_dict
from app.email.service import send_template
from app.tenants.models import Tenant


VERIFICATION_TTL_SECONDS = 24 * 3600


async def slug_for_company(session: AsyncSession, company_name: str) -> str:
    """Slugify the company name and disambiguate against existing tenants."""
    base = re.sub(r"[^a-z0-9-]+", "-", company_name.lower()).strip("-")
    if not base:
        base = "tenant"
    slug = base
    while True:
        existing = await session.execute(select(Tenant.id).where(Tenant.slug == slug))
        if existing.first() is None:
            return slug
        slug = f"{base}-{secrets.token_hex(2)}"


async def create_pending_tenant(
    session: AsyncSession,
    *,
    email: str,
    password: str,
    full_name: str,
    company_name: str,
    extras: dict[str, Any],
) -> Tenant:
    """Insert a pending_verification tenant with the password encrypted into
    signup_metadata. Caller commits."""
    existing = await session.execute(
        select(Tenant).where(Tenant.owner_email == email.lower())
    )
    if existing.scalar_one_or_none() is not None:
        # Idempotent in the sense that we won't create a duplicate, but we
        # also won't leak that the email is registered. Caller can choose to
        # 200 either way.
        raise ValueError("email already has a tenant")

    slug = await slug_for_company(session, company_name)
    enc = encrypt_dict({"password": password, "full_name": full_name})
    metadata = {
        "pwd_enc": enc,
        "company_size": extras.get("company_size"),
        "role_title": extras.get("role_title"),
        "phone": extras.get("phone"),
        "use_case": extras.get("use_case"),
        "expected_call_volume": extras.get("expected_call_volume"),
        "referral_source": extras.get("referral_source"),
    }
    tenant = Tenant(
        name=company_name,
        slug=slug,
        owner_email=email.lower(),
        status="pending_verification",
        signup_metadata=metadata,
    )
    session.add(tenant)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise ValueError("slug collision (race)") from None
    return tenant


def build_verify_url(token: str) -> str:
    """Verification link the user clicks. Points at the customer Next.js app
    which calls /api/auth/verify on the gateway and renders the result."""
    base = settings.customer_app_url.rstrip("/")
    return f"{base}/verify?token={token}"


async def send_verification_email(
    session: AsyncSession, *, tenant: Tenant, full_name: str
) -> None:
    token = issue_token(
        {"tenant_id": tenant.id, "purpose": "signup"},
        ttl_seconds=VERIFICATION_TTL_SECONDS,
    )
    verify_url = build_verify_url(token)
    await send_template(
        session,
        to=[tenant.owner_email],
        subject="Verify your SalesChimp account",
        template="verification",
        context={
            "name": full_name,
            "verify_url": verify_url,
            "ttl_hours": VERIFICATION_TTL_SECONDS // 3600,
            "product_name": "SalesChimp",
        },
    )


def consume_pending_password(tenant: Tenant) -> tuple[str, str]:
    """Decrypt the stashed password + full_name and return them. The caller
    is expected to null out `pwd_enc` from signup_metadata and commit AFTER
    Dograh accepts the signup."""
    meta = tenant.signup_metadata or {}
    pwd_enc = meta.get("pwd_enc")
    if not pwd_enc:
        raise ValueError("no pending password on this tenant")
    plain = decrypt_dict(pwd_enc)
    return plain["password"], plain["full_name"]


def strip_pending_password(tenant: Tenant) -> None:
    meta = dict(tenant.signup_metadata or {})
    meta.pop("pwd_enc", None)
    tenant.signup_metadata = meta
