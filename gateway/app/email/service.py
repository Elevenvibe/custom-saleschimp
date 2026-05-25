"""Resolve the active email provider for a scope (platform default or tenant override).

Per docs/saas-architecture.md §11.5:
    enabled(tenant) = tenant-scoped provider if active, else platform default.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.email.crypto import decrypt_dict
from app.email.models import EmailProviderConfig
from app.email.providers.base import MailProvider
from app.email.providers.postmark import PostmarkProvider
from app.email.providers.resend import ResendProvider
from app.email.providers.ses import SESProvider
from app.email.providers.smtp import SMTPProvider


class NoEmailProviderConfigured(Exception):
    pass


async def _find_active(
    session: AsyncSession, scope_kind: str, scope_id: int | None
) -> EmailProviderConfig | None:
    stmt = (
        select(EmailProviderConfig)
        .where(EmailProviderConfig.scope_kind == scope_kind)
        .where(EmailProviderConfig.is_active.is_(True))
    )
    if scope_id is None:
        stmt = stmt.where(EmailProviderConfig.scope_id.is_(None))
    else:
        stmt = stmt.where(EmailProviderConfig.scope_id == scope_id)
    return (await session.execute(stmt)).scalar_one_or_none()


def _build(cfg: EmailProviderConfig) -> MailProvider:
    secrets = decrypt_dict(cfg.config_encrypted)
    common = {"from_email": cfg.from_email, "from_name": cfg.from_name}
    if cfg.provider == "resend":
        return ResendProvider(api_key=secrets["api_key"], **common)
    if cfg.provider == "ses":
        return SESProvider(
            region=secrets["region"],
            access_key_id=secrets["access_key_id"],
            secret_access_key=secrets["secret_access_key"],
            **common,
        )
    if cfg.provider == "postmark":
        return PostmarkProvider(server_token=secrets["server_token"], **common)
    if cfg.provider == "smtp":
        return SMTPProvider(
            host=secrets["host"],
            port=int(secrets.get("port", 587)),
            username=secrets.get("username"),
            password=secrets.get("password"),
            use_tls=bool(secrets.get("use_tls", True)),
            **common,
        )
    raise ValueError(f"unknown email provider: {cfg.provider}")


async def get_provider(
    session: AsyncSession, *, tenant_id: int | None = None
) -> MailProvider:
    if tenant_id is not None:
        cfg = await _find_active(session, "tenant", tenant_id)
        if cfg:
            return _build(cfg)
    cfg = await _find_active(session, "platform", None)
    if cfg:
        return _build(cfg)
    raise NoEmailProviderConfigured(
        "No active email provider configured for platform"
        + (f" or tenant {tenant_id}" if tenant_id else "")
    )
