"""FastAPI dependencies for tenant-side route protection."""

from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
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


def require_customer(
    claims: Annotated[dict, Depends(_claims_from_request)],
) -> dict:
    if claims.get("tenant_kind") != "customer":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "customer scope required")
    return claims


def require_org_admin(
    claims: Annotated[dict, Depends(require_customer)],
) -> dict:
    if claims.get("role") not in {"org_owner", "org_admin"}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "org admin role required")
    return claims


def require_org_owner(
    claims: Annotated[dict, Depends(require_customer)],
) -> dict:
    if claims.get("role") != "org_owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "org owner role required")
    return claims
