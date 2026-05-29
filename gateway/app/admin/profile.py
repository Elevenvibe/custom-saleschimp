"""Super-admin profile settings.

  GET   /api/admin/profile                  current super-admin's profile
  PATCH /api/admin/profile                  update profile fields
  POST  /api/admin/profile/avatar           upload profile picture (MinIO)
  POST  /api/admin/profile/password         change password (verifies current)
  POST  /api/admin/profile/email/request    start email change → mails a code
  POST  /api/admin/profile/email/verify     confirm code → swaps email

Email change is verified: a 6-digit code is mailed to the NEW address (to
prove ownership) and must be entered before `email` moves. The frontend
redirects to the dashboard on success (callback).
"""

from __future__ import annotations

import random
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.auth.models import PlatformUser
from app.auth.service import hash_password, verify_password
from app.db import get_session
from app.storage.branding import StorageError, upload_avatar
from app.tenants.suspension import notify_best_effort

router = APIRouter(prefix="/profile", tags=["admin:profile"])

_CODE_TTL_MINUTES = 15


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uid(claims: dict) -> int:
    sub = claims.get("sub", "")
    if isinstance(sub, str) and sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            pass
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot resolve platform user")


async def _get_user(session: AsyncSession, claims: dict) -> PlatformUser:
    user = await session.get(PlatformUser, _uid(claims))
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    return user


class ProfileOut(BaseModel):
    id: int
    email: str
    role: str
    first_name: str | None
    last_name: str | None
    profile_picture_url: str | None
    country: str | None
    mobile: str | None
    language: str
    gender: str | None
    date_of_birth: str | None
    slack_member_id: str | None
    marital_status: str | None
    address: str | None
    city: str | None
    state: str | None
    zip_code: str | None
    about: str | None
    receive_email_notifications: bool
    google_calendar_enabled: bool
    pending_email: str | None


def _serialize(u: PlatformUser) -> ProfileOut:
    return ProfileOut(
        id=u.id,
        email=u.email,
        role=u.role,
        first_name=u.first_name,
        last_name=u.last_name,
        profile_picture_url=u.profile_picture_url,
        country=u.country,
        mobile=u.mobile,
        language=u.language or "en",
        gender=u.gender,
        date_of_birth=u.date_of_birth.isoformat() if u.date_of_birth else None,
        slack_member_id=u.slack_member_id,
        marital_status=u.marital_status,
        address=u.address,
        city=u.city,
        state=u.state,
        zip_code=u.zip_code,
        about=u.about,
        receive_email_notifications=u.receive_email_notifications,
        google_calendar_enabled=u.google_calendar_enabled,
        pending_email=u.pending_email,
    )


class ProfilePatchIn(BaseModel):
    # Email is changed via the verified flow, NOT here.
    first_name: str | None = None
    last_name: str | None = None
    country: str | None = None
    mobile: str | None = None
    language: str | None = None
    gender: Literal["male", "female"] | None = None
    date_of_birth: str | None = None  # ISO date
    slack_member_id: str | None = None
    marital_status: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    about: str | None = None
    receive_email_notifications: bool | None = None
    google_calendar_enabled: bool | None = None


@router.get("", response_model=ProfileOut)
async def get_profile(
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProfileOut:
    return _serialize(await _get_user(session, claims))


@router.patch("", response_model=ProfileOut)
async def update_profile(
    body: ProfilePatchIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProfileOut:
    user = await _get_user(session, claims)
    data = body.model_dump(exclude_unset=True)
    if "date_of_birth" in data:
        dob = data.pop("date_of_birth")
        if dob:
            try:
                user.date_of_birth = date.fromisoformat(dob)
            except ValueError:
                raise HTTPException(400, "date_of_birth must be YYYY-MM-DD") from None
        else:
            user.date_of_birth = None
    for k, v in data.items():
        setattr(user, k, v)
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=user.id,
        action="admin.profile.update",
        target_kind="platform_user",
        target_id=str(user.id),
        payload={"fields": list(data.keys())},
    )
    await session.commit()
    return _serialize(user)


@router.post("/avatar", response_model=ProfileOut)
async def upload_profile_avatar(
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    file: Annotated[UploadFile, File()],
) -> ProfileOut:
    user = await _get_user(session, claims)
    data = await file.read()
    try:
        url = await upload_avatar(
            scope="platform-users",
            scope_id=user.id,
            data=data,
            content_type=file.content_type or "application/octet-stream",
            filename=file.filename,
        )
    except StorageError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    user.profile_picture_url = url
    await session.commit()
    return _serialize(user)


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=12)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: PasswordChangeIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    user = await _get_user(session, claims)
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=user.id,
        action="admin.profile.password",
        target_kind="platform_user",
        target_id=str(user.id),
        payload={},
    )
    await session.commit()


class EmailChangeRequestIn(BaseModel):
    new_email: EmailStr


@router.post("/email/request")
async def request_email_change(
    body: EmailChangeRequestIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    user = await _get_user(session, claims)
    new_email = str(body.new_email).strip().lower()
    if new_email == user.email.lower():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "that's already your email")
    # Reject if another platform user owns it.
    taken = (
        await session.execute(select(PlatformUser).where(PlatformUser.email == new_email))
    ).scalar_one_or_none()
    if taken is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "email already in use")

    code = f"{random.randint(0, 999999):06d}"
    user.pending_email = new_email
    user.email_change_code = code
    user.email_change_expires_at = _now() + timedelta(minutes=_CODE_TTL_MINUTES)
    await session.commit()

    # Mail the code to the NEW address to prove ownership. Best-effort —
    # in dev with no email provider the code is also logged by notify.
    await notify_best_effort(
        session,
        to=[new_email],
        subject="Verify your new email",
        body=f"Your verification code is {code}. It expires in {_CODE_TTL_MINUTES} minutes.",
        tenant_id=None,
    )
    return {"sent_to": new_email, "expires_in_minutes": _CODE_TTL_MINUTES}


class EmailVerifyIn(BaseModel):
    code: str


@router.post("/email/verify", response_model=ProfileOut)
async def verify_email_change(
    body: EmailVerifyIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProfileOut:
    user = await _get_user(session, claims)
    if not user.pending_email or not user.email_change_code:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no email change in progress")
    if user.email_change_expires_at and user.email_change_expires_at < _now():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "code expired — request a new one")
    if body.code.strip() != user.email_change_code:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "incorrect code")

    old = user.email
    user.email = user.pending_email
    user.pending_email = None
    user.email_change_code = None
    user.email_change_expires_at = None
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=user.id,
        action="admin.profile.email_changed",
        target_kind="platform_user",
        target_id=str(user.id),
        payload={"from": old, "to": user.email},
    )
    await session.commit()
    return _serialize(user)
