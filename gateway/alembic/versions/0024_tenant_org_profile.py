"""tenant org profile fields

Adds editable organization-profile columns to `tenants` so both the
super-admin tenant dashboard (Profile tab) and the tenant-side
Organization Settings page can capture richer company details beyond the
name/branding we already store.

These are org-level (company) fields — distinct from the per-user profile
columns added to platform_users in 0022. company_size / phone captured at
signup live in signup_metadata; these promote them to first-class,
editable columns.

Revision ID: 0024_tenant_org_profile
Revises: 0023_security_2fa_settings
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0024_tenant_org_profile"
down_revision: Union[str, None] = "0023_security_2fa_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMNS = [
    ("company_phone", sa.String(length=32)),
    ("website", sa.String(length=255)),
    ("industry", sa.String(length=64)),
    ("company_size", sa.String(length=32)),
    ("country", sa.String(length=64)),
    ("address", sa.String(length=255)),
    ("city", sa.String(length=120)),
    ("state", sa.String(length=120)),
    ("zip_code", sa.String(length=20)),
    ("about", sa.Text()),
]


def upgrade() -> None:
    for name, type_ in _COLUMNS:
        op.add_column("tenants", sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    for name, _ in reversed(_COLUMNS):
        op.drop_column("tenants", name)
