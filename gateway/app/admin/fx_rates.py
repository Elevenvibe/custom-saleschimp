"""Admin CRUD for FX rates.

Lets the super-admin set or override `base->quote` rates that drive
multi-currency wallet conversion. Auto-fetched rates from a public
data source could land in this same table with source='live'; the
manual override is the escape hatch for outages or special pricing.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.db import get_session
from app.fx import service as fx_service

router = APIRouter(prefix="/fx-rates", tags=["admin:fx"])


class FxRateIn(BaseModel):
    base_currency: str = Field(min_length=3, max_length=8)
    quote_currency: str = Field(min_length=3, max_length=8)
    # 1 base = (rate_micros / 1_000_000) quote.
    rate_micros: int = Field(gt=0)
    source: str = Field(default="manual", max_length=32)


class FxRateOut(BaseModel):
    id: int
    base_currency: str
    quote_currency: str
    rate_micros: int
    source: str
    fetched_at: str


def _actor_id(claims: dict) -> int | None:
    sub = claims.get("sub", "")
    if sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            return None
    return None


@router.get("", response_model=list[FxRateOut])
async def list_rates(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[FxRateOut]:
    return [FxRateOut(**r) for r in await fx_service.list_rates(session)]


@router.put("", response_model=FxRateOut)
async def upsert_rate(
    body: FxRateIn,
    request: Request,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> FxRateOut:
    row = await fx_service.upsert_rate(
        session,
        base=body.base_currency,
        quote=body.quote_currency,
        rate_micros=body.rate_micros,
        source=body.source,
    )
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.fx_rate.upsert",
        target_kind="fx_rate",
        target_id=f"{row.base_currency}->{row.quote_currency}",
        request=request,
        payload={"rate_micros": row.rate_micros, "source": row.source},
    )
    await session.commit()
    return FxRateOut(
        id=row.id,
        base_currency=row.base_currency,
        quote_currency=row.quote_currency,
        rate_micros=row.rate_micros,
        source=row.source,
        fetched_at=row.fetched_at.isoformat(),
    )


@router.delete("/{base}/{quote}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rate(
    base: str,
    quote: str,
    request: Request,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    removed = await fx_service.delete_rate(session, base=base, quote=quote)
    if not removed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such rate")
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.fx_rate.delete",
        target_kind="fx_rate",
        target_id=f"{base.upper()}->{quote.upper()}",
        request=request,
    )
    await session.commit()
