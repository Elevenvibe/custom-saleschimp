"""Super-admin Finance settings — tax rates.

  GET    /api/admin/finance/tax-rates            list
  POST   /api/admin/finance/tax-rates            create
  PATCH  /api/admin/finance/tax-rates/{id}       update
  DELETE /api/admin/finance/tax-rates/{id}       delete

A named tax-rate catalog (VAT / GST / Sales Tax, …). At most one row is the
default; setting a new default clears the others.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.db import get_session
from app.finance.models import TaxRate

router = APIRouter(prefix="/finance", tags=["admin:finance"])


def _uid(claims: dict) -> int | None:
    sub = claims.get("sub", "")
    if isinstance(sub, str) and sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            return None
    return None


class TaxRateOut(BaseModel):
    id: int
    name: str
    rate: float
    region: str | None
    inclusive: bool
    enabled: bool
    is_default: bool


def _serialize(t: TaxRate) -> TaxRateOut:
    return TaxRateOut(
        id=t.id,
        name=t.name,
        rate=float(t.rate),
        region=t.region,
        inclusive=t.inclusive,
        enabled=t.enabled,
        is_default=t.is_default,
    )


class TaxRateIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    rate: float = Field(ge=0, le=100)
    region: str | None = Field(default=None, max_length=64)
    inclusive: bool = False
    enabled: bool = True
    is_default: bool = False


class TaxRatePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    rate: float | None = Field(default=None, ge=0, le=100)
    region: str | None = Field(default=None, max_length=64)
    inclusive: bool | None = None
    enabled: bool | None = None
    is_default: bool | None = None


async def _clear_other_defaults(session: AsyncSession, keep_id: int | None) -> None:
    stmt = update(TaxRate).values(is_default=False).where(TaxRate.is_default.is_(True))
    if keep_id is not None:
        stmt = stmt.where(TaxRate.id != keep_id)
    await session.execute(stmt)


@router.get("/tax-rates", response_model=list[TaxRateOut])
async def list_tax_rates(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[TaxRateOut]:
    rows = (
        await session.execute(select(TaxRate).order_by(TaxRate.is_default.desc(), TaxRate.name))
    ).scalars().all()
    return [_serialize(t) for t in rows]


@router.post("/tax-rates", response_model=TaxRateOut, status_code=status.HTTP_201_CREATED)
async def create_tax_rate(
    body: TaxRateIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TaxRateOut:
    t = TaxRate(
        name=body.name.strip(),
        rate=body.rate,
        region=(body.region or "").strip() or None,
        inclusive=body.inclusive,
        enabled=body.enabled,
        is_default=body.is_default,
    )
    session.add(t)
    await session.flush()
    if body.is_default:
        await _clear_other_defaults(session, keep_id=t.id)
    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.finance.tax_rate.create", target_kind="tax_rate",
        target_id=str(t.id), payload={"name": t.name, "rate": float(t.rate)},
    )
    await session.commit()
    return _serialize(t)


@router.patch("/tax-rates/{rate_id}", response_model=TaxRateOut)
async def update_tax_rate(
    rate_id: int,
    body: TaxRatePatch,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TaxRateOut:
    t = await session.get(TaxRate, rate_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tax rate not found")
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        t.name = data["name"].strip()
    if "rate" in data and data["rate"] is not None:
        t.rate = data["rate"]
    if "region" in data:
        t.region = (data["region"] or "").strip() or None
    if "inclusive" in data and data["inclusive"] is not None:
        t.inclusive = data["inclusive"]
    if "enabled" in data and data["enabled"] is not None:
        t.enabled = data["enabled"]
    if "is_default" in data and data["is_default"] is not None:
        t.is_default = data["is_default"]
        if data["is_default"]:
            await _clear_other_defaults(session, keep_id=t.id)
    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.finance.tax_rate.update", target_kind="tax_rate",
        target_id=str(t.id), payload={"fields": list(data.keys())},
    )
    await session.commit()
    return _serialize(t)


@router.delete("/tax-rates/{rate_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tax_rate(
    rate_id: int,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    t = await session.get(TaxRate, rate_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tax rate not found")
    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.finance.tax_rate.delete", target_kind="tax_rate",
        target_id=str(t.id), payload={"name": t.name},
    )
    await session.delete(t)
    await session.commit()
