"""Aggregator: importing this module loads every SQLAlchemy model so they
register on Base.metadata. Required for alembic autogenerate.

Add new model modules here whenever a new domain is introduced.
"""

from app.audit.models import AuditLog
from app.auth.models import PlatformUser
from app.billing.models import CostProvider, CostProviderPrice, MarkupRule
from app.email.models import EmailProviderConfig
from app.packages.models import Package, PackagePlugin
from app.plugins.models import InstalledPlugin
from app.tenants.models import Invite, Tenant, TenantMember
from app.fx.models import FxRate
from app.payments.config_models import PaymentProviderConfig
from app.payments.models import PaymentIntent, PaymentMethod
from app.marketplace.models import PluginCatalogEntry, TenantPluginInstall
from app.sso.models import SsoState, TenantSsoConfig
from app.mailbox.mail_message import MailMessage
from app.mailbox.models import MailboxConfig
from app.tickets.models import SupportTicket, SupportTicketMessage
from app.wallet.models import (
    Coupon,
    CouponRedemption,
    UsageRecord,
    Wallet,
    WalletLedger,
)

__all__ = [
    "AuditLog",
    "PlatformUser",
    "EmailProviderConfig",
    "Tenant",
    "TenantMember",
    "Invite",
    "Package",
    "PackagePlugin",
    "InstalledPlugin",
    "CostProvider",
    "CostProviderPrice",
    "MarkupRule",
    "Wallet",
    "WalletLedger",
    "UsageRecord",
    "Coupon",
    "CouponRedemption",
    "PaymentMethod",
    "PaymentIntent",
    "PaymentProviderConfig",
    "FxRate",
    "TenantSsoConfig",
    "SsoState",
    "PluginCatalogEntry",
    "TenantPluginInstall",
]
