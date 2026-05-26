"""Admin: per-tenant wallet view + manual adjustments + usage browse.

Adjustments are the only place we let super-admins push the balance
around without going through Stripe/Paystack. Every adjustment lands a
ledger row tagged `actor_kind='platform'` plus an audit_log entry, so
"who credited that tenant $100" has a single, replayable answer.

Coupons CRUD also lives here — they're an admin-managed resource,
tenants only see them when they paste a code at top-up time.
"""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.db import get_session
from app.wallet import service as wallet_service
from app.wallet import usage_service
from app.wallet.models import Coupon, UsageRecord, Wallet

router = APIRouter(tags=["admin:wallet"])


# --- Schemas --------------------------------------------------------------


class WalletOut(BaseModel):
    tenant_id: int
    balance_micros: int
    currency: str
    credit_limit_micros: int
    auto_reload_enabled: bool
    auto_reload_threshold_micros: int
    auto_reload_amount_micros: int
    auto_reload_payment_method_id: int | None


class WalletAdjustIn(BaseModel):
    delta_micros: int = Field(description="Signed; positive credits, negative debits")
    notes: str = Field(min_length=1, max_length=512)


class WalletCreditLimitIn(BaseModel):
    credit_limit_micros: int = Field(ge=0)


class UsageRowOut(BaseModel):
    id: int
    tenant_id: int
    external_ref: str
    kind: str
    unit: str
    quantity_micros: int
    billed_micros: int
    currency: str
    occurred_at: str


