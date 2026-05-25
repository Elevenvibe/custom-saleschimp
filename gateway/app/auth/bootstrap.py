"""First-boot creation of a super-admin user from env vars.

Runs once on startup. If `GATEWAY_BOOTSTRAP_SUPER_ADMIN_EMAIL` and
`GATEWAY_BOOTSTRAP_SUPER_ADMIN_PASSWORD` are set AND no platform users exist,
inserts the first super-admin. Idempotent on the "no users exist" check.
"""

import structlog
from sqlalchemy import select

from app.auth.models import PlatformUser
from app.auth.service import hash_password
from app.config import settings
from app.db import SessionLocal

log = structlog.get_logger()


async def bootstrap_super_admin_if_needed() -> None:
    if not (settings.bootstrap_super_admin_email and settings.bootstrap_super_admin_password):
        return

    async with SessionLocal() as session:
        existing = await session.execute(select(PlatformUser.id).limit(1))
        if existing.first() is not None:
            log.info(
                "bootstrap.super_admin.skip",
                reason="platform_users already exist",
            )
            return

        email = settings.bootstrap_super_admin_email.lower()
        user = PlatformUser(
            email=email,
            password_hash=hash_password(settings.bootstrap_super_admin_password),
            role="super_admin",
        )
        session.add(user)
        await session.commit()
        log.warning(
            "bootstrap.super_admin.created",
            email=email,
            note="rotate this password via the admin UI as soon as possible",
        )
