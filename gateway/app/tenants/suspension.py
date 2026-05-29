"""Suspension helpers: subject catalog, notice drafting, best-effort email.

The "AI-assisted" notice generation is TEMPLATE-BASED today — deterministic,
offline, no API key required. Each category has a professional notice
template; the admin's free-text note (if any) is woven in. This keeps the
feature working with zero external dependencies; swapping in a real LLM
later only changes draft_suspension_notice() — the call sites don't move.
"""

from __future__ import annotations

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger()

# The dropdown the suspend dialog renders. Order matters (UI shows it as-is).
SUSPENSION_SUBJECTS: tuple[str, ...] = (
    "Payment Overdue",
    "Subscription Violation",
    "Abuse or Fraud",
    "Suspicious Activity",
    "Compliance Issue",
    "Excessive Resource Usage",
    "Manual Administrative Action",
    "Security Investigation",
    "Other",
)

# Per-category professional notice. {note} is replaced with the admin's
# free text when present, else dropped cleanly.
_TEMPLATES: dict[str, str] = {
    "Payment Overdue": (
        "Your organization has been temporarily suspended due to an overdue "
        "invoice associated with your subscription plan.{note} Please complete "
        "the outstanding payment or contact support to restore access."
    ),
    "Subscription Violation": (
        "Your organization has been suspended due to a violation of your "
        "subscription terms.{note} Please review your plan limits and reply to "
        "this ticket so we can help restore service."
    ),
    "Abuse or Fraud": (
        "Your organization has been suspended following the detection of "
        "activity that violates our acceptable-use policy.{note} If you believe "
        "this is in error, reply to this ticket and our team will review."
    ),
    "Suspicious Activity": (
        "Your organization has been temporarily suspended after we detected "
        "unusual activity on the account.{note} This is a protective measure. "
        "Reply here to verify your account and restore access."
    ),
    "Compliance Issue": (
        "Your organization has been suspended pending resolution of a "
        "compliance matter.{note} Please reply to this ticket with the "
        "requested information so we can proceed."
    ),
    "Excessive Resource Usage": (
        "Your organization has been suspended due to resource usage that "
        "exceeds the limits of your current plan.{note} Upgrade your plan or "
        "contact support to restore access."
    ),
    "Manual Administrative Action": (
        "Your organization has been suspended by an administrator.{note} "
        "Please reply to this ticket for details and next steps."
    ),
    "Security Investigation": (
        "Your organization has been temporarily suspended while we investigate "
        "a security concern.{note} Access will be restored once the review is "
        "complete. Reply here with any questions."
    ),
    "Other": (
        "Your organization has been temporarily suspended.{note} Please reply "
        "to this ticket and our support team will assist you."
    ),
}


def draft_suspension_notice(subject: str, reason: str | None) -> str:
    """Build a professional suspension notice for a category, weaving in the
    admin's optional note. Template-based (see module docstring)."""
    template = _TEMPLATES.get(subject, _TEMPLATES["Other"])
    note = (reason or "").strip()
    if note:
        # Lowercase-lead the woven clause unless it's a full sentence.
        woven = f" Reason provided: {note}" if not note.endswith(".") else f" {note}"
        return template.format(note=woven)
    return template.format(note="")


async def notify_best_effort(
    session: AsyncSession, *, to: list[str], subject: str, body: str, tenant_id: int | None
) -> None:
    """Send a plain notification email, swallowing every error. Suspension
    must succeed even when no email provider is configured (dev) or the
    send fails — the in-product ticket is the source of truth; email is a
    courtesy."""
    try:
        from app.email.service import get_provider
        from app.email.providers.base import OutgoingMail

        provider = await get_provider(session, tenant_id=tenant_id)
        html = "<p>" + body.replace("\n", "<br>") + "</p>"
        await provider.send(OutgoingMail(to=to, subject=subject, html=html, text=body))
    except Exception as e:  # noqa: BLE001 — best-effort by design
        log.info("suspension.notify_skipped", error=str(e), to=to)
