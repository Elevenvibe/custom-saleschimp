"""Aggregator: importing this module loads every SQLAlchemy model so they
register on Base.metadata. Required for alembic autogenerate.

Add new model modules here whenever a new domain is introduced.
"""

from app.audit.models import AuditLog
from app.auth.models import PlatformUser
from app.email.models import EmailProviderConfig
from app.packages.models import Package, PackagePlugin
from app.plugins.models import InstalledPlugin
from app.tenants.models import Invite, Tenant, TenantMember

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
]
