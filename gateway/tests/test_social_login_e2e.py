"""End-to-end test of the social-login callback with the OAuth provider's
HTTP boundary mocked.

Proves the full route logic: state verification → code exchange → email
fetch → existing-account resolution (platform + customer) → session token in
the redirect fragment. No real OAuth app needed.
"""

from __future__ import annotations

import pytest

from app.auth import social
from app.auth.tokens import issue as issue_state

# Existing dev-data accounts the resolver should match by email.
PLATFORM_EMAIL = "admin@mysaleschimp.com"
CUSTOMER_EMAIL = "chidi@mmadu.com"  # tenant 16 org_owner


def _patch_provider(monkeypatch, *, email: str):
    async def fake_get_provider_config(session, provider):
        return {
            "enabled": True,
            "client_id": "test-client",
            "secret": "test-secret",
            "callback_url": "http://localhost:8080/api/auth/social/google/callback",
        }

    async def fake_exchange_code(provider, cfg, *, code, code_verifier):
        return "fake-access-token"

    async def fake_fetch_email(provider, access_token):
        return email, "Test User"

    monkeypatch.setattr(social, "get_provider_config", fake_get_provider_config)
    monkeypatch.setattr(social, "exchange_code", fake_exchange_code)
    monkeypatch.setattr(social, "fetch_email", fake_fetch_email)


@pytest.mark.parametrize(
    "audience,email",
    [("platform", PLATFORM_EMAIL), ("customer", CUSTOMER_EMAIL)],
)
async def test_social_callback_issues_session_for_existing_account(
    client, monkeypatch, audience, email
):
    _patch_provider(monkeypatch, email=email)
    state = issue_state({"p": "google", "aud": audience, "n": "x", "cv": None}, ttl_seconds=600)

    resp = await client.get(
        "/api/auth/social/google/callback",
        params={"code": "abc", "state": state},
        follow_redirects=False,
    )
    assert resp.status_code == 302
    loc = resp.headers["location"]
    assert "access_token=" in loc, loc
    assert "social_error" not in loc


async def test_social_callback_unknown_email_is_rejected(client, monkeypatch):
    _patch_provider(monkeypatch, email="nobody-unknown@example.com")
    state = issue_state({"p": "google", "aud": "platform", "n": "x", "cv": None}, ttl_seconds=600)

    resp = await client.get(
        "/api/auth/social/google/callback",
        params={"code": "abc", "state": state},
        follow_redirects=False,
    )
    assert resp.status_code == 302
    loc = resp.headers["location"]
    assert "social_error=" in loc
    assert "access_token=" not in loc


async def test_social_callback_rejects_tampered_state(client, monkeypatch):
    _patch_provider(monkeypatch, email=PLATFORM_EMAIL)
    resp = await client.get(
        "/api/auth/social/google/callback",
        params={"code": "abc", "state": "not-a-valid-signed-state"},
        follow_redirects=False,
    )
    assert resp.status_code == 302
    assert "social_error=" in resp.headers["location"]
