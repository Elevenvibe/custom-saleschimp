"""End-to-end test of the Google Contacts import with the People API mocked.

Proves the full route logic: customer auth → linked-token retrieval →
(mocked) People API pull → idempotent upsert into contacts with a label →
listing. No real Google app needed. Uses tenant 16 (dev data) and cleans up.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select

from app.auth.service import issue_customer_token
from app.customer_auth import integrations as integ
from app.db import SessionLocal
from app.email.crypto import encrypt_dict
from app.integrations import google_client as gc
from app.integrations.models import Contact, GoogleLink
from app.tenants.models import Tenant, TenantMember

TENANT_ID = 16
DOGRAH_USER_ID = 15  # tenant 16 org_owner


async def _customer_token() -> str:
    async with SessionLocal() as s:
        tenant = await s.get(Tenant, TENANT_ID)
        org_id = tenant.dograh_org_id or 0
    token, _ = issue_customer_token(
        dograh_user_id=DOGRAH_USER_ID,
        email="chidi@mmadu.com",
        org_id=org_id,
        role="org_owner",
    )
    return token


async def _seed_link():
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
                access_token_enc=encrypt_dict({"secret": "fresh-token"}),
                token_expiry=datetime.now(timezone.utc) + timedelta(hours=1),
                scopes="https://www.googleapis.com/auth/contacts.readonly",
            )
        )
        await s.commit()


async def _cleanup():
    async with SessionLocal() as s:
        await s.execute(delete(Contact).where(Contact.tenant_id == TENANT_ID, Contact.source == "google"))
        await s.execute(delete(GoogleLink).where(GoogleLink.tenant_id == TENANT_ID))
        await s.commit()


async def test_google_contacts_import_e2e(client, monkeypatch):
    await _cleanup()
    await _seed_link()
    try:
        async def fake_google_config(session):
            return {
                "enabled": True,
                "client_id": "gc",
                "callback_url": "http://localhost:8080/cb",
                "secret": "s",
                "scopes": ["https://www.googleapis.com/auth/contacts.readonly"],
            }

        calls = {"n": 0}

        async def fake_list_connections(access_token, *, max_pages=10):
            calls["n"] += 1
            return [
                {"resource_name": "people/c1", "display_name": "Ada Lovelace", "email": "ada@x.com", "phone": "+15550001"},
                {"resource_name": "people/c2", "display_name": "Alan Turing", "email": "alan@x.com", "phone": None},
            ]

        monkeypatch.setattr(integ, "google_config", fake_google_config)
        monkeypatch.setattr(gc, "list_connections", fake_list_connections)

        token = await _customer_token()
        headers = {"Authorization": f"Bearer {token}"}

        # First import → 2 new.
        r = await client.post(
            "/api/tenant/integrations/google/contacts/import",
            json={"label": "Leads"},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["imported"] == 2 and body["updated"] == 0 and body["total_fetched"] == 2

        # Second import → idempotent (0 new, 2 updated).
        r2 = await client.post(
            "/api/tenant/integrations/google/contacts/import",
            json={"label": "Leads"},
            headers=headers,
        )
        assert r2.json()["imported"] == 0 and r2.json()["updated"] == 2

        # List reflects the import + label.
        lr = await client.get("/api/tenant/integrations/contacts?label=Leads", headers=headers)
        assert lr.status_code == 200
        names = sorted(c["display_name"] for c in lr.json())
        assert names == ["Ada Lovelace", "Alan Turing"]

        # Status shows linked + count + label.
        sr = await client.get("/api/tenant/integrations/google", headers=headers)
        sj = sr.json()
        assert sj["linked"] is True and sj["contact_count"] == 2 and "Leads" in sj["labels"]
    finally:
        await _cleanup()
