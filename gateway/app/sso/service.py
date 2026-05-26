"""SSO config service (P2.B.1 foundation).

This module is intentionally scoped to **config management** for now.
Two pieces:

  1. Admin CRUD — upsert / delete the per-tenant `tenant_sso_configs`
     row. Secrets are Fernet-encrypted via `app.email.crypto`.

  2. Slug-based lookups for the public login page — given a tenant
     slug, return the active SSO config so the front-end can show
     "Sign in with <IdP>" buttons.

The actual OIDC redirect-and-callback flow lives in `app/sso/oidc.py`
and is wired in P2.B.2 (next PR). That piece needs a decision about
Dograh user provisioning: SSO users today have no `dograh_user_id`,
which the rest of the customer auth chain pivots on (see
`_tenant_id_for` in `customer_auth/plans.py`). The P2.B.2 PR will
either (a) auto-provision a Dograh user via the existing
`DograhClient.signup()` on first SSO login, or (b) extend
`_tenant_id_for` to accept a `member_id` claim as fallback. Picking
between those needs a real review of the Dograh signup API surface,
so it's properly deferred.

What's testable today after P2.B.1:
  - Admin can list / create / update / delete a tenant's SSO config.
  - Customer Settings page shows whether SSO is configured + with which IdP.
  - /api/auth/sso/{slug}/info returns the config metadata (no
    secrets) so the customer login page can render the right button.
  - /api/auth/sso/{slug}/start returns 501 with a clear message —
    explicit "not yet implemented" beats a half-working redirect.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.email.crypto import encrypt_dict
from app.sso.models import TenantSsoConfig
from app.tenants.models import Tenant

log = structlog.get_logger()


class SsoError(Exception):
    """Surfaced as a 400 in routes. Internal callers should let it
    propagate."""


# ---------------------------------------------------------------------------
# Admin CRUD
# ---------------------------------------------------------------------------


async def upsert_config(
    session: AsyncSession,
    *,
    tenant_id: int,
    idp_kind: str,
    display_name: str,
    issuer: str,
    client_id: str,
    client_secret: str | None,
    discovery_url: str | None,
    metadata_xml: str | None,
    force_sso: bool,
    attribute_map: dict[str, Any] | None,
    active: bool,
    notes: str | None,
) -> TenantSsoConfig:
    if idp_kind not in {"oidc", "saml"}:
        raise SsoError(f"unsupported idp_kind {idp_kind!r}")
    row = (
        await session.execute(
            select(TenantSsoConfig).where(TenantSsoConfig.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if row is None:
        row = TenantSsoConfig(
            tenant_id=tenant_id,
            idp_kind=idp_kind,
            display_name=display_name,
            issuer=issuer,
            client_id=client_id,
            secrets_encrypted=encrypt_dict({"client_secret": client_secret})
            if client_secret
            else None,
            discovery_url=discovery_url,
            metadata_xml=metadata_xml,
            force_sso=force_sso,
            attribute_map=attribute_map or {"_default": "user"},
            active=active,
            notes=notes,
        )
        session.add(row)
    else:
        row.idp_kind = idp_kind
        row.display_name = display_name
        row.issuer = issuer
        row.client_id = client_id
        # Only overwrite the secret when a new one was passed —
        # empty/None means "keep what's there", matching the
        # /settings/payment-gateways pattern.
        if client_secret:
            row.secrets_encrypted = encrypt_dict({"client_secret": client_secret})
        row.discovery_url = discovery_url
        row.metadata_xml = metadata_xml
        row.force_sso = force_sso
        if attribute_map is not None:
            row.attribute_map = attribute_map
        row.active = active
        row.notes = notes
        row.updated_at = datetime.now(UTC)
    await session.flush()
    log.info("sso.upserted", tenant_id=tenant_id, idp_kind=idp_kind, force_sso=force_sso)
    return row


async def delete_config(session: AsyncSession, *, tenant_id: int) -> bool:
    row = (
        await session.execute(
            select(TenantSsoConfig).where(TenantSsoConfig.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if row is None:
        return False
    await session.delete(row)
    return True


async def get_config_for_tenant(
    session: AsyncSession, tenant_id: int
) -> TenantSsoConfig | None:
    return (
        await session.execute(
            select(TenantSsoConfig).where(
                TenantSsoConfig.tenant_id == tenant_id,
                TenantSsoConfig.active.is_(True),
            )
        )
    ).scalar_one_or_none()


async def get_config_by_slug(
    session: AsyncSession, slug: str
) -> tuple[Tenant, TenantSsoConfig] | None:
    row = (
        await session.execute(
            select(Tenant, TenantSsoConfig)
            .join(TenantSsoConfig, TenantSsoConfig.tenant_id == Tenant.id)
            .where(Tenant.slug == slug)
            .where(TenantSsoConfig.active.is_(True))
        )
    ).first()
    if row is None:
        return None
    return row[0], row[1]
