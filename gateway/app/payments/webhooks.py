"""Public webhook endpoints — no auth (signature-verified instead).

Mounted under /api/billing/webhook/{provider}. Both Stripe and Paystack
deliver POST requests with a signature header we verify before parsing.
On success we ack with 200 + a short status string; on signature
mismatch we return 400 so the provider's retry logic kicks in only when
it's a transient issue, not a misconfiguration.
"""

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.payments import service as payments_service
from app.payments.adapters import UnknownProvider, get_provider
from app.payments.adapters.base import ProviderError

log = structlog.get_logger()

router = APIRouter(prefix="/billing/webhook", tags=["payments:webhook"])


@router.post("/{provider}")
async def receive_webhook(
    provider: str,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    stripe_signature: Annotated[str | None, Header(alias="Stripe-Signature")] = None,
    paystack_signature: Annotated[str | None, Header(alias="x-paystack-signature")] = None,
) -> dict[str, str]:
    try:
        adapter = get_provider(provider)
    except UnknownProvider:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown provider") from None

    signature = stripe_signature if provider == "stripe" else paystack_signature
    if not signature:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "missing signature header")

    body = await request.body()
    try:
        raw_event = adapter.verify_webhook(payload=body, signature=signature)
    except ProviderError as e:
        log.warning("webhook.verify_failed", provider=provider, error=str(e))
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None

    event = adapter.parse_event(raw_event)
    status_str = await payments_service.reconcile_event(session, provider, event)
    await session.commit()
    log.info("webhook.handled", provider=provider, kind=event.kind, status=status_str)
    return {"status": status_str}
