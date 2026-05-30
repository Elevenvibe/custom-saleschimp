"""Google OAuth + People API client for the tenant integration.

All calls are httpx (no SDK). Tokens for a tenant's linked account live
encrypted in google_links; this module builds the consent URL, exchanges the
code (offline access → refresh token), refreshes access tokens, and pulls
connections (contacts) from the People API.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
import structlog

log = structlog.get_logger()

_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN = "https://oauth2.googleapis.com/token"
_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"
_PEOPLE = "https://people.googleapis.com/v1/people/me/connections"
_TIMEOUT = 12.0


def build_authorize_url(cfg: dict[str, Any], *, state: str) -> str:
    scopes = ["openid", "email"] + list(cfg.get("scopes") or [])
    params = {
        "client_id": cfg["client_id"],
        "redirect_uri": cfg["callback_url"],
        "response_type": "code",
        "scope": " ".join(dict.fromkeys(scopes)),  # de-dup, preserve order
        "access_type": "offline",
        "prompt": "consent",  # force a refresh_token on re-link
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{_AUTHORIZE}?{urlencode(params)}"


async def exchange_code(cfg: dict[str, Any], *, code: str) -> dict[str, Any] | None:
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": cfg["callback_url"],
        "client_id": cfg["client_id"],
        "client_secret": cfg.get("secret") or "",
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(_TOKEN, data=data, headers={"Accept": "application/json"})
            if resp.status_code >= 300:
                log.warning("google.token_failed", status=resp.status_code, body=resp.text[:200])
                return None
            return resp.json()
    except Exception as e:  # noqa: BLE001
        log.warning("google.token_error", error=str(e))
        return None


async def refresh_access_token(cfg: dict[str, Any], *, refresh_token: str) -> dict[str, Any] | None:
    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": cfg["client_id"],
        "client_secret": cfg.get("secret") or "",
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(_TOKEN, data=data, headers={"Accept": "application/json"})
            if resp.status_code >= 300:
                log.warning("google.refresh_failed", status=resp.status_code, body=resp.text[:200])
                return None
            return resp.json()
    except Exception as e:  # noqa: BLE001
        log.warning("google.refresh_error", error=str(e))
        return None


def expiry_from(token_resp: dict[str, Any]) -> datetime | None:
    secs = token_resp.get("expires_in")
    if not secs:
        return None
    return datetime.now(timezone.utc) + timedelta(seconds=int(secs) - 30)


async def fetch_email(access_token: str) -> str | None:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(_USERINFO, headers={"Authorization": f"Bearer {access_token}"})
            if resp.status_code >= 300:
                return None
            email = resp.json().get("email")
            return email.lower() if isinstance(email, str) else None
    except Exception:  # noqa: BLE001
        return None


async def list_connections(access_token: str, *, max_pages: int = 10) -> list[dict[str, Any]]:
    """Pull contacts (People API connections). Returns normalized dicts:
    {resource_name, display_name, email, phone}."""
    out: list[dict[str, Any]] = []
    page_token: str | None = None
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            for _ in range(max_pages):
                params = {
                    "personFields": "names,emailAddresses,phoneNumbers",
                    "pageSize": "200",
                }
                if page_token:
                    params["pageToken"] = page_token
                resp = await client.get(
                    _PEOPLE, params=params, headers={"Authorization": f"Bearer {access_token}"}
                )
                if resp.status_code >= 300:
                    log.warning("google.people_failed", status=resp.status_code, body=resp.text[:200])
                    break
                data = resp.json()
                for p in data.get("connections", []) or []:
                    names = p.get("names") or []
                    emails = p.get("emailAddresses") or []
                    phones = p.get("phoneNumbers") or []
                    out.append(
                        {
                            "resource_name": p.get("resourceName"),
                            "display_name": names[0].get("displayName") if names else None,
                            "email": emails[0].get("value") if emails else None,
                            "phone": phones[0].get("value") if phones else None,
                        }
                    )
                page_token = data.get("nextPageToken")
                if not page_token:
                    break
    except Exception as e:  # noqa: BLE001
        log.warning("google.people_error", error=str(e))
    return out
