"""CRUD for email_provider_configs + test send.

Secrets are Fernet-encrypted before storage and NEVER returned via the API.
List/get responses only echo metadata (scope, provider type, from, active flag,
timestamps) — the actual keys live in config_encrypted and can only be read
back by build_provider() through Fernet.
"""

from typing import Annotated, Any, Literal

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.db import get_session
from app.email.crypto import encrypt_dict
from app.email.models import EmailProviderConfig
from app.email.providers.base import OutgoingMail
from app.email.service import _build  # internal reuse: build provider from cfg

log = structlog.get_logger()

router = APIRouter(prefix="/email-providers", tags=["admin:email-providers"])


# --- Schemas ---------------------------------------------------------------

ProviderName = Literal["resend", "ses", "postmark", "smtp"]
ScopeKind = Literal["platform", "tenant"]


class ResendConfig(BaseModel):
    api_key: str = Field(min_length=1)


class SESConfig(BaseModel):
    region: str = Field(min_length=1, max_length=32)
    access_key_id: str = Field(min_length=1)
    secret_access_key: str = Field(min_length=1)


class PostmarkConfig(BaseModel):
    server_token: str = Field(min_length=1)


class SMTPConfig(BaseModel):
    host: str = Field(min_length=1)
    port: int = Field(ge=1, le=65535, default=587)
    username: str | None = None
    password: str | None = None
    use_tls: bool = True


class EmailProviderIn(BaseModel):
    """Payload for create. Exactly one of the provider config blocks is honored,
    matched by the `provider` field."""

    scope_kind: ScopeKind = "platform"
    scope_id: int | None = None  # required when scope_kind=tenant
    provider: ProviderName
    from_email: EmailStr
    from_name: str | None = None
    is_active: bool = True

    resend: ResendConfig | None = None
    ses: SESConfig | None = None
    postmark: PostmarkConfig | None = None
    smtp: SMTPConfig | None = None


class EmailProviderPatch(BaseModel):
    from_email: EmailStr | None = None
    from_name: str | None = None
    is_active: bool | None = None
    resend: ResendConfig | None = None
    ses: SESConfig | None = None
    postmark: PostmarkConfig | None = None
    smtp: SMTPConfig | None = None


class EmailProviderOut(BaseModel):
    id: int
    scope_kind: str
    scope_id: int | None
    provider: str
    from_email: str
    from_name: str | None
    is_active: bool
    created_at: str
    updated_at: str


class TestSendIn(BaseModel):
    to: EmailStr
    subject: str = "SalesChimp test email"
    body: str = "This is a test email from your SalesChimp email provider config."


# --- Helpers ---------------------------------------------------------------

def _secrets_for(payload: EmailProviderIn | EmailProviderPatch) -> dict[str, Any] | None:
    if payload.resend:
        return payload.resend.model_dump()
    if payload.ses:
        return payload.ses.model_dump()
    if payload.postmark:
        return payload.postmark.model_dump()
    if payload.smtp:
        return payload.smtp.model_dump()
    return None


def _serialize(c: EmailProviderConfig) -> EmailProviderOut:
    return EmailProviderOut(
        id=c.id,
        scope_kind=c.scope_kind,
        scope_id=c.scope_id,
        provider=c.provider,
        from_email=c.from_email,
        from_name=c.from_name,
        is_active=c.is_active,
        created_at=c.created_at.isoformat(),
        updated_at=c.updated_at.isoformat(),
    )


def _actor_id(claims: dict) -> int | None:
    sub = claims.get("sub", "")
    if sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            return None
    return None


# --- Routes ----------------------------------------------------------------


