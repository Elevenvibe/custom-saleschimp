"""Admin: per-tenant SSO configuration CRUD.

The page mirrors /settings/payment-gateways — secret strings are
write-only (paste-only, never round-tripped). Status reads expose
non-secret fields only.

Routes are mounted under /api/admin and bound to require_super_admin
so platform staff can configure SSO on behalf of a tenant. A future
iteration may expose a tenant-side flavor of this to org_admins
under /api/tenant, but for V1 admin-assisted is the recommendation
per OQ-B2-1 in docs/p2b-scope.md.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.db import get_session
from app.sso import service as sso_service
from app.sso.models import TenantSsoConfig

router = APIRouter(prefix="/tenants/{tenant_id}/sso", tags=["admin:sso"])


IdpKind = Literal["oidc", "saml"]


class SsoConfigIn(BaseModel):
    idp_kind: IdpKind
    display_name: str = Field(min_length=1, max_length=128)
    issuer: str = Field(min_length=1, max_length=512)
    client_id: str = Field(min_length=1, max_length=256)
    # Paste-only — empty means "leave existing secret untouched" so an
    # admin can flip `force_sso` without re-pasting the client secret.
    client_secret: str = Field(default="", max_length=2048)
    discovery_url: str | None = Field(default=None, max_length=512)
    metadata_xml: str | None = Field(default=None)
    force_sso: bool = False
    attribute_map: dict[str, str] | None = None
    active: bool = True
    notes: str | None = Field(default=None, max_length=2048)


class SsoConfigOut(BaseModel):
    id: int
    tenant_id: int
    idp_kind: str
    display_name: str
    issuer: str
    client_id: str
    has_client_secret: bool
    discovery_url: str | None
    has_metadata_xml: bool
    force_sso: bool
    attribute_map: dict[str, str]
    active: bool
    notes: str | None
    created_at: str
    updated_at: str


def _serialize(row: TenantSsoConfig) -> SsoConfigOut:
    return SsoConfigOut(
        id=row.id,
        tenant_id=row.tenant_id,
        idp_kind=row.idp_kind,
        display_name=row.display_name,
        issuer=row.issuer,
        client_id=row.client_id,
        has_client_secret=row.secrets_encrypted is not None,
        discovery_url=row.discovery_url,
        has_metadata_xml=bool(row.metadata_xml),
        force_sso=row.force_sso,
        attribute_map={str(k): str(v) for k, v in (row.attribute_map or {}).items()},
        active=row.active,
        notes=row.notes,
        created_at=row.created_at.isoformat(),
        updated_at=row.updated_at.isoformat(),
    )


def _actor_id(claims: dict) -> int | None:
    sub = claims.get("sub", "")
    if sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            return None
    return None


@router.get("", response_model=SsoConfigOut | None)
async def get_sso(
    tenant_id: int,
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SsoConfigOut | None:
    row = await sso_service.get_config_for_tenant(session, tenant_id)
    if row is None:
        return None
    return _serialize(row)


@router.put("", response_model=SsoConfigOut)
async def upsert_sso(
    tenant_id: int,
    body: SsoConfigIn,
    request: Request,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SsoConfigOut:
    if body.idp_kind == "oidc" and not body.discovery_url:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "OIDC config requires discovery_url",
        )
    if body.idp_kind == "saml" and not body.metadata_xml:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "SAML config requires metadata_xml",
        )
    try:
        row = await sso_service.upsert_config(
            session,
            tenant_id=tenant_id,
            idp_kind=body.idp_kind,
            display_name=body.display_name,
            issuer=body.issuer,
            client_id=body.client_id,
            client_secret=body.client_secret.strip() or None,
            discovery_url=body.discovery_url,
            metadata_xml=body.metadata_xml,
            force_sso=body.force_sso,
            attribute_map=body.attribute_map,
            active=body.active,
            notes=body.notes,
        )
    except sso_service.SsoError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.sso.upsert",
        target_kind="tenant",
        target_id=str(tenant_id),
        request=request,
        payload={
            "idp_kind": body.idp_kind,
            "display_name": body.display_name,
            "force_sso": body.force_sso,
            "active": body.active,
        },
    )
    await session.commit()
    return _serialize(row)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sso(
    tenant_id: int,
    request: Request,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    removed = await sso_service.delete_config(session, tenant_id=tenant_id)
    if not removed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no SSO config for this tenant")
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.sso.delete",
        target_kind="tenant",
        target_id=str(tenant_id),
        request=request,
    )
    await session.commit()
