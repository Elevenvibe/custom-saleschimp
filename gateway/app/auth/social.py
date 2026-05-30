"""Social login — OAuth2 provider registry, config storage, and the auth
machinery (authorize URL build, code exchange, userinfo email fetch).

Providers: Google, Facebook, LinkedIn, X (Twitter). Per-provider credentials
(client id + secret + redirect/callback URL + enabled) are configured in
Settings → Social login and stored in platform_settings['social_login'] with
the secret Fernet-encrypted.

Account policy: social login NEVER creates accounts. The callback resolves an
EXISTING account by verified email (a platform_user for the admin audience, a
tenant member for the customer audience) and issues that account's session.
No match → the caller is sent back with an error. (See user_privacy: never
create accounts on the user's behalf.)
"""

from __future__ import annotations

import base64
import hashlib
import secrets
from typing import Any

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import PlatformSetting
from app.email.crypto import decrypt_dict, encrypt_dict

log = structlog.get_logger()

_KEY = "social_login"
_HTTP_TIMEOUT = 10.0


# Provider registry. `email_path` describes how to pull the email out of the
# userinfo response; None means the provider doesn't reliably return email.
PROVIDERS: dict[str, dict[str, Any]] = {
    "google": {
        "name": "Google",
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://openidconnect.googleapis.com/v1/userinfo",
        "scopes": "openid email profile",
        "pkce": False,
        "email_key": "email",
        "name_key": "name",
        "setup_url": "https://console.cloud.google.com/apis/credentials",
    },
    "facebook": {
        "name": "Facebook",
        "authorize_url": "https://www.facebook.com/v21.0/dialog/oauth",
        "token_url": "https://graph.facebook.com/v21.0/oauth/access_token",
        "userinfo_url": "https://graph.facebook.com/me?fields=email,name",
        "scopes": "email",
        "pkce": False,
        "email_key": "email",
        "name_key": "name",
        "setup_url": "https://developers.facebook.com/apps",
    },
    "linkedin": {
        "name": "LinkedIn",
        "authorize_url": "https://www.linkedin.com/oauth/v2/authorization",
        "token_url": "https://www.linkedin.com/oauth/v2/accessToken",
        "userinfo_url": "https://api.linkedin.com/v2/userinfo",
        "scopes": "openid email profile",
        "pkce": False,
        "email_key": "email",
        "name_key": "name",
        "setup_url": "https://www.linkedin.com/developers/apps",
    },
    "twitter": {
        "name": "X (Twitter)",
        "authorize_url": "https://twitter.com/i/oauth2/authorize",
        "token_url": "https://api.twitter.com/2/oauth2/token",
        "userinfo_url": "https://api.twitter.com/2/users/me",
        "scopes": "users.read tweet.read",
        "pkce": True,
        # X does not return email without elevated access — usually unavailable.
        "email_key": None,
        "name_key": "name",
        "setup_url": "https://developer.twitter.com/en/portal/dashboard",
    },
}


def is_known(provider: str) -> bool:
    return provider in PROVIDERS


# ---- config storage -------------------------------------------------------


async def _row(session: AsyncSession) -> PlatformSetting | None:
    return (
        await session.execute(select(PlatformSetting).where(PlatformSetting.key == _KEY))
    ).scalar_one_or_none()


async def _all(session: AsyncSession) -> dict[str, Any]:
    row = await _row(session)
    return dict(row.value) if row and row.value else {}


def _secret(cfg: dict[str, Any]) -> str | None:
    enc = cfg.get("secret_enc")
    if not enc:
        return None
    try:
        return decrypt_dict(enc).get("secret")
    except Exception:  # noqa: BLE001
        return None


async def get_provider_config(session: AsyncSession, provider: str) -> dict[str, Any]:
    """Full config incl. decrypted secret — internal use (start/callback)."""
    cfg = (await _all(session)).get(provider) or {}
    return {
        "enabled": bool(cfg.get("enabled")),
        "client_id": cfg.get("client_id") or "",
        "callback_url": cfg.get("callback_url") or "",
        "secret": _secret(cfg),
    }


