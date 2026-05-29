"""Admin payments visibility.

GET /api/admin/payments/providers       which adapters are configured
GET /api/admin/payments/auto-reload/status   cron heartbeat
POST /api/admin/payments/auto-reload/run     manually trigger one sweep
GET /api/admin/payments/intents              recent intents across all tenants
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_super_admin
from app.db import get_session
from app.payments import service as payments_service
from app.payments.adapters.base import ProviderError
from app.payments.cron import get_status, run_once
from app.payments.models import PaymentIntent

router = APIRouter(prefix="/payments", tags=["admin:payments"])


class AutoReloadStatus(BaseModel):
    enabled: bool
    interval_seconds: int
    running: bool
    last_run_at: str | None
    last_checked: int
    last_reloaded: int


class AutoReloadRunRes(BaseModel):
    checked: int
    reloaded: int


class IntentOut(BaseModel):
    id: int
    tenant_id: int
    provider: str
    provider_ref: str
    amount_cents: int
    currency: str
    status: str
    created_at: str


@router.get("/providers")
async def list_providers(
    _claims: Annotated[dict, Depends(require_super_admin)],
) -> list[dict]:
    return await payments_service.list_providers()


@router.get("/auto-reload/status", response_model=AutoReloadStatus)
async def auto_reload_status(
    _claims: Annotated[dict, Depends(require_super_admin)],
) -> AutoReloadStatus:
    return AutoReloadStatus(**get_status())


@router.post("/auto-reload/run", response_model=AutoReloadRunRes)
async def auto_reload_run(
    _claims: Annotated[dict, Depends(require_super_admin)],
) -> AutoReloadRunRes:
    return AutoReloadRunRes(**(await run_once()))


@router.get("/intents", response_model=list[IntentOut])
async def list_intents(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = 100,
) -> list[IntentOut]:
    rows = (
        await session.execute(
            select(PaymentIntent)
            .order_by(PaymentIntent.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [
        IntentOut(
            id=r.id,
            tenant_id=r.tenant_id,
            provider=r.provider,
            provider_ref=r.provider_ref,
            amount_cents=r.amount_cents,
            currency=r.currency,
            status=r.status,
            created_at=r.created_at.isoformat(),
        )
        for r in rows
    ]


@router.post("/intents/{intent_id}/sync")
async def sync_intent(
    intent_id: int,
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Force-reconcile one intent against the provider — the no-webhook
    path. Lets an admin confirm a payment (and credit the wallet) when a
    webhook never arrived, which is what makes the dashboard's payment
    gateway breakdown populate in environments without webhook delivery."""
    intent = await session.get(PaymentIntent, intent_id)
    if intent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "intent not found")
    try:
        result = await payments_service.sync_intent(session, intent)
    except ProviderError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from None
    await session.commit()
    return {"result": result, "status": intent.status}
