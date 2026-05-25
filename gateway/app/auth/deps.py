from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.service import decode_token

_bearer = HTTPBearer(auto_error=False)


def _claims_from_request(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> dict:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    try:
        return decode_token(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token expired") from None
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token") from None


def require_super_admin(
    claims: Annotated[dict, Depends(_claims_from_request)],
) -> dict:
    if claims.get("tenant_kind") != "platform":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "platform scope required")
    if claims.get("role") not in {"super_admin", "super_admin_staff"}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")
    return claims


def current_user_request(request: Request) -> Request:
    """Pass-through dependency so route handlers can inject Request without
    importing fastapi.Request directly."""
    return request
