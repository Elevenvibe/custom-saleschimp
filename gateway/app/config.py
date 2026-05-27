from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GATEWAY_", case_sensitive=False)

    # Core
    environment: str = "local"
    log_level: str = "INFO"

    # Control DB (Postgres). Defaults to the shared postgres service / database 'control'.
    database_url: str = "postgresql+asyncpg://postgres:postgres@postgres:5432/control"

    # Dograh's DB on the same postgres instance — used for the small set of
    # writes the gateway needs to make against it (invite acceptance: add the
    # user to an existing org instead of letting Dograh auto-create one).
    dograh_database_url: str = "postgresql+asyncpg://postgres:postgres@postgres:5432/postgres"

    # JWT — must equal Dograh's OSS_JWT_SECRET for tokens we mint to be accepted by Dograh.
    jwt_secret: str = "ChangeMeInProduction"
    jwt_algorithm: str = "HS256"
    jwt_expiry_hours: int = 24

    # Encryption key for secrets stored in the Control DB (Fernet-compatible base64 32-byte key).
    # Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    secrets_key: str = ""

    # Where upstream services live (used by the reverse proxy).
    dograh_ui_url: str = "http://ui:3010"
    dograh_api_url: str = "http://api:8000"

    # Bind config.
    host: str = "0.0.0.0"
    port: int = 8080

    # Bootstrap: on startup, if no super-admin exists AND both are set, create one.
    # Intended for first-boot only; rotate the password from the admin UI after.
    bootstrap_super_admin_email: str | None = None
    bootstrap_super_admin_password: str | None = None

    # Bootstrap a demo customer tenant on startup if it doesn't already exist.
    # All four fields must be set; otherwise the bootstrap is skipped. Useful
    # for local dev so the customer app at :3030 has a working login out of
    # the box. Intended for non-production environments.
    bootstrap_demo_tenant_email: str | None = None
    bootstrap_demo_tenant_password: str | None = None
    bootstrap_demo_tenant_full_name: str | None = None
    bootstrap_demo_tenant_company_name: str | None = None

    # Reverse proxy timeouts (seconds).
    proxy_connect_timeout: float = 5.0
    proxy_read_timeout: float = 60.0

    # Background price sync. Iterates active cost providers on an interval and
    # upserts catalog reference prices for any (variant, unit) without a row.
    # Opt-in — leave false on environments where the catalog drift doesn't
    # matter or you don't want background DB writes.
    price_sync_enabled: bool = False
    price_sync_interval_seconds: int = 60

    # Background usage ingest from Dograh's /api/v1/organizations/usage
    # surface. Per tenant we walk forward an id cursor and insert one
    # usage_record + wallet charge per workflow_run. Opt-in until the
    # Dograh URL + service token are set in the deploy.
    usage_ingest_enabled: bool = False
    usage_ingest_interval_seconds: int = 120
    usage_ingest_page_size: int = 100

    # Payment provider secrets. Stripe is the default; both adapters
    # short-circuit to a clear "not configured" error when their key
    # is unset, so a deploy with only Stripe wired in still works for
    # the customer who only configures Stripe.
    stripe_secret_key: str = ""
    stripe_publishable_key: str = ""
    stripe_webhook_secret: str = ""
    paystack_secret_key: str = ""
    paystack_public_key: str = ""

    # Auto-reload sweep — checks every tenant whose auto_reload_enabled
    # is true and whose balance has dropped below the configured
    # threshold, then attempts a charge against the stored payment method.
    auto_reload_enabled: bool = False
    auto_reload_interval_seconds: int = 60

    # FX rate fetcher — pulls live rates into the fx_rates table from a
    # free public source on a schedule. Manual admin entries (source=
    # 'manual') always win over live (source='live'): the cron writes
    # 'live' rows and skips any pair where a 'manual' row exists.
    fx_fetcher_enabled: bool = False
    # exchangerate.host is the default — no API key required, USD base.
    # Override to https://open.er-api.com/v6/latest/USD or similar if
    # exchangerate.host goes down.
    fx_fetcher_url: str = "https://open.er-api.com/v6/latest/USD"
    fx_fetcher_base_currency: str = "USD"
    fx_fetcher_interval_seconds: int = 3600  # hourly is plenty
    # Restrict the set of pairs we persist. Empty list = persist every
    # currency the API returns; non-empty = only persist these.
    fx_fetcher_currencies: str = "NGN,EUR,GBP,KES,GHS,ZAR,INR"

    # CORS allowlist for browser apps that call the gateway from a different
    # origin. Listed in order of preference:
    #   - 8081: unified URL (nginx fronting Dograh + console)
    #   - 3040: bare console sidecar (dev convenience)
    #   - 3020: super-admin UI
    #   - 3030: legacy app-ui (kept while we deprecate it; remove once gone)
    cors_origins: str = (
        "http://localhost:8081,https://app.mysaleschimp.com,"
        "http://localhost:3040,"
        "http://localhost:3020,https://admin.mysaleschimp.com,"
        "http://localhost:3030"
    )

    # Public URL of the gateway (where the API + reverse proxy live).
    public_base_url: str = "http://localhost:8080"

    # Public URL of the customer-facing surface. Verification, invite, and
    # password-reset links emailed to customers point here. Now points at
    # the unified nginx-fronted URL with the /console basePath; the public
    # pages live under console/app/(public)/{verify,accept-invite,signup,login}.
    customer_app_url: str = "http://localhost:8081/console"

    # Where the post-verify / post-accept flow sends the user. The customer
    # app intercepts this and renders the onboarding wizard.
    post_verify_redirect: str = "/onboarding"


settings = Settings()
