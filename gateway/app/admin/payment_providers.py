"""Admin: Stripe / Paystack secret + publishable + webhook key CRUD.

This is the runtime alternative to `STRIPE_SECRET_KEY` env vars. Keys
are Fernet-encrypted at rest using GATEWAY_SECRETS_KEY (the same
secret that protects email-provider and cost-provider credentials).

Read endpoints NEVER return the raw secret — only a status object
with the last 4 chars so a super-admin can sanity-check what's
stored. The publishable key IS returned because Stripe Elements /
Paystack inline need it client-side.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.db import get_session
from app.payments import config_service

router = APIRouter(prefix="/payment-providers", tags=["admin:payments"])

ProviderSlug = Literal["stripe", "paystack"]


class ProviderStatusOut(BaseModel):
    provider: str
    configured: bool
    source: str | None
    publishable_key: str
    has_webhook_secret: bool
    secret_key_last4: str | None


class ProviderConfigIn(BaseModel):
    secret_key: str = Field(min_length=1, max_length=512)
    publishable_key: str = Field(default="", max_length=512)
    webhook_secret: str = Field(default="", max_length=512)
    active: bool = True
    notes: str | None = Field(default=None, max_length=1024)


def _actor_id(claims: dict) -> int | None:
    sub = claims.get("sub", "")
    if sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            return None
    return None


@router.get("", response_model=list[ProviderStatusOut])
async def list_providers(
    _claims: Annotated[dict, Depends(require_super_admin)],
) -> list[ProviderStatusOut]:
    rows = []
    for slug in ("stripe", "paystack"):
        rows.append(ProviderStatusOut(**(await config_service.status_for(slug))))
    return rows


@router.get("/{provider}", response_model=ProviderStatusOut)
async def get_provider(
    provider: ProviderSlug,
    _claims: Annotated[dict, Depends(require_super_admin)],
) -> ProviderStatusOut:
    return ProviderStatusOut(**(await config_service.status_for(provider)))


@router.put("/{provider}", response_model=ProviderStatusOut)
async def upsert_provider(
    provider: ProviderSlug,
    body: ProviderConfigIn,
    request: Request,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProviderStatusOut:
    if not body.secret_key.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "secret_key required")
    await config_service.upsert(
        session,
        provider=provider,
        secret_key=body.secret_key.strip(),
        publishable_key=body.publishable_key.strip(),
        webhook_secret=body.webhook_secret.strip(),
        active=body.active,
        notes=body.notes,
    )
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.payment_provider.upsert",
        target_kind="payment_provider",
        target_id=provider,
        request=request,
        # Never log the secret. Only metadata.
        payload={
            "provider": provider,
            "has_publishable_key": bool(body.publishable_key),
            "has_webhook_secret": bool(body.webhook_secret),
            "active": body.active,
        },
    )
    await session.commit()
    return ProviderStatusOut(**(await config_service.status_for(provider)))


@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(
    provider: ProviderSlug,
    request: Request,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    removed = await config_service.delete(session, provider=provider)
    if not removed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no stored config")
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.payment_provider.delete",
        target_kind="payment_provider",
        target_id=provider,
        request=request,
    )
    await session.commit()
