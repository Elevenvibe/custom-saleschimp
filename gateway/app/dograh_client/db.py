"""Direct DB writes against Dograh's database.

Used only when Dograh's HTTP API doesn't expose what we need — currently:
- Adding a verified-and-accepted invitee to an EXISTING Dograh org. Dograh's
  /auth/signup always creates a fresh personal org for the user; for invites
  we then move them into the inviter's org by writing the membership row
  directly.

Everything else goes through DograhClient (HTTP) or the reverse proxy. We
keep this module narrow on purpose — every write here couples to Dograh's
schema, so the surface should be as small as possible.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings

_dograh_engine = create_async_engine(
    settings.dograh_database_url, pool_recycle=1800, future=True
)
DograhSession = async_sessionmaker(
    _dograh_engine, expire_on_commit=False, autoflush=False, class_=AsyncSession
)


async def add_user_to_organization(user_id: int, organization_id: int) -> None:
    """Idempotent: INSERT ... ON CONFLICT DO NOTHING into the join table."""
    async with DograhSession() as session:
        await session.execute(
            text(
                """
                INSERT INTO organization_users (user_id, organization_id)
                VALUES (:user_id, :organization_id)
                ON CONFLICT DO NOTHING
                """
            ),
            {"user_id": user_id, "organization_id": organization_id},
        )
        await session.commit()


async def set_selected_organization(user_id: int, organization_id: int) -> None:
    """Set users.selected_organization_id — this is what Dograh uses to scope
    requests once the user has multiple memberships."""
    async with DograhSession() as session:
        await session.execute(
            text(
                """
                UPDATE users
                SET selected_organization_id = :organization_id
                WHERE id = :user_id
                """
            ),
            {"user_id": user_id, "organization_id": organization_id},
        )
        await session.commit()


async def move_user_to_org(user_id: int, organization_id: int) -> None:
    """Convenience: add membership + flip selected_organization_id."""
    await add_user_to_organization(user_id, organization_id)
    await set_selected_organization(user_id, organization_id)