async def get_admin_snapshot(session: AsyncSession) -> list[dict[str, Any]]:
    """Per-provider config for the settings page (no secret, has_secret flag)."""
    data = await _all(session)
    out = []
    for key, meta in PROVIDERS.items():
        cfg = data.get(key) or {}
        out.append(
            {
                "provider": key,
                "name": meta["name"],
                "enabled": bool(cfg.get("enabled")),
                "client_id": cfg.get("client_id") or "",
                "callback_url": cfg.get("callback_url") or "",
                "has_secret": bool(cfg.get("secret_enc")),
                "scopes": meta["scopes"],
                "setup_url": meta["setup_url"],
                "returns_email": meta["email_key"] is not None,
            }
        )
    return out


async def save_provider_config(
    session: AsyncSession,
    provider: str,
    *,
    enabled: bool,
    client_id: str,
    callback_url: str,
    secret: str | None,
) -> None:
    data = await _all(session)
    cfg = dict(data.get(provider) or {})
    cfg.update({"enabled": enabled, "client_id": client_id.strip(), "callback_url": callback_url.strip()})
    if secret:
        cfg["secret_enc"] = encrypt_dict({"secret": secret})
    data[provider] = cfg
    row = await _row(session)
    if row is None:
        session.add(PlatformSetting(key=_KEY, value=data))
    else:
        row.value = data


async def public_config(session: AsyncSession) -> list[dict[str, Any]]:
    """Enabled providers + client id for the login page to render buttons.
    Never includes secrets."""
    data = await _all(session)
    out = []
    for key, meta in PROVIDERS.items():
        cfg = data.get(key) or {}
        if cfg.get("enabled") and cfg.get("client_id") and cfg.get("secret_enc"):
            out.append({"provider": key, "name": meta["name"]})
    return out


# ---- OAuth flow -----------------------------------------------------------


def make_pkce() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) for PKCE S256."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode()
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    return verifier, challenge


def build_authorize_url(
    provider: str, cfg: dict[str, Any], *, state: str, code_challenge: str | None
) -> str:
    meta = PROVIDERS[provider]
    from urllib.parse import urlencode

    params = {
        "client_id": cfg["client_id"],
        "redirect_uri": cfg["callback_url"],
        "response_type": "code",
        "scope": meta["scopes"],
        "state": state,
    }
    if meta["pkce"] and code_challenge:
        params["code_challenge"] = code_challenge
        params["code_challenge_method"] = "S256"
    return f"{meta['authorize_url']}?{urlencode(params)}"


async def exchange_code(
    provider: str, cfg: dict[str, Any], *, code: str, code_verifier: str | None
) -> str | None:
    """Exchange the auth code for an access token. Returns the token or None."""
    meta = PROVIDERS[provider]
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": cfg["callback_url"],
        "client_id": cfg["client_id"],
        "client_secret": cfg.get("secret") or "",
    }
    if meta["pkce"] and code_verifier:
        data["code_verifier"] = code_verifier
    headers = {"Accept": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(meta["token_url"], data=data, headers=headers)
            if resp.status_code >= 300:
                log.warning("social.token_failed", provider=provider, status=resp.status_code, body=resp.text[:200])
                return None
            return resp.json().get("access_token")
    except Exception as e:  # noqa: BLE001
        log.warning("social.token_error", provider=provider, error=str(e))
        return None


async def fetch_email(provider: str, access_token: str) -> tuple[str | None, str | None]:
    """Fetch (email, name) from the provider's userinfo endpoint."""
    meta = PROVIDERS[provider]
    if meta["email_key"] is None:
        return None, None
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(
                meta["userinfo_url"], headers={"Authorization": f"Bearer {access_token}"}
            )
            if resp.status_code >= 300:
                log.warning("social.userinfo_failed", provider=provider, status=resp.status_code)
                return None, None
            data = resp.json()
            email = data.get(meta["email_key"])
            name = data.get(meta["name_key"])
            return (email.lower() if isinstance(email, str) else None), name
    except Exception as e:  # noqa: BLE001
        log.warning("social.userinfo_error", provider=provider, error=str(e))
        return None, None