@router.get("", response_model=list[EmailProviderOut])
async def list_email_providers(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[EmailProviderOut]:
    rows = (
        await session.execute(
            select(EmailProviderConfig).order_by(
                EmailProviderConfig.scope_kind, EmailProviderConfig.scope_id, EmailProviderConfig.id
            )
        )
    ).scalars().all()
    return [_serialize(c) for c in rows]


@router.post("", response_model=EmailProviderOut, status_code=status.HTTP_201_CREATED)
async def create_email_provider(
    body: EmailProviderIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> EmailProviderOut:
    if body.scope_kind == "tenant" and body.scope_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "scope_id required for tenant scope")
    if body.scope_kind == "platform" and body.scope_id is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "platform scope must not have scope_id")

    secrets = _secrets_for(body)
    if secrets is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"missing {body.provider} config block",
        )

    # Enforce one active config per scope by deactivating any existing active row.
    if body.is_active:
        await _deactivate_active(session, body.scope_kind, body.scope_id)

    row = EmailProviderConfig(
        scope_kind=body.scope_kind,
        scope_id=body.scope_id,
        provider=body.provider,
        config_encrypted=encrypt_dict(secrets),
        from_email=body.from_email.lower(),
        from_name=body.from_name,
        is_active=body.is_active,
    )
    session.add(row)
    await session.flush()
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.email_provider.create",
        target_kind="email_provider",
        target_id=str(row.id),
        payload={"scope": body.scope_kind, "provider": body.provider},
    )
    await session.commit()
    return _serialize(row)


@router.patch("/{provider_id}", response_model=EmailProviderOut)
async def update_email_provider(
    provider_id: int,
    body: EmailProviderPatch,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> EmailProviderOut:
    row = await session.get(EmailProviderConfig, provider_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "config not found")

    if body.from_email is not None:
        row.from_email = body.from_email.lower()
    if body.from_name is not None:
        row.from_name = body.from_name
    secrets = _secrets_for(body)
    if secrets is not None:
        row.config_encrypted = encrypt_dict(secrets)
    if body.is_active is not None:
        # If activating, deactivate other active rows in the same scope first.
        if body.is_active and not row.is_active:
            await _deactivate_active(session, row.scope_kind, row.scope_id, exclude_id=row.id)
        row.is_active = body.is_active

    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.email_provider.update",
        target_kind="email_provider",
        target_id=str(row.id),
        payload={
            "from_email_changed": body.from_email is not None,
            "secrets_changed": secrets is not None,
            "is_active": row.is_active,
        },
    )
    await session.commit()
    # onupdate=func.now() marks updated_at expired post-commit; refresh
    # before serializing so attribute access doesn't trigger sync IO.
    await session.refresh(row)
    return _serialize(row)


@router.delete("/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_email_provider(
    provider_id: int,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    row = await session.get(EmailProviderConfig, provider_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "config not found")
    await session.delete(row)
    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.email_provider.delete",
        target_kind="email_provider",
        target_id=str(provider_id),
    )
    await session.commit()


@router.post("/{provider_id}/test-send")
async def test_send(
    provider_id: int,
    body: TestSendIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, Any]:
    row = await session.get(EmailProviderConfig, provider_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "config not found")
    try:
        provider = _build(row)
        result = await provider.send(
            OutgoingMail(
                to=[body.to],
                subject=body.subject,
                html=f"<p>{body.body}</p>",
                text=body.body,
            )
        )
    except httpx.HTTPStatusError as e:
        log.warning("email_provider.test_send.http", provider=row.provider, status=e.response.status_code)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"{row.provider} rejected the test send: {e.response.text[:200]}",
        ) from None
    except Exception as e:
        log.warning("email_provider.test_send.failed", provider=row.provider, error=str(e))
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"test send failed: {e}",
        ) from None

    await record_audit(
        session,
        actor_kind="platform",
        actor_user_id=_actor_id(claims),
        action="admin.email_provider.test_send",
        target_kind="email_provider",
        target_id=str(provider_id),
        payload={"to": body.to, "message_id": result.message_id},
    )
    await session.commit()
    return {"ok": True, "provider": result.provider, "message_id": result.message_id}


async def _deactivate_active(
    session: AsyncSession,
    scope_kind: str,
    scope_id: int | None,
    *,
    exclude_id: int | None = None,
) -> None:
    stmt = (
        update(EmailProviderConfig)
        .where(EmailProviderConfig.scope_kind == scope_kind)
        .where(EmailProviderConfig.is_active.is_(True))
    )
    if scope_id is None:
        stmt = stmt.where(EmailProviderConfig.scope_id.is_(None))
    else:
        stmt = stmt.where(EmailProviderConfig.scope_id == scope_id)
    if exclude_id is not None:
        stmt = stmt.where(EmailProviderConfig.id != exclude_id)
    await session.execute(stmt.values(is_active=False))
