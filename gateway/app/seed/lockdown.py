"""Demo-mode CRUD lockdown middleware.

When the demo tenant is active and `demo_crud_enabled` is False, block
non-read mutations originating from the demo tenant. Reads (GET / HEAD /
OPTIONS) always pass so the UI is still browsable. Mirrors the suspension
middleware's shape so they layer cleanly.
"""

from __future__ import annotations

from fastapi import status
from fastapi.responses import JSONResponse

from app.auth.service import decode_token
from app.customer_auth.plans import _tenant_id_for
from app.db import SessionLocal
from app.seed.service import is_demo_locked_for_tenant

_READ_METHODS = {"GET", "HEAD", "OPTIONS"}


async def demo_lockdown_middleware(request, call_next):
    """HTTP middleware: 403 mutations on the demo tenant when CRUD is off.

    Registered AFTER suspension so suspension still wins for suspended
    tenants. Allowlist matches suspension: identity + status checks are
    permitted (they're read-only)."""
    path = request.url.path
    method = request.method.upper()
    if (
        method not in _READ_METHODS
        and path.startswith("/api/tenant/")
    ):
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            try:
                claims = decode_token(auth[7:])
            except Exception:  # noqa: BLE001
                claims = None
            if claims and claims.get("tenant_kind") == "customer":
                try:
                    async with SessionLocal() as s:
                        tenant_id = await _tenant_id_for(s, claims)
                    if await is_demo_locked_for_tenant(tenant_id):
                        return JSONResponse(
                            status_code=status.HTTP_403_FORBIDDEN,
                            content={
                                "detail": {
                                    "code": "demo_locked",
                                    "message": "This is a demo workspace — changes are disabled.",
                                }
                            },
                        )
                except Exception:  # noqa: BLE001
                    # If the gate itself errors, fall through (don't 500 every write).
                    pass
    return await call_next(request)
