"""Cross-tenant invites view for super-admin.

Lets platform operators inspect every invite across the system and revoke
problem ones. Tenant-side invite management (create/list-own/revoke-own)
lives in customer_auth/invites.py.
"""

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.db import get_session
from app.tenants.models import Invite, Tenant

router = APIRouter(prefix="/invites", tags=["admin:invites"])

Status = Literal["pending", "accepted", "expired", "all"]


class InviteRow(BaseModel):
    id: int
    tenant_id: int
    tenant_name: str
    tenant_slug: str
    email: str
    role: str
    expires_at: str
    accepted_at: str | None
    created_at: str
    state: str  # pending | accepted | expired


class InvitesRes(BaseModel):
    total: int
    items: list[InviteRow]


def _row(i: Invite, t: Tenant) -> InviteRow:
    now = datetime.now(UTC)
    if i.accepted_at is not None:
        state = "accepted"
    elif i.expires_at < now:
        state = "expired"
    else:
        state = "pending"
    return InviteRow(
        id=i.id,
        tenant_id=t.id,
        tenant_name=t.name,
        tenant_slug=t.slug,
        email=i.email,
        role=i.role,
        expires_at=i.expires_at.isoformat(),
        accepted_at=i.accepted_at.isoformat() if i.accepted_at else None,
        created_at=i.created_at.isoformat(),
        state=state,
    )


@router.get("")
async def list_invites(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    state: Status = "all",
    tenant_id: int | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> InvitesRes:
    stmt = (
        select(Invite, Tenant)
        .join(Tenant, Tenant.id == Invite.tenant_id)
        .order_by(Invite.created_at.desc())
    )
    count_stmt = select(func.count()).select_from(Invite)
    if tenant_id is not None:
        stmt = stmt.where(Invite.tenant_id == tenant_id)
        count_stmt = count_stmt.where(Invite.tenant_id == tenant_id)
    if state == "pending":
        stmt = stmt.where(Invite.accepted_at.is_(None)).where(
            Invite.expires_at > func.now()
        )
        count_stmt = count_stmt.where(Invite.accepted_at.is_(None)).where(
            Invite.expires_at > func.now()
        )
    elif state == "accepted":
        stmt = stmt.where(Invite.accepted_at.is_not(None))
        count_stmt = count_stmt.where(Invite.accepted_at.is_not(None))
    elif state == "expired":
        stmt = stmt.where(Invite.accepted_at.is_(None)).where(
            Invite.expires_at <= func.now()
        )
        count_stmt = count_stmt.where(Invite.accepted_at.is_(None)).where(
            Invite.expires_at <= func.now()
        )

    total = int((await session.execute(count_stmt)).scalar_one())
    rows = (await session.execute(stmt.limit(limit).offset(offset))).all()
    return InvitesRes(
        total=total,
        items=[_row(invite, tenant) for invite, tenant in rows],
    )


@router.delete("/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(
    invite_id: int,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    invite = await session.get(Invite, invite_id)
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invite not found")
    if invite.accepted_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "invite already accepted")

    actor_id: int | None = None
    sub = claims.get("sub", "")
    if sub.startswith("p_"):
        try:
            actor_id = int(sub[2:])
        except ValueError:
            actor_id = None

    await session.delete(invite)
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=actor_id,
        action="admin.invite.revoked",
        target_kind="invite",
        target_id=str(invite_id),
        payload={"tenant_id": invite.tenant_id, "email": invite.email},
    )
    await session.commit()
