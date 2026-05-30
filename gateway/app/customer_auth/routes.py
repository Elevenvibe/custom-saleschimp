"""Customer-facing auth endpoints.

POST /api/auth/signup  → create pending tenant + email verification link
GET  /api/auth/verify  → verify token, call Dograh signup, mint customer JWT
"""

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.recaptcha import verify_recaptcha
from app.auth.service import issue_customer_token
from app.auth.tokens import InvalidToken, TokenExpired, verify as verify_token
from app.config import settings
from app.customer_auth.schemas import SignupIn, SignupOut, VerifyOut
from app.customer_auth.service import (
    consume_pending_password,
    create_pending_tenant,
    send_verification_email,
    strip_pending_password,
)
from app.db import get_session
from app.dograh_client import DograhClient, DograhError
from app.tenants.models import Tenant, TenantMember

log = structlog.get_logger()

router = APIRouter(tags=["customer-auth"])


@router.post("/signup", response_model=SignupOut, status_code=status.HTTP_202_ACCEPTED)
async def signup(
    body: SignupIn,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SignupOut:
    await verify_recaptcha(
        session, body.recaptcha_token, remote_ip=request.client.host if request.client else None
    )
    # Lower-case the email everywhere for case-insensitive uniqueness.
    email = body.email.lower()

    try:
        tenant = await create_pending_tenant(
            session,
            email=email,
            password=body.password,
            full_name=body.full_name,
            company_name=body.company_name,
            extras=body.model_dump(
                include={
                    "company_size",
                    "role_title",
                    "phone",
                    "use_case",
                    "expected_call_volume",
                    "referral_source",
                }
            ),
        )
    except ValueError as e:
        # Don't leak whether the email is taken — always return 202 with the
        # same message. The audit log records the actual outcome.
        await record_audit(
            session,
            actor_kind="system",
            action="signup.duplicate_email",
            target_kind="email",
            target_id=email,
            request=request,
            payload={"reason": str(e)},
        )
        await session.commit()
        return SignupOut(
            tenant_id=0,
            status="pending_verification",
            message="If that email is new, a verification link is on its way.",
        )

    # Verification email is best-effort. A provider failure (e.g. an
    # unverified Postmark sender signature, a 422) must NOT 500 the signup —
    # the tenant row is created and the link can be re-sent (or a super-admin
    # can force-verify via complete-signup). We record whether it went out so
    # the audit log + response reflect reality.
    email_sent = True
    email_error: str | None = None
    try:
        await send_verification_email(
            session, tenant=tenant, full_name=body.full_name
        )
    except Exception as e:  # noqa: BLE001 — delivery is non-critical to signup
        email_sent = False
        email_error = str(e)
        log.warning(
            "signup.verification_email_failed",
            tenant_id=tenant.id,
            email=email,
            error=email_error,
        )
    await record_audit(
        session,
        actor_kind="system",
        action="signup.created",
        target_kind="tenant",
        target_id=str(tenant.id),
        request=request,
        payload={"email": email, "company": body.company_name, "email_sent": email_sent},
    )
    # Bell the platform team about the new signup (best-effort, routed).
    try:
        from app.notifications.service import dispatch_to_all_admins

        await dispatch_to_all_admins(
            session,
            type_key="tenant_signup",
            title="New tenant signup",
            body=f"{body.company_name} ({email})",
            link=f"/tenants/{tenant.id}",
        )
    except Exception:  # noqa: BLE001
        pass
    await session.commit()

    log.info("signup.created", tenant_id=tenant.id, email=email, email_sent=email_sent)
    return SignupOut(
        tenant_id=tenant.id,
        status=tenant.status,
        message=(
            "Check your inbox for a verification link."
            if email_sent
            else "Account created. The verification email couldn't be sent right "
            "now — please contact support to verify your account."
        ),
    )


@router.get("/verify", response_model=VerifyOut)
async def verify(
    token: Annotated[str, Query(min_length=1)],
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> VerifyOut:
    try:
        payload = verify_token(token)
    except TokenExpired:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "verification link expired") from None
    except InvalidToken:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid verification link") from None

    if payload.get("purpose") != "signup":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "wrong token purpose")

    tenant_id = payload.get("tenant_id")
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "tenant not found")
    if tenant.status == "active" and tenant.dograh_org_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "already verified — please sign in")
    if tenant.status not in {"pending_verification", "active"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"tenant status is {tenant.status}")

    try:
        password, full_name = consume_pending_password(tenant)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no pending verification on this tenant") from None

    # Call Dograh — it creates a user and an org owned by them.
    client = DograhClient()
    try:
        dograh_user = await client.signup(
            email=tenant.owner_email, password=password, name=full_name
        )
    except DograhError as e:
        log.warning(
            "verify.dograh_signup_failed",
            tenant_id=tenant_id,
            error=e.detail,
            status=e.status_code,
        )
        if e.status_code == 409:
            raise HTTPException(status.HTTP_409_CONFLICT, "email already registered in Dograh") from None
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "could not create user in Dograh") from None

    # Wire up our control-plane records.
    tenant.dograh_org_id = dograh_user.organization_id
    tenant.status = "active"
    strip_pending_password(tenant)

    member = TenantMember(
        tenant_id=tenant.id,
        dograh_user_id=dograh_user.id,
        email=dograh_user.email,
        role="org_owner",
    )
    session.add(member)

    token_str, expires_in = issue_customer_token(
        dograh_user_id=dograh_user.id,
        email=dograh_user.email,
        org_id=dograh_user.organization_id,
        role="org_owner",
    )

    await record_audit(
        session,
        actor_kind="tenant",
        actor_user_id=dograh_user.id,
        action="signup.verified",
        target_kind="tenant",
        target_id=str(tenant.id),
        request=request,
        payload={"dograh_org_id": dograh_user.organization_id},
    )
    await session.commit()

    # Apply seed defaults onto the freshly-active tenant (best-effort: a
    # seed failure must not block account access). See app/seed/service.py.
    try:
        from app.seed.service import seed_new_tenant

        await seed_new_tenant(session, tenant.id)
    except Exception as e:  # noqa: BLE001
        log.warning("seed.apply_on_verify_failed", tenant_id=tenant.id, error=str(e))

    log.info(
        "signup.verified",
        tenant_id=tenant.id,
        dograh_user_id=dograh_user.id,
        dograh_org_id=dograh_user.organization_id,
    )

    return VerifyOut(
        tenant_id=tenant.id,
        dograh_org_id=dograh_user.organization_id,
        dograh_user_id=dograh_user.id,
        access_token=token_str,
        expires_in=expires_in,
        role="org_owner",
        redirect=settings.post_verify_redirect,
    )
