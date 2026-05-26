"""Customer-facing wallet + usage + coupon endpoints.

GET  /api/tenant/wallet             balance + last N ledger entries
GET  /api/tenant/wallet/ledger      paginated ledger
GET  /api/tenant/usage              paginated usage_records
GET  /api/tenant/usage/daily        per-day rollup for the billing chart
POST /api/tenant/wallet/coupons/redeem
POST /api/tenant/wallet/auto-reload (org_admin+)

Top-up endpoints land in P2.A3b (they need Stripe/Paystack adapters).
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.customer_auth.deps import require_customer, require_org_admin
from app.customer_auth.plans import _tenant_id_for
from app.db import get_session
from app.wallet import coupon_service, service as wallet_service, usage_service
from app.wallet.models import Wallet

router = APIRouter(tags=["customer-auth:wallet"])


class WalletSummaryOut(BaseModel):
    tenant_id: int
    balance_micros: int
    currency: str
    auto_reload_enabled: bool
    auto_reload_threshold_micros: int
    auto_reload_amount_micros: int
    recent_ledger: list[dict]


class AutoReloadIn(BaseModel):
    enabled: bool
    threshold_micros: int = Field(ge=0, default=0)
    amount_micros: int = Field(ge=0, default=0)
    payment_method_id: int | None = None


class CouponRedeemIn(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    # Optional — without it, percentage coupons can't resolve.
    top_up_micros: int | None = Field(default=None, ge=0)


class CouponRedeemOut(BaseModel):
    coupon_id: int
    value_applied_micros: int
    new_balance_micros: int


def _serialize_summary(w: Wallet, ledger: list[dict]) -> WalletSummaryOut:
    return WalletSummaryOut(
        tenant_id=w.tenant_id,
        balance_micros=w.balance_micros,
        currency=w.currency,
        auto_reload_enabled=w.auto_reload_enabled,
        auto_reload_threshold_micros=w.auto_reload_threshold_micros,
        auto_reload_amount_micros=w.auto_reload_amount_micros,
        recent_ledger=ledger,
    )


@router.get("/wallet", response_model=WalletSummaryOut)
async def get_wallet(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
    currency: str = "USD",
) -> WalletSummaryOut:
    """Single-currency view — defaults to USD for backcompat. Pass
    `?currency=NGN` to see another currency's wallet for this tenant."""
    tenant_id = await _tenant_id_for(session, claims)
    w = await wallet_service.get_or_create_wallet(session, tenant_id, currency)
    ledger = await wallet_service.recent_ledger(
        session, tenant_id, currency=currency, limit=20
    )
    await session.commit()
    return _serialize_summary(w, ledger)


class WalletRowOut(BaseModel):
    currency: str
    balance_micros: int
    credit_limit_micros: int
    auto_reload_enabled: bool


@router.get("/wallets", response_model=list[WalletRowOut])
async def list_wallets(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[WalletRowOut]:
    """One row per currency this tenant holds. The customer billing
    page renders a balance card per row."""
    tenant_id = await _tenant_id_for(session, claims)
    wallets = await wallet_service.list_wallets(session, tenant_id)
    return [
        WalletRowOut(
            currency=w.currency,
            balance_micros=w.balance_micros,
            credit_limit_micros=w.credit_limit_micros,
            auto_reload_enabled=w.auto_reload_enabled,
        )
        for w in wallets
    ]


@router.get("/wallet/ledger")
async def list_ledger(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = 100,
) -> list[dict]:
    tenant_id = await _tenant_id_for(session, claims)
    return await wallet_service.recent_ledger(session, tenant_id, limit=limit)


@router.get("/usage")
async def list_usage(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    tenant_id = await _tenant_id_for(session, claims)
    return await usage_service.list_for_tenant(
        session, tenant_id, limit=limit, offset=offset
    )


@router.get("/usage/daily")
async def usage_daily(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
    days: int = 30,
) -> list[dict]:
    tenant_id = await _tenant_id_for(session, claims)
    return await usage_service.daily_aggregates(session, tenant_id, days=days)


@router.post("/wallet/auto-reload", response_model=WalletSummaryOut)
async def set_auto_reload(
    body: AutoReloadIn,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> WalletSummaryOut:
    tenant_id = await _tenant_id_for(session, claims)
    w = await wallet_service.get_or_create_wallet(session, tenant_id)
    # The cron in P2.A3b actually triggers the reload; here we just
    # store the preference. If enabled, both threshold and amount must
    # be positive — meaningless otherwise.
    if body.enabled and (body.threshold_micros <= 0 or body.amount_micros <= 0):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "threshold and amount must be > 0 when auto-reload is enabled",
        )
    w.auto_reload_enabled = body.enabled
    w.auto_reload_threshold_micros = body.threshold_micros
    w.auto_reload_amount_micros = body.amount_micros
    w.auto_reload_payment_method_id = body.payment_method_id
    ledger = await wallet_service.recent_ledger(session, tenant_id, limit=20)
    await session.commit()
    return _serialize_summary(w, ledger)


@router.post("/wallet/coupons/redeem", response_model=CouponRedeemOut)
async def redeem_coupon(
    body: CouponRedeemIn,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CouponRedeemOut:
    tenant_id = await _tenant_id_for(session, claims)

    # Look up the tenant's current package slug for package-scoped
    # coupons. We can't import plans._current_package_id_for cheaply
    # without circulating an import, so do a small inline query.
    from sqlalchemy import text
    current_slug = (
        await session.execute(
            text(
                """
                SELECT p.slug
                FROM tenant_packages tp
                JOIN packages p ON p.id = tp.package_id
                WHERE tp.tenant_id = :tid
                """
            ),
            {"tid": tenant_id},
        )
    ).scalar_one_or_none()

    try:
        result = await coupon_service.redeem(
            session,
            code=body.code.upper(),
            tenant_id=tenant_id,
            top_up_micros=body.top_up_micros,
            current_package_slug=current_slug,
        )
    except coupon_service.CouponNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "coupon not found") from None
    except coupon_service.CouponAlreadyRedeemed:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "coupon already redeemed for this tenant"
        ) from None
    except coupon_service.CouponInvalid as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None

    await session.commit()
    w = await wallet_service.get_or_create_wallet(session, tenant_id)
    return CouponRedeemOut(
        coupon_id=result.coupon_id,
        value_applied_micros=result.value_applied_micros,
        new_balance_micros=w.balance_micros,
    )
