"""Notification type registry.

The single source of truth for every notification the platform can emit.
Each type declares:
  - key:         stable id used in routing settings + emit calls.
  - label:       human label shown in Settings → Notifications.
  - description: one-liner for the settings table.
  - audience:    'platform' (super-admins) or 'tenant' (org users).
  - default_channels: which channels are ON before an admin customizes.

Routing settings (platform_settings['notifications']) store per-type channel
overrides + the two master audience toggles; the registry supplies defaults
and the catalog the settings UI renders.
"""

from __future__ import annotations

from typing import Literal, TypedDict

Audience = Literal["platform", "tenant"]
Channel = Literal["bell", "email", "whatsapp"]

CHANNELS: tuple[Channel, ...] = ("bell", "email", "whatsapp")


class NotificationType(TypedDict):
    key: str
    label: str
    description: str
    audience: Audience
    default_channels: dict[str, bool]


def _ch(bell: bool = True, email: bool = False, whatsapp: bool = False) -> dict[str, bool]:
    return {"bell": bell, "email": email, "whatsapp": whatsapp}


# Order matters — it's the order rows appear in the settings table.
NOTIFICATION_TYPES: list[NotificationType] = [
    {
        "key": "ticket_new",
        "label": "New support ticket",
        "description": "A tenant opened a new support ticket.",
        "audience": "platform",
        "default_channels": _ch(bell=True, email=True),
    },
    {
        "key": "ticket_reply",
        "label": "Ticket reply (from tenant)",
        "description": "A tenant replied to one of their tickets.",
        "audience": "platform",
        "default_channels": _ch(bell=True, email=False),
    },
    {
        "key": "tenant_signup",
        "label": "New tenant signup",
        "description": "A new organization signed up.",
        "audience": "platform",
        "default_channels": _ch(bell=True, email=True),
    },
    {
        "key": "ticket_response",
        "label": "Support replied to your ticket",
        "description": "The platform team replied to your support ticket.",
        "audience": "tenant",
        "default_channels": _ch(bell=True, email=True),
    },
    {
        "key": "tenant_suspended",
        "label": "Account suspended",
        "description": "Your organization's account was suspended.",
        "audience": "tenant",
        "default_channels": _ch(bell=True, email=True, whatsapp=False),
    },
    {
        "key": "tenant_reactivated",
        "label": "Account reactivated",
        "description": "Your organization's account was reactivated.",
        "audience": "tenant",
        "default_channels": _ch(bell=True, email=True),
    },
    {
        "key": "wallet_low_balance",
        "label": "Low wallet balance",
        "description": "Your wallet balance dropped below the alert threshold.",
        "audience": "tenant",
        "default_channels": _ch(bell=True, email=True),
    },
    {
        "key": "payment_succeeded",
        "label": "Payment received",
        "description": "A wallet top-up or payment succeeded.",
        "audience": "tenant",
        "default_channels": _ch(bell=True, email=False),
    },
]

_BY_KEY: dict[str, NotificationType] = {t["key"]: t for t in NOTIFICATION_TYPES}


def get_type(key: str) -> NotificationType | None:
    return _BY_KEY.get(key)


def default_channels(key: str) -> dict[str, bool]:
    t = _BY_KEY.get(key)
    return dict(t["default_channels"]) if t else _ch(bell=True)
