from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


class Base(DeclarativeBase):
    pass


# pool_pre_ping=True interacts badly with the asyncpg driver in some configs —
# ping runs through a sync codepath that needs a greenlet context the pool
# doesn't always have. pool_recycle handles dead connections deterministically.
engine = create_async_engine(settings.database_url, pool_recycle=1800, future=True)
SessionLocal = async_sessionmaker(
    engine,
    expire_on_commit=False,
    autoflush=False,  # Avoids implicit IO during attribute access inside routes.
    class_=AsyncSession,
)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