class CouponIn(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    kind: Literal["percentage", "fixed_micros"]
    value_micros: int = Field(ge=0)
    currency: str = "USD"
    scope_kind: Literal["global", "package"] = "global"
    scope_value: str | None = None
    max_uses: int | None = Field(default=None, ge=1)
    expires_at: datetime | None = None
    active: bool = True
    notes: str | None = None


class CouponPatch(BaseModel):
    active: bool | None = None
    max_uses: int | None = Field(default=None, ge=0)
    expires_at: datetime | None = None
    notes: str | None = None


class CouponOut(BaseModel):
    id: int
    code: str
    kind: str
    value_micros: int
    currency: str
    scope_kind: str
    scope_value: str | None
    max_uses: int | None
    uses_count: int
    expires_at: str | None
    active: bool
    notes: str | None
    created_at: str


def _serialize_wallet(w: Wallet) -> WalletOut:
    return WalletOut(
        tenant_id=w.tenant_id,
        balance_micros=w.balance_micros,
        currency=w.currency,
        credit_limit_micros=w.credit_limit_micros,
        auto_reload_enabled=w.auto_reload_enabled,
        auto_reload_threshold_micros=w.auto_reload_threshold_micros,
        auto_reload_amount_micros=w.auto_reload_amount_micros,
        auto_reload_payment_method_id=w.auto_reload_payment_method_id,
    )


def _serialize_coupon(c: Coupon) -> CouponOut:
    return CouponOut(
        id=c.id,
        code=c.code,
        kind=c.kind,
        value_micros=c.value_micros,
        currency=c.currency,
        scope_kind=c.scope_kind,
        scope_value=c.scope_value,
        max_uses=c.max_uses,
        uses_count=c.uses_count,
        expires_at=c.expires_at.isoformat() if c.expires_at else None,
        active=c.active,
        notes=c.notes,
        created_at=c.created_at.isoformat(),
    )


def _actor_id(claims: dict) -> int | None:
    sub = claims.get("sub", "")
    if sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            return None
    return None


# --- Wallet routes --------------------------------------------------------


@router.get("/tenants/{tenant_id}/wallet", response_model=WalletOut)
async def get_wallet(
    tenant_id: int,
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> WalletOut:
    w = await wallet_service.get_or_create_wallet(session, tenant_id)
    await session.commit()
    return _serialize_wallet(w)


@router.post("/tenants/{tenant_id}/wallet/adjust", response_model=WalletOut)
async def adjust_wallet(
    tenant_id: int,
    body: WalletAdjustIn,
    request: Request,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> WalletOut:
    try:
        await wallet_service.adjust(
            session,
            tenant_id,
            body.delta_micros,
            actor_user_id=_actor_id(claims),
            notes=body.notes,
        )
    except wallet_service.InsufficientFunds as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None

    w = await wallet_service.get_or_create_wallet(session, tenant_id)
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.wallet.adjust",
        target_kind="tenant",
        target_id=str(tenant_id),
        request=request,
        payload={"delta_micros": body.delta_micros, "notes": body.notes},
    )
    await session.commit()
    return _serialize_wallet(w)


@router.post("/tenants/{tenant_id}/wallet/credit-limit", response_model=WalletOut)
async def set_credit_limit(
    tenant_id: int,
    body: WalletCreditLimitIn,
    request: Request,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> WalletOut:
    w = await wallet_service.get_or_create_wallet(session, tenant_id)
    w.credit_limit_micros = body.credit_limit_micros
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.wallet.credit_limit",
        target_kind="tenant",
        target_id=str(tenant_id),
        request=request,
        payload={"credit_limit_micros": body.credit_limit_micros},
    )
    await session.commit()
    return _serialize_wallet(w)


@router.get("/tenants/{tenant_id}/wallet/ledger")
async def list_ledger(
    tenant_id: int,
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = 100,
) -> list[dict]:
    return await wallet_service.recent_ledger(session, tenant_id, limit=limit)


@router.get("/tenants/{tenant_id}/usage", response_model=list[UsageRowOut])
async def list_usage(
    tenant_id: int,
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = 100,
    offset: int = 0,
) -> list[UsageRowOut]:
    rows = await usage_service.list_for_tenant(session, tenant_id, limit=limit, offset=offset)
    return [UsageRowOut(tenant_id=tenant_id, **r) for r in rows]


# --- Coupons CRUD ---------------------------------------------------------


@router.get("/coupons", response_model=list[CouponOut])
async def list_coupons(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[CouponOut]:
    rows = (
        await session.execute(select(Coupon).order_by(Coupon.created_at.desc()))
    ).scalars().all()
    return [_serialize_coupon(c) for c in rows]


@router.post("/coupons", response_model=CouponOut, status_code=status.HTTP_201_CREATED)
async def create_coupon(
    body: CouponIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CouponOut:
    if body.scope_kind == "package" and not body.scope_value:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "scope_value required when scope_kind is 'package'",
        )
    coupon = Coupon(
        code=body.code.upper(),
        kind=body.kind,
        value_micros=body.value_micros,
        currency=body.currency.upper(),
        scope_kind=body.scope_kind,
        scope_value=body.scope_value,
        max_uses=body.max_uses,
        expires_at=body.expires_at,
        active=body.active,
        notes=body.notes,
    )
    session.add(coupon)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "coupon code already taken") from None

    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.coupon.create",
        target_kind="coupon",
        target_id=str(coupon.id),
        payload={"code": coupon.code, "kind": coupon.kind},
    )
    await session.commit()
    return _serialize_coupon(coupon)


@router.patch("/coupons/{coupon_id}", response_model=CouponOut)
async def update_coupon(
    coupon_id: int,
    body: CouponPatch,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CouponOut:
    coupon = await session.get(Coupon, coupon_id)
    if coupon is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "coupon not found")
    for field in ("active", "max_uses", "expires_at", "notes"):
        v = getattr(body, field)
        if v is not None:
            setattr(coupon, field, v)
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.coupon.update",
        target_kind="coupon",
        target_id=str(coupon.id),
    )
    await session.commit()
    await session.refresh(coupon)
    return _serialize_coupon(coupon)


@router.delete("/coupons/{coupon_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_coupon(
    coupon_id: int,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    coupon = await session.get(Coupon, coupon_id)
    if coupon is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "coupon not found")
    await session.delete(coupon)
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.coupon.delete",
        target_kind="coupon",
        target_id=str(coupon_id),
    )
    await session.commit()
