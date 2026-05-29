"""Super-admin per-feature permissions.

  GET  /api/admin/permissions/me           effective flags for the caller
  GET  /api/admin/permissions              all platform users + flags (managers only)
  PUT  /api/admin/permissions/{user_id}    set a user's flags (managers only)

"Owner" = the bootstrapped super-admin (email == bootstrap_super_admin_email).
The owner implicitly has every feature and can always manage permissions,
so permission management can never lock itself out. Everyone else is
governed by rows in super_admin_permissions.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.auth.models import PlatformUser, SuperAdminPermission
from app.config import settings
from app.db import get_session

router = APIRouter(prefix="/permissions", tags=["admin:permissions"])

# Validated here (not in the DB) so adding a feature needs no migration.
FEATURES: tuple[str, ...] = ("manage_permissions", "update_checker", "support_widget")


class FeatureFlags(BaseModel):
    manage_permissions: bool = False
    update_checker: bool = False
    support_widget: bool = False


class MeOut(BaseModel):
    user_id: int | None
    email: str | None
    is_owner: bool
    features: FeatureFlags


class UserPermissionsOut(BaseModel):
    user_id: int
    email: str
    role: str
    is_owner: bool
    features: FeatureFlags


class SetPermissionsIn(BaseModel):
    features: FeatureFlags


def _user_id_from_claims(claims: dict) -> int | None:
    # Platform tokens carry sub="p_<id>".
    sub = claims.get("sub", "")
    if isinstance(sub, str) and sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            return None
    return None


def _is_owner_email(email: str | None) -> bool:
    owner = (settings.bootstrap_super_admin_email or "").strip().lower()
    return bool(owner) and (email or "").strip().lower() == owner


async def _flags_for(session: AsyncSession, user_id: int, is_owner: bool) -> FeatureFlags:
    if is_owner:
        # Owner implicitly has everything.
        return FeatureFlags(manage_permissions=True, update_checker=True, support_widget=True)
    rows = (
        await session.execute(
            select(SuperAdminPermission).where(
                SuperAdminPermission.platform_user_id == user_id,
                SuperAdminPermission.enabled.is_(True),
            )
        )
    ).scalars().all()
    granted = {r.feature for r in rows}
    return FeatureFlags(
        manage_permissions="manage_permissions" in granted,
        update_checker="update_checker" in granted,
        support_widget="support_widget" in granted,
    )


async def _require_manager(session: AsyncSession, claims: dict) -> None:
    """Caller must be the owner OR hold manage_permissions."""
    if _is_owner_email(claims.get("email")):
        return
    uid = _user_id_from_claims(claims)
    if uid is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "cannot resolve caller")
    flags = await _flags_for(session, uid, is_owner=False)
    if not flags.manage_permissions:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "you don't have permission to manage permissions"
        )


@router.get("/me", response_model=MeOut)
async def my_permissions(
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MeOut:
    email = claims.get("email")
    uid = _user_id_from_claims(claims)
    is_owner = _is_owner_email(email)
    flags = await _flags_for(session, uid or -1, is_owner)
    return MeOut(user_id=uid, email=email, is_owner=is_owner, features=flags)


@router.get("", response_model=list[UserPermissionsOut])
async def list_permissions(
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[UserPermissionsOut]:
    await _require_manager(session, claims)
    users = (
        await session.execute(select(PlatformUser).order_by(PlatformUser.id))
    ).scalars().all()
    out: list[UserPermissionsOut] = []
    for u in users:
        is_owner = _is_owner_email(u.email)
        flags = await _flags_for(session, u.id, is_owner)
        out.append(
            UserPermissionsOut(
                user_id=u.id, email=u.email, role=u.role, is_owner=is_owner, features=flags
            )
        )
    return out


@router.put("/{user_id}", response_model=UserPermissionsOut)
async def set_permissions(
    user_id: int,
    body: SetPermissionsIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserPermissionsOut:
    await _require_manager(session, claims)

    user = (
        await session.execute(select(PlatformUser).where(PlatformUser.id == user_id))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "platform user not found")
    if _is_owner_email(user.email):
        # The owner is all-true by definition; editing their rows is a no-op
        # that would only confuse. Reject so the UI disables the owner row.
        raise HTTPException(
            status.HTTP_409_CONFLICT, "the owner always has every permission"
        )

    desired = body.features.model_dump()  # {feature: bool}
    existing = {
        r.feature: r
        for r in (
            await session.execute(
                select(SuperAdminPermission).where(
                    SuperAdminPermission.platform_user_id == user_id
                )
            )
        ).scalars().all()
    }
    for feature in FEATURES:
        want = bool(desired.get(feature, False))
        row = existing.get(feature)
        if row is None:
            if want:
                session.add(
                    SuperAdminPermission(
                        platform_user_id=user_id, feature=feature, enabled=True
                    )
                )
        else:
            row.enabled = want

    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_user_id_from_claims(claims),
        action="admin.permissions.set",
        target_kind="platform_user",
        target_id=str(user_id),
        payload=desired,
    )
    await session.commit()

    flags = await _flags_for(session, user_id, is_owner=False)
    return UserPermissionsOut(
        user_id=user.id, email=user.email, role=user.role, is_owner=False, features=flags
    )
