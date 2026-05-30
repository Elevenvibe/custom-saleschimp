"""Tenant settings — app prefs, currency, payment methods, tax, notifications.

Powers the redesigned tenant Organization Settings page (sidebar + per-area
config). The shapes here are the contracts the console consumes.

All endpoints under /api/tenant/settings (mounted in main.py).

  GET/PUT  /app                  date/time/timezone/currency/language/UI prefs
  GET/PUT  /currency             AI-agent transaction currency
  GET/PUT  /notifications        per-tenant channel matrix overriding platform
  GET      /payment-methods      list providers + their saved status
  PUT      /payment-methods/{p}  save (and encrypt) one provider's credentials
  GET/POST /tax-rates            list / create
  PATCH/DELETE /tax-rates/{id}   update / delete
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.customer_auth.deps import require_customer, require_org_admin
from app.customer_auth.plans import _tenant_id_for
from app.db import get_session
from app.email.crypto import decrypt_dict, encrypt_dict
from app.finance.models import TaxRate as PlatformTaxRate  # for shape reuse
from app.notifications.service import ROUTING_KEY, _resolved_channels, get_routing
from app.notifications.types import NOTIFICATION_TYPES
from app.tenants.models import Tenant
from app.tenants.tenant_settings_models import TenantPaymentMethod, TenantTaxRate

router = APIRouter(prefix="/settings", tags=["tenant:settings"])


# Providers we support. live/sandbox toggles, list of typed fields, and the
# label + whether a secret is masked. Each provider's saved config is stored
# encrypted as JSONB on tenant_payment_methods.
class _Field(BaseModel):
    key: str
    label: str
    secret: bool = False
    help: str | None = None


_PAYMENT_PROVIDERS: dict[str, dict[str, Any]] = {
    "stripe": {
        "label": "Stripe",
        "envs": ["sandbox", "live"],
        "fields": [
            _Field(key="public_key", label="Publishable key"),
            _Field(key="secret_key", label="Secret key", secret=True),
            _Field(key="webhook_url", label="Webhook URL"),
            _Field(key="merchant_email", label="Merchant email"),
        ],
        "setup": [
            "Create a Stripe account, then in Developers → API keys grab the publishable + secret keys for the selected environment.",
            "Add a webhook endpoint pointing to the Webhook URL above and copy its signing secret if you store it elsewhere.",
        ],
    },
    "paystack": {
        "label": "Paystack",
        "envs": ["sandbox", "live"],
        "fields": [
            _Field(key="public_key", label="Public key"),
            _Field(key="secret_key", label="Secret key", secret=True),
            _Field(key="webhook_url", label="Webhook URL"),
            _Field(key="merchant_email", label="Merchant email"),
        ],
        "setup": [
            "In your Paystack dashboard → Settings → API Keys & Webhooks copy the public + secret keys.",
            "Register a webhook pointing at the URL above.",
        ],
    },
    "paypal": {
        "label": "PayPal",
        "envs": ["sandbox", "live"],
        "fields": [
            _Field(key="client_id", label="Client ID"),
            _Field(key="secret", label="Client secret", secret=True),
            _Field(key="webhook_url", label="Webhook URL"),
        ],
        "setup": [
            "In the PayPal Developer dashboard create an app and copy its Client ID and secret.",
            "Add a webhook on the app pointing at the URL above and select the events you care about.",
        ],
    },
    "razorpay": {
        "label": "Razorpay",
        "envs": ["sandbox", "live"],
        "fields": [
            _Field(key="client_id", label="Key ID"),
            _Field(key="secret", label="Key secret", secret=True),
            _Field(key="webhook_signing_secret", label="Webhook signing secret", secret=True),
            _Field(key="webhook_url", label="Webhook URL"),
        ],
        "setup": [
            "Dashboard → Settings → API Keys: generate a key id + secret.",
            "Webhooks → Add: use the URL above and copy the signing secret here.",
        ],
    },
    "mollie": {
        "label": "Mollie",
        "envs": ["live"],
        "fields": [
            _Field(key="api_key", label="API key (mobile key)", secret=True),
        ],
        "setup": [
            "Developers → API keys in your Mollie dashboard. Test and live keys are managed separately.",
        ],
    },
    "payfast": {
        "label": "Payfast",
        "envs": ["sandbox", "live"],
        "fields": [
            _Field(key="merchant_id", label="Merchant ID"),
            _Field(key="merchant_key", label="Merchant key", secret=True),
            _Field(key="passphrase", label="Passphrase", secret=True),
        ],
        "setup": [
            "Payfast Settings → Integration: copy the merchant id, merchant key and optional passphrase.",
        ],
    },
    "flutterwave": {
        "label": "Flutterwave",
        "envs": ["sandbox", "live"],
        "fields": [
            _Field(key="public_key", label="Public key"),
            _Field(key="secret_key", label="Secret key", secret=True),
            _Field(key="secret_hash", label="Secret hash", secret=True),
            _Field(key="webhook_secret_hash", label="Webhook secret hash", secret=True),
            _Field(key="webhook_url", label="Webhook URL"),
        ],
        "setup": [
            "Settings → API: copy the public + secret keys.",
            "Webhooks: add the URL above, then copy the webhook secret hash here.",
        ],
    },
    "authorize_net": {
        "label": "Authorize.Net",
        "envs": ["sandbox", "live"],
        "fields": [
            _Field(key="api_login_id", label="API Login ID"),
            _Field(key="transaction_key", label="Transaction key", secret=True),
        ],
        "setup": [
            "Sign in to the Merchant Interface → Account → Security Settings → API Credentials & Keys.",
            "Generate a new Transaction Key and copy both the API Login ID and the key above.",
        ],
    },
    "square": {
        "label": "Square",
        "envs": ["sandbox", "live"],
        "fields": [
            _Field(key="application_id", label="Application ID"),
            _Field(key="access_token", label="Access token", secret=True),
            _Field(key="location_id", label="Location ID"),
            _Field(key="webhook_url", label="Webhook URL"),
        ],
        "setup": [
            "Square Developer dashboard → choose an application, then OAuth or Credentials for the Application ID + access token.",
            "Locations → copy the Location ID for the store you want to bill against.",
        ],
    },
    "moniepoint": {
        "label": "Moniepoint",
        "envs": ["live"],
        "fields": [],
        "setup": [],
        "coming_soon": True,
        "region": "Nigeria",
    },
    "offline": {
        "label": "Offline payment",
        "envs": ["live"],
        "fields": [
            _Field(key="method", label="Method (e.g. Bank transfer)"),
            _Field(key="description", label="Instructions to show to customers"),
        ],
        "setup": [
            "Use this to accept bank transfers, cheques, or any payment confirmed manually. The instructions are shown to customers at checkout.",
        ],
    },
}


# ---- app settings ---------------------------------------------------------


_APP_DEFAULTS: dict[str, Any] = {
    "date_format": "YYYY-MM-DD",
    "time_format": "24h",
    "default_timezone": "UTC",
    "default_currency": "USD",
    "language": "en",
    "datatable_rows": 25,
    "enable_employee_export": True,
}


def _settings_dict(t: Tenant) -> dict[str, Any]:
    return dict(t.tenant_settings or {})


def _save_settings(t: Tenant, value: dict[str, Any]) -> None:
    # Reassign so SQLAlchemy notices the change on JSONB.
    t.tenant_settings = value


class AppSettings(BaseModel):
    date_format: str = Field(default="YYYY-MM-DD", max_length=32)
    time_format: Literal["12h", "24h"] = "24h"
    default_timezone: str = Field(default="UTC", max_length=64)
    default_currency: str = Field(default="USD", max_length=8)
    language: str = Field(default="en", max_length=8)
    datatable_rows: int = Field(default=25, ge=5, le=200)
    enable_employee_export: bool = True


def _app_from_settings(d: dict[str, Any]) -> AppSettings:
    merged = {**_APP_DEFAULTS, **(d.get("app") or {})}
    return AppSettings(**merged)


@router.get("/app", response_model=AppSettings)
async def get_app_settings(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AppSettings:
    t = await session.get(Tenant, await _tenant_id_for(session, claims))
    return _app_from_settings(_settings_dict(t))


@router.put("/app", response_model=AppSettings)
async def put_app_settings(
    body: AppSettings,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AppSettings:
    tenant_id = await _tenant_id_for(session, claims)
    t = await session.get(Tenant, tenant_id)
    s = _settings_dict(t)
    s["app"] = body.model_dump()
    _save_settings(t, s)
    await record_audit(
        session, actor_kind="tenant", actor_user_id=None,
        action="tenant.settings.app", target_kind="tenant",
        target_id=str(tenant_id), payload=body.model_dump(),
    )
    await session.commit()
    return body


# ---- currency (AI agent transaction currency) -----------------------------


class CurrencyIn(BaseModel):
    currency: str = Field(min_length=3, max_length=8)
    apply_to_invoices: bool = True
    apply_to_leads: bool = True
    apply_to_clients: bool = True


class CurrencyOut(BaseModel):
    currency: str
    apply_to_invoices: bool
    apply_to_leads: bool
    apply_to_clients: bool


def _currency_from(d: dict[str, Any]) -> CurrencyOut:
    c = d.get("currency") or {}
    return CurrencyOut(
        currency=c.get("currency") or "USD",
        apply_to_invoices=bool(c.get("apply_to_invoices", True)),
        apply_to_leads=bool(c.get("apply_to_leads", True)),
        apply_to_clients=bool(c.get("apply_to_clients", True)),
    )


@router.get("/currency", response_model=CurrencyOut)
async def get_currency(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CurrencyOut:
    t = await session.get(Tenant, await _tenant_id_for(session, claims))
    return _currency_from(_settings_dict(t))


@router.put("/currency", response_model=CurrencyOut)
async def put_currency(
    body: CurrencyIn,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CurrencyOut:
    tenant_id = await _tenant_id_for(session, claims)
    t = await session.get(Tenant, tenant_id)
    s = _settings_dict(t)
    s["currency"] = body.model_dump()
    _save_settings(t, s)
    await record_audit(
        session, actor_kind="tenant", actor_user_id=None,
        action="tenant.settings.currency", target_kind="tenant",
        target_id=str(tenant_id), payload=body.model_dump(),
    )
    await session.commit()
    return _currency_from(s)


# ---- notification prefs (per-tenant overrides over the platform matrix) ----


class TypeRow(BaseModel):
    key: str
    label: str
    description: str
    audience: str
    channels: dict[str, bool]


class TenantNotifOut(BaseModel):
    send_to_me: bool
    types: list[TypeRow]


def _notif_from(d: dict[str, Any], routing: dict[str, Any]) -> TenantNotifOut:
    prefs = d.get("notifications") or {}
    type_overrides = prefs.get("types") or {}
    rows: list[TypeRow] = []
    for t in NOTIFICATION_TYPES:
        if t["audience"] != "tenant":
            continue
        platform_ch = _resolved_channels(routing, t["key"])
        ovr = type_overrides.get(t["key"]) or {}
        ch = {k: bool(ovr.get(k, platform_ch[k])) for k in ("bell", "email", "whatsapp")}
        rows.append(
            TypeRow(
                key=t["key"], label=t["label"], description=t["description"],
                audience=t["audience"], channels=ch,
            )
        )
    return TenantNotifOut(send_to_me=bool(prefs.get("send_to_me", True)), types=rows)


@router.get("/notifications", response_model=TenantNotifOut)
async def get_notif_prefs(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TenantNotifOut:
    t = await session.get(Tenant, await _tenant_id_for(session, claims))
    routing = await get_routing(session)
    return _notif_from(_settings_dict(t), routing)


class NotifPutIn(BaseModel):
    send_to_me: bool = True
    types: dict[str, dict[str, bool]] = {}


@router.put("/notifications", response_model=TenantNotifOut)
async def put_notif_prefs(
    body: NotifPutIn,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TenantNotifOut:
    tenant_id = await _tenant_id_for(session, claims)
    t = await session.get(Tenant, tenant_id)
    s = _settings_dict(t)
    s["notifications"] = body.model_dump()
    _save_settings(t, s)
    await record_audit(
        session, actor_kind="tenant", actor_user_id=None,
        action="tenant.settings.notifications", target_kind="tenant",
        target_id=str(tenant_id), payload={"types": list(body.types.keys())},
    )
    await session.commit()
    routing = await get_routing(session)
    return _notif_from(s, routing)


# ---- payment methods (BYOK) -----------------------------------------------


class ProviderFieldOut(BaseModel):
    key: str
    label: str
    secret: bool
    help: str | None = None


class ProviderMetaOut(BaseModel):
    provider: str
    label: str
    envs: list[str]
    fields: list[ProviderFieldOut]
    setup: list[str]
    coming_soon: bool = False
    region: str | None = None
    # Current saved environment for this tenant.
    saved_env: str | None = None
    enabled: bool = False
    has_secret: bool = False
    # Non-secret saved values (for the form to pre-fill).
    values: dict[str, str] = {}


async def _saved_method(session: AsyncSession, tenant_id: int, provider: str) -> TenantPaymentMethod | None:
    return (
        await session.execute(
            select(TenantPaymentMethod).where(
                TenantPaymentMethod.tenant_id == tenant_id,
                TenantPaymentMethod.provider == provider,
            )
        )
    ).scalar_one_or_none()


def _provider_snapshot(provider: str, saved: TenantPaymentMethod | None) -> ProviderMetaOut:
    meta = _PAYMENT_PROVIDERS[provider]
    fields = [
        ProviderFieldOut(key=f.key, label=f.label, secret=f.secret, help=f.help) for f in meta["fields"]
    ]
    out = ProviderMetaOut(
        provider=provider,
        label=meta["label"],
        envs=list(meta["envs"]),
        fields=fields,
        setup=list(meta.get("setup") or []),
        coming_soon=bool(meta.get("coming_soon")),
        region=meta.get("region"),
    )
    if saved is not None:
        out.saved_env = saved.environment
        out.enabled = saved.enabled
        cfg = dict(saved.config or {})
        out.has_secret = bool(cfg.get("_secret_enc"))
        # Surface non-secret values back to the form.
        secret_keys = {f.key for f in meta["fields"] if f.secret}
        out.values = {
            k: v for k, v in cfg.items()
            if not k.startswith("_") and k not in secret_keys and isinstance(v, (str, int, float, bool))
        }
    return out


@router.get("/payment-methods", response_model=list[ProviderMetaOut])
async def list_payment_methods(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[ProviderMetaOut]:
    tenant_id = await _tenant_id_for(session, claims)
    out: list[ProviderMetaOut] = []
    for key in _PAYMENT_PROVIDERS:
        saved = await _saved_method(session, tenant_id, key)
        out.append(_provider_snapshot(key, saved))
    return out


class PaymentMethodIn(BaseModel):
    environment: Literal["sandbox", "live"] = "live"
    enabled: bool = True
    # Plain field values; secrets among them get encrypted on save.
    values: dict[str, str] = {}


@router.put("/payment-methods/{provider}", response_model=ProviderMetaOut)
async def put_payment_method(
    provider: str,
    body: PaymentMethodIn,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProviderMetaOut:
    if provider not in _PAYMENT_PROVIDERS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"unknown provider '{provider}'")
    meta = _PAYMENT_PROVIDERS[provider]
    if meta.get("coming_soon"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "this provider is not yet available")
    if body.environment not in meta["envs"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"environment must be one of {meta['envs']}")

    tenant_id = await _tenant_id_for(session, claims)
    secret_keys = {f.key for f in meta["fields"] if f.secret}
    plain: dict[str, Any] = {}
    secrets_payload: dict[str, str] = {}
    for f in meta["fields"]:
        v = body.values.get(f.key)
        if v is None or v == "":
            continue
        if f.key in secret_keys:
            secrets_payload[f.key] = v
        else:
            plain[f.key] = v

    saved = await _saved_method(session, tenant_id, provider)
    if saved is None:
        saved = TenantPaymentMethod(
            tenant_id=tenant_id, provider=provider, environment=body.environment,
            enabled=body.enabled, config={},
        )
        session.add(saved)
        await session.flush()
    saved.environment = body.environment
    saved.enabled = body.enabled

    cfg = dict(saved.config or {})
    # Preserve previously-encrypted secrets unless new ones were provided.
    existing_secrets: dict[str, str] = {}
    if cfg.get("_secret_enc"):
        try:
            existing_secrets = decrypt_dict(cfg["_secret_enc"])
        except Exception:  # noqa: BLE001
            existing_secrets = {}
    existing_secrets.update(secrets_payload)
    new_cfg: dict[str, Any] = dict(plain)
    if existing_secrets:
        new_cfg["_secret_enc"] = encrypt_dict(existing_secrets)
    saved.config = new_cfg

    await record_audit(
        session, actor_kind="tenant", actor_user_id=None,
        action="tenant.settings.payment_method", target_kind="payment_provider",
        target_id=provider, payload={"environment": body.environment, "enabled": body.enabled},
    )
    await session.commit()
    return _provider_snapshot(provider, saved)


# ---- tax rates (per-tenant) -----------------------------------------------


class TaxRateOut(BaseModel):
    id: int
    name: str
    rate: float
    region: str | None
    inclusive: bool
    enabled: bool
    is_default: bool


def _tax_serialize(t: TenantTaxRate) -> TaxRateOut:
    return TaxRateOut(
        id=t.id, name=t.name, rate=float(t.rate), region=t.region,
        inclusive=t.inclusive, enabled=t.enabled, is_default=t.is_default,
    )


@router.get("/tax-rates", response_model=list[TaxRateOut])
async def list_tax_rates(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[TaxRateOut]:
    tenant_id = await _tenant_id_for(session, claims)
    rows = (
        await session.execute(
            select(TenantTaxRate)
            .where(TenantTaxRate.tenant_id == tenant_id)
            .order_by(TenantTaxRate.is_default.desc(), TenantTaxRate.name)
        )
    ).scalars().all()
    return [_tax_serialize(t) for t in rows]


class TaxRateIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    rate: float = Field(ge=0, le=100)
    region: str | None = Field(default=None, max_length=64)
    inclusive: bool = False
    enabled: bool = True
    is_default: bool = False


class TaxRatePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    rate: float | None = Field(default=None, ge=0, le=100)
    region: str | None = Field(default=None, max_length=64)
    inclusive: bool | None = None
    enabled: bool | None = None
    is_default: bool | None = None


async def _clear_other_tenant_defaults(session: AsyncSession, tenant_id: int, keep_id: int) -> None:
    from sqlalchemy import update

    await session.execute(
        update(TenantTaxRate)
        .where(
            TenantTaxRate.tenant_id == tenant_id,
            TenantTaxRate.is_default.is_(True),
            TenantTaxRate.id != keep_id,
        )
        .values(is_default=False)
    )


@router.post("/tax-rates", response_model=TaxRateOut, status_code=status.HTTP_201_CREATED)
async def create_tax_rate(
    body: TaxRateIn,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TaxRateOut:
    tenant_id = await _tenant_id_for(session, claims)
    t = TenantTaxRate(
        tenant_id=tenant_id, name=body.name.strip(), rate=body.rate,
        region=(body.region or "").strip() or None, inclusive=body.inclusive,
        enabled=body.enabled, is_default=body.is_default,
    )
    session.add(t)
    await session.flush()
    if body.is_default:
        await _clear_other_tenant_defaults(session, tenant_id, t.id)
    await session.commit()
    return _tax_serialize(t)


@router.patch("/tax-rates/{rate_id}", response_model=TaxRateOut)
async def update_tax_rate(
    rate_id: int,
    body: TaxRatePatch,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TaxRateOut:
    tenant_id = await _tenant_id_for(session, claims)
    t = await session.get(TenantTaxRate, rate_id)
    if t is None or t.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tax rate not found")
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        t.name = data["name"].strip()
    if "rate" in data and data["rate"] is not None:
        t.rate = data["rate"]
    if "region" in data:
        t.region = (data["region"] or "").strip() or None
    if "inclusive" in data and data["inclusive"] is not None:
        t.inclusive = data["inclusive"]
    if "enabled" in data and data["enabled"] is not None:
        t.enabled = data["enabled"]
    if "is_default" in data and data["is_default"] is not None:
        t.is_default = data["is_default"]
        if data["is_default"]:
            await _clear_other_tenant_defaults(session, tenant_id, t.id)
    await session.commit()
    return _tax_serialize(t)


@router.delete("/tax-rates/{rate_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tax_rate(
    rate_id: int,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    tenant_id = await _tenant_id_for(session, claims)
    t = await session.get(TenantTaxRate, rate_id)
    if t is None or t.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tax rate not found")
    await session.delete(t)
    await session.commit()


# ---- custom fields (tenant scope, values only) ---------------------------
#
# Mirrors /api/admin/custom-fields/values but locked to entity='tenant' and
# the caller's own tenant_id — tenants render + save the SAME admin-designed
# tenant fields against their own row, without seeing other tenants' values.

from app.custom_fields.models import CustomField, CustomFieldValue  # noqa: E402


class _CFOptionOut(BaseModel):
    value: str
    label: str


class CustomFieldDef(BaseModel):
    id: int
    key: str
    label: str
    field_type: str
    options: list[_CFOptionOut]
    required: bool
    help_text: str | None
    placeholder: str | None


class CustomFieldsOut(BaseModel):
    fields: list[CustomFieldDef]
    values: dict[int, str | None]


@router.get("/custom-fields", response_model=CustomFieldsOut)
async def get_custom_fields(
    claims: Annotated[dict, Depends(require_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CustomFieldsOut:
    tenant_id = await _tenant_id_for(session, claims)
    fields = (
        await session.execute(
            select(CustomField)
            .where(CustomField.entity == "tenant", CustomField.active.is_(True))
            .order_by(CustomField.sort_order, CustomField.id)
        )
    ).scalars().all()
    rows = (
        await session.execute(
            select(CustomFieldValue).where(
                CustomFieldValue.entity == "tenant",
                CustomFieldValue.entity_id == str(tenant_id),
            )
        )
    ).scalars().all()
    vals = {r.field_id: r.value for r in rows}
    return CustomFieldsOut(
        fields=[
            CustomFieldDef(
                id=f.id, key=f.key, label=f.label, field_type=f.field_type,
                options=[_CFOptionOut(**o) for o in (f.options or [])],
                required=f.required, help_text=f.help_text, placeholder=f.placeholder,
            )
            for f in fields
        ],
        values={f.id: vals.get(f.id) for f in fields},
    )


class CFValuesIn(BaseModel):
    values: dict[int, str | None]


@router.put("/custom-fields", response_model=CustomFieldsOut)
async def put_custom_fields(
    body: CFValuesIn,
    claims: Annotated[dict, Depends(require_org_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CustomFieldsOut:
    tenant_id = await _tenant_id_for(session, claims)
    fields = (
        await session.execute(
            select(CustomField).where(CustomField.entity == "tenant")
        )
    ).scalars().all()
    valid_ids = {f.id for f in fields}
    existing = {
        r.field_id: r
        for r in (
            await session.execute(
                select(CustomFieldValue).where(
                    CustomFieldValue.entity == "tenant",
                    CustomFieldValue.entity_id == str(tenant_id),
                )
            )
        ).scalars().all()
    }
    for field_id, raw in body.values.items():
        if field_id not in valid_ids:
            continue
        val = (raw if raw is not None else "") or None
        row = existing.get(field_id)
        if row is None:
            session.add(
                CustomFieldValue(
                    field_id=field_id, entity="tenant",
                    entity_id=str(tenant_id), value=val,
                )
            )
        else:
            row.value = val
    await session.commit()
    return await get_custom_fields(claims=claims, session=session)


# Avoid lint warning that PlatformTaxRate import isn't used at runtime; we
# keep it imported so the file is a single place to compare shapes.
_ = PlatformTaxRate
