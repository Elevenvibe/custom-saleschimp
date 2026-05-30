"""End-to-end test of the internal Google token broker used by Dograh agent
tools, with the Google refresh endpoint mocked.

Proves: org_id → tenant → linked account → refresh-on-expiry → token; the
shared-secret guard; and that enabled services (Calendar/Docs/Contacts) are
reported so the agent tool knows which APIs it may call.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select

from app.config import settings
from app.customer_auth import integrations as integ
from app.db import SessionLocal
from app.email.crypto import encrypt_dict
from app.integrations import internal_routes as ir
from app.integrations.models import Contact, GoogleLink
from app.tenants.models import Tenant

TENANT_ID = 16


async def _org_id() -> int:
    async with SessionLocal() as s:
        t = await s.get(Tenant, TENANT_ID)
        return t.dograh_org_id


async def _seed_expired_link():
    async with SessionLocal() as s:
        existing = (
            await s.execute(select(GoogleLink).where(GoogleLink.tenant_id == TENANT_ID))
        ).scalar_one_or_none()
        if existing:
            await s.delete(existing)
            await s.flush()
        s.add(
            GoogleLink(
                tenant_id=TENANT_ID,
                google_email="chidi@gmail.com",
                access_token_enc=encrypt_dict({"secret": "stale"}),
                refresh_token_enc=encrypt_dict({"secret": "refresh-me"}),
                token_expiry=datetime.now(timezone.utc) - timedelta(minutes=5),  # expired
                scopes="contacts calendar documents",
            )
        )
        await s.commit()


async def _cleanup():
    async with SessionLocal() as s:
        await s.execute(delete(Contact).where(Contact.tenant_id == TENANT_ID))
        await s.execute(delete(GoogleLink).where(GoogleLink.tenant_id == TENANT_ID))
        await s.commit()


async def test_internal_token_broker(client, monkeypatch):
    await _cleanup()
    await _seed_expired_link()
    org_id = await _org_id()
    try:
        async def fake_google_config(session):
            return {
                "enabled": True,
                "client_id": "gc",
                "callback_url": "http://localhost:8080/cb",
                "secret": "s",
                "scopes": [
                    "https://www.googleapis.com/auth/contacts.readonly",
                    "https://www.googleapis.com/auth/calendar",
                    "https://www.googleapis.com/auth/documents",
                ],
            }

        async def fake_refresh(cfg, *, refresh_token):
            return {"access_token": "refreshed-token", "expires_in": 3600}

        # google_config is imported into BOTH modules; patch where used.
        monkeypatch.setattr(ir, "google_config", fake_google_config)
        monkeypatch.setattr(integ.gc, "refresh_access_token", fake_refresh)

        # No header → 401.
        r = await client.get("/internal/integrations/google/token", params={"org_id": org_id})
        assert r.status_code == 401

        # Valid header → refreshed token + enabled services.
        r = await client.get(
            "/internal/integrations/google/token",
            params={"org_id": org_id},
            headers={"X-Internal-Token": settings.internal_api_token},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["access_token"] == "refreshed-token"
        assert "calendar" in body["services"] and "documents" in body["services"]

        # Unknown org → 404.
        r = await client.get(
            "/internal/integrations/google/token",
            params={"org_id": 999999},
            headers={"X-Internal-Token": settings.internal_api_token},
        )
        assert r.status_code == 404
    finally:
        await _cleanup()
