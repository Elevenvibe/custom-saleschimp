from datetime import UTC, datetime, timedelta

import bcrypt
import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import PlatformUser
from app.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def issue_customer_token(
    *,
    dograh_user_id: int,
    email: str,
    org_id: int,
    role: str,
    plugins: list[str] | None = None,
    tier: str | None = None,
) -> tuple[str, int]:
    """Mint an augmented JWT for an org-side user.

    Dograh only reads sub/email/exp — `sub` must match a real Dograh user id
    so its routes recognize the session. The extra claims (tenant_kind,
    org_id, role, tier, plugins) are read by gateway middleware for
    entitlement checks; Dograh ignores them.
    """
    expiry = datetime.now(UTC) + timedelta(hours=settings.jwt_expiry_hours)
    payload = {
        "sub": str(dograh_user_id),
        "email": email,
        "exp": expiry,
        "iat": datetime.now(UTC),
        "tenant_kind": "customer",
        "org_id": org_id,
        "role": role,
        "tier": tier,
        "plugins": plugins or [],
        "scopes": [f"tenant:{role}"],
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, int(settings.jwt_expiry_hours * 3600)


def issue_super_admin_token(user: PlatformUser) -> tuple[str, int]:
    """Mint an augmented JWT for a platform user.

    Signed with the same secret/algorithm as Dograh so Dograh would accept it
    if ever proxied through; the gateway is the source of truth on the extra
    claims (tenant_kind, role, scopes).
    """
    expiry = datetime.now(UTC) + timedelta(hours=settings.jwt_expiry_hours)
    payload = {
        # Dograh-required claims
        "sub": f"p_{user.id}",
        "email": user.email,
        "exp": expiry,
        "iat": datetime.now(UTC),
        # Augmented claims (ignored by Dograh; enforced by gateway middleware)
        "tenant_kind": "platform",
        "role": user.role,
        "scopes": ["platform:admin"],
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, int(settings.jwt_expiry_hours * 3600)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


async def find_platform_user_by_email(
    session: AsyncSession, email: str
) -> PlatformUser | None:
    result = await session.execute(
        select(PlatformUser).where(PlatformUser.email == email.lower())
    )
    return result.scalar_one_or_none()
