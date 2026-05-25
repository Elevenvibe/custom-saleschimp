"""Resolve the active email provider for a scope and render templates.

Per docs/saas-architecture.md §11.5:
    enabled(tenant) = tenant-scoped provider if active, else platform default.

If neither is configured AND `settings.environment` is not production, fall
back to the ConsoleProvider so signup/verify flows work out-of-the-box during
local development.
"""

from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.email.crypto import decrypt_dict
from app.email.models import EmailProviderConfig
from app.email.providers.base import MailProvider, OutgoingMail
from app.email.providers.console import ConsoleProvider
from app.email.providers.postmark import PostmarkProvider
from app.email.providers.resend import ResendProvider
from app.email.providers.ses import SESProvider
from app.email.providers.smtp import SMTPProvider


class NoEmailProviderConfigured(Exception):
    pass


_TEMPLATES_DIR = Path(__file__).parent / "templates"
_jinja = Environment(
    loader=FileSystemLoader(_TEMPLATES_DIR),
    autoescape=select_autoescape(["html", "xml"]),
    enable_async=True,
)


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
    # Dev fallback: ConsoleProvider when ENVIRONMENT != 'production'.
    if settings.environment.lower() != "production":
        return ConsoleProvider(from_email="noreply@local", from_name="SalesChimp (dev)")
    raise NoEmailProviderConfigured(
        "No active email provider configured for platform"
        + (f" or tenant {tenant_id}" if tenant_id else "")
    )


async def render_template(name: str, context: dict[str, Any]) -> tuple[str, str]:
    """Render `<name>.html` and `<name>.txt` from templates/ with `context`.

    Returns (html, text). Both are required so every email has a text fallback.
    """
    html_tmpl = _jinja.get_template(f"{name}.html")
    text_tmpl = _jinja.get_template(f"{name}.txt")
    html = await html_tmpl.render_async(**context)
    text = await text_tmpl.render_async(**context)
    return html, text


async def send_template(
    session: AsyncSession,
    *,
    to: list[str],
    subject: str,
    template: str,
    context: dict[str, Any],
    tenant_id: int | None = None,
) -> None:
    """Render a template and send via the resolved provider for this scope."""
    html, text = await render_template(template, context)
    provider = await get_provider(session, tenant_id=tenant_id)
    await provider.send(
        OutgoingMail(to=to, subject=subject, html=html, text=text)
    )
