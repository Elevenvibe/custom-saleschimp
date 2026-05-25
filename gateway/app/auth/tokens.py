"""URL-safe signed tokens for verification + invite links.

Self-contained: payload + expiry + HMAC are encoded in the token itself, so
no DB lookup is needed to validate. The signing secret is the gateway JWT
secret — these tokens can't be forged without it.

Tokens look like: `<urlsafe_b64(payload_json)>.<expiry_ts>.<hmac_hex>`
"""

from __future__ import annotations

import base64
import hmac
import json
import time
from hashlib import sha256
from typing import Any

from app.config import settings


class InvalidToken(Exception):
    pass


class TokenExpired(Exception):
    pass


def _sign(message: str) -> str:
    return hmac.new(
        settings.jwt_secret.encode(),
        message.encode(),
        sha256,
    ).hexdigest()


def issue(payload: dict[str, Any], *, ttl_seconds: int) -> str:
    expiry = int(time.time()) + ttl_seconds
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode()
    ).rstrip(b"=").decode()
    body = f"{payload_b64}.{expiry}"
    sig = _sign(body)
    return f"{body}.{sig}"


def verify(token: str) -> dict[str, Any]:
    """Validate signature + expiry; return the payload.

    Raises InvalidToken on any parsing/signing error, TokenExpired if past
    expiry. Callers should treat both as 401/400 without leaking which.
    """
    try:
        payload_b64, expiry_str, sig = token.rsplit(".", 2)
    except ValueError as e:
        raise InvalidToken("malformed token") from e

    expected = _sign(f"{payload_b64}.{expiry_str}")
    if not hmac.compare_digest(expected, sig):
        raise InvalidToken("signature mismatch")

    try:
        expiry = int(expiry_str)
    except ValueError as e:
        raise InvalidToken("bad expiry") from e
    if expiry < int(time.time()):
        raise TokenExpired("expired")

    # Pad and decode payload.
    pad = "=" * (-len(payload_b64) % 4)
    try:
        raw = base64.urlsafe_b64decode(payload_b64 + pad)
        return json.loads(raw)
    except Exception as e:
        raise InvalidToken("bad payload") from e
