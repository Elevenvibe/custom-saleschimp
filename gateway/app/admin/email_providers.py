from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_super_admin
from app.db import get_session
from app.email.models import EmailProviderConfig

router = APIRouter(prefix="/email-providers", tags=["admin:email-providers"])


@router.get("")
async def list_email_providers(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[dict]:
    """List email provider configurations across all scopes.

    Secrets are NEVER returned — only metadata. The full provider CRUD with
    encrypted-secret write/test-send lands in the follow-up admin work.
    """
    rows = (
        await session.execute(
            select(EmailProviderConfig).order_by(
                EmailProviderConfig.scope_kind, EmailProviderConfig.scope_id
            )
        )
    ).scalars().all()
    return [
        {
            "id": c.id,
            "scope_kind": c.scope_kind,
            "scope_id": c.scope_id,
            "provider": c.provider,
            "from_email": c.from_email,
            "from_name": c.from_name,
            "is_active": c.is_active,
            "created_at": c.created_at.isoformat(),
            "updated_at": c.updated_at.isoformat(),
        }
        for c in rows
    ]
