"""Shared pytest fixtures for gateway tests.

These tests run against the app's configured database (the dev `control` DB
in local docker) using httpx's in-process ASGI transport — no network, no
live server. External HTTP boundaries (OAuth providers, Google APIs) are
monkeypatched per-test so the full route logic runs without real credentials.
Each test creates uniquely-keyed rows and cleans them up.
"""

from __future__ import annotations

import httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

# Import the app first (this builds app.db.engine), then swap the engine to a
# NullPool one. pytest-asyncio runs each test on its own event loop; a pooled
# asyncpg connection created on one loop and reused on the next raises
# "another operation is in progress". NullPool opens + closes a fresh
# connection per session, so per-test loops are safe. We do this at conftest
# import time — before the test modules import SessionLocal — so everything
# (including get_session) resolves the NullPool sessionmaker.
import app.db as _db  # noqa: E402
from app.main import app  # noqa: E402

_db.engine = create_async_engine(_db.settings.database_url, poolclass=NullPool, future=True)
_db.SessionLocal = async_sessionmaker(
    _db.engine, expire_on_commit=False, autoflush=False, class_=_db.AsyncSession
)


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
