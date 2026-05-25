from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.auth.models import PlatformUser
from app.auth.service import hash_password
from app.db import get_session

router = APIRouter(prefix="/platform-users", tags=["admin:platform-users"])


class PlatformUserOut(BaseModel):
    id: int
    email: str
    role: str
    created_at: str
    last_login_at: str | None


class PlatformUserCreateIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12)
    role: str = "super_admin_staff"  # default to staff; only super_admin can elevate


def _serialize(u: PlatformUser) -> PlatformUserOut:
    return PlatformUserOut(
        id=u.id,
        email=u.email,
        role=u.role,
        created_at=u.created_at.isoformat(),
        last_login_at=u.last_login_at.isoformat() if u.last_login_at else None,
    )


@router.get("")
async def list_platform_users(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[PlatformUserOut]:
    rows = (
        await session.execute(select(PlatformUser).order_by(PlatformUser.id))
    ).scalars().all()
    return [_serialize(u) for u in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_platform_user(
    body: PlatformUserCreateIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PlatformUserOut:
    if claims["role"] != "super_admin" and body.role == "super_admin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "only super_admin can create super_admin"
        )
    if body.role not in {"super_admin", "super_admin_staff"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid role")

    user = PlatformUser(
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        role=body.role,
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "email already exists") from None

    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=int(claims["sub"][2:]) if claims["sub"].startswith("p_") else None,
        action="admin.platform_user.create",
        target_kind="platform_user",
        target_id=str(user.id),
        payload={"email": user.email, "role": user.role},
    )
    await session.commit()
    return _serialize(user)
