from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.models import AuditLog


async def record_audit(
    session: AsyncSession,
    *,
    actor_kind: str,
    action: str,
    actor_user_id: int | None = None,
    target_kind: str | None = None,
    target_id: str | None = None,
    payload: dict[str, Any] | None = None,
    request: Request | None = None,
) -> AuditLog:
    """Write an audit log entry. Caller owns commit/rollback."""
    entry = AuditLog(
        actor_user_id=actor_user_id,
        actor_kind=actor_kind,
        action=action,
        target_kind=target_kind,
        target_id=target_id,
        payload=payload or {},
        ip=_client_ip(request) if request else None,
        ua=request.headers.get("user-agent") if request else None,
    )
    session.add(entry)
    await session.flush()
    return entry


def _client_ip(request: Request) -> str | None:
    # Honor X-Forwarded-For when the gateway is behind nginx.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else None
