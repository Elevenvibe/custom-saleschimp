"""WalletService — the only path that's allowed to move money.

The whole module exists so we have *one* place that:
  - enforces the no-negative-balance rule (CHECK constraint at the DB
    layer is the belt; this is the suspenders),
  - writes a wallet_ledger row in the same transaction as the balance
    update, so the journal can never drift from the running total,
  - records balance_after_micros on the ledger row, so the customer
    /wallet/ledger view never needs a running window function.

Routes call these helpers; nothing else writes to `wallets` or
`wallet_ledger` directly.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.wallet.models import Wallet, WalletLedger

log = structlog.get_logger()


class InsufficientFunds(Exception):
    """Raised when a charge would push the balance below
    `-credit_limit_micros`. The caller decides whether to surface this
    as a 402 Payment Required, a quiet skip, or an auto-reload trigger.
    """

    def __init__(self, tenant_id: int, balance_micros: int, charge_micros: int) -> None:
        super().__init__(
            f"tenant {tenant_id} has {balance_micros} micros, cannot charge {charge_micros}"
        )
        self.tenant_id = tenant_id
        self.balance_micros = balance_micros
        self.charge_micros = charge_micros


@dataclass(slots=True)
class LedgerEntry:
    id: int
    delta_micros: int
    balance_after_micros: int


async def get_or_create_wallet(
    session: AsyncSession, tenant_id: int, currency: str = "USD"
) -> Wallet:
    """Idempotent wallet lookup for (tenant, currency). Auto-provisions
    a 0-balance row on first touch so onboarding doesn't have to know
    about wallets at all. Default currency is USD — multi-currency
    callers pass currency explicitly."""
    currency = currency.upper()
    wallet = await session.get(Wallet, (tenant_id, currency))
    if wallet is not None:
        return wallet
    wallet = Wallet(tenant_id=tenant_id, balance_micros=0, currency=currency)
    session.add(wallet)
    await session.flush()
    return wallet


async def list_wallets(session: AsyncSession, tenant_id: int) -> list[Wallet]:
    """Every currency the tenant holds. Empty list if onboarding hasn't
    auto-provisioned anything yet."""
    rows = (
        await session.execute(
            select(Wallet).where(Wallet.tenant_id == tenant_id).order_by(Wallet.currency)
        )
    ).scalars().all()
    return list(rows)


async def _post(
    session: AsyncSession,
    wallet: Wallet,
    delta_micros: int,
    reason: str,
    *,
    ref_kind: str | None = None,
    ref_id: str | None = None,
    actor_kind: str = "system",
    actor_user_id: int | None = None,
    notes: str | None = None,
) -> LedgerEntry:
    """Apply a signed delta + write the matching ledger row in one tx.

    Negative `delta_micros` is a charge; positive is a credit. The
    DB-level CHECK on `wallets.balance_micros >= -credit_limit_micros`
    is the final enforcement, but we also pre-check so we can raise a
    typed exception (and a more useful error message) instead of
    bubbling up an IntegrityError.
    """
    new_balance = wallet.balance_micros + delta_micros
    if new_balance < -wallet.credit_limit_micros:
        raise InsufficientFunds(wallet.tenant_id, wallet.balance_micros, abs(delta_micros))

    wallet.balance_micros = new_balance
    entry = WalletLedger(
        tenant_id=wallet.tenant_id,
        delta_micros=delta_micros,
        balance_after_micros=new_balance,
        currency=wallet.currency,
        reason=reason,
        ref_kind=ref_kind,
        ref_id=ref_id,
        actor_kind=actor_kind,
        actor_user_id=actor_user_id,
        notes=notes,
    )
    session.add(entry)
    await session.flush()
    log.info(
        "wallet.posted",
        tenant_id=wallet.tenant_id,
        reason=reason,
        delta_micros=delta_micros,
        balance_after_micros=new_balance,
        ref=(ref_kind, ref_id),
    )
    return LedgerEntry(
        id=entry.id, delta_micros=delta_micros, balance_after_micros=new_balance
    )


async def charge(
    session: AsyncSession,
    tenant_id: int,
    micros: int,
    *,
    currency: str = "USD",
    reason: str = "charge",
    ref_kind: str | None = None,
    ref_id: str | None = None,
    actor_kind: str = "system",
    actor_user_id: int | None = None,
    notes: str | None = None,
) -> LedgerEntry:
    """Debit `micros` from the (tenant, currency) wallet. `micros` must
    be positive — pass the magnitude, not the signed value, so callers
    don't accidentally credit when they meant to charge."""
    if micros <= 0:
        raise ValueError("charge micros must be positive")
    wallet = await get_or_create_wallet(session, tenant_id, currency)
    return await _post(
        session,
        wallet,
        -micros,
        reason,
        ref_kind=ref_kind,
        ref_id=ref_id,
        actor_kind=actor_kind,
        actor_user_id=actor_user_id,
        notes=notes,
    )


async def credit(
    session: AsyncSession,
    tenant_id: int,
    micros: int,
    *,
    currency: str = "USD",
    reason: str = "topup",
    ref_kind: str | None = None,
    ref_id: str | None = None,
    actor_kind: str = "system",
    actor_user_id: int | None = None,
    notes: str | None = None,
) -> LedgerEntry:
    """Credit `micros` to the (tenant, currency) wallet."""
    if micros <= 0:
        raise ValueError("credit micros must be positive")
    wallet = await get_or_create_wallet(session, tenant_id, currency)
    return await _post(
        session,
        wallet,
        micros,
        reason,
        ref_kind=ref_kind,
        ref_id=ref_id,
        actor_kind=actor_kind,
        actor_user_id=actor_user_id,
        notes=notes,
    )


async def adjust(
    session: AsyncSession,
    tenant_id: int,
    delta_micros: int,
    *,
    currency: str = "USD",
    actor_user_id: int | None,
    notes: str,
) -> LedgerEntry:
    """Manual admin adjustment. Signed `delta_micros` (positive credits,
    negative debits). Always tagged actor_kind='platform' + writes the
    audit story via `notes`. This is the *only* helper that accepts a
    signed delta — the rest force positive magnitudes so the caller's
    intent is unambiguous."""
    if delta_micros == 0:
        raise ValueError("adjustment delta cannot be zero")
    wallet = await get_or_create_wallet(session, tenant_id, currency)
    return await _post(
        session,
        wallet,
        delta_micros,
        "adjustment",
        actor_kind="platform",
        actor_user_id=actor_user_id,
        notes=notes,
    )


async def recent_ledger(
    session: AsyncSession,
    tenant_id: int,
    *,
    currency: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Read-only helper for the customer /wallet view. When `currency`
    is None the ledger is returned for every currency the tenant holds
    so the UI can render a single unified history."""
    q = select(WalletLedger).where(WalletLedger.tenant_id == tenant_id)
    if currency is not None:
        q = q.where(WalletLedger.currency == currency.upper())
    rows = (
        await session.execute(q.order_by(WalletLedger.id.desc()).limit(limit))
    ).scalars().all()
    return [
        {
            "id": r.id,
            "delta_micros": r.delta_micros,
            "balance_after_micros": r.balance_after_micros,
            "currency": r.currency,
            "reason": r.reason,
            "ref_kind": r.ref_kind,
            "ref_id": r.ref_id,
            "notes": r.notes,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]
