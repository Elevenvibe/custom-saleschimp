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

    # Reverse proxy timeouts (seconds).
    proxy_connect_timeout: float = 5.0
    proxy_read_timeout: float = 60.0

    # CORS allowlist for the admin UI. Comma-separated origins.
    admin_cors_origins: str = "http://localhost:3020,https://admin.mysaleschimp.com"

    # Public URL where the gateway is reachable from the user's browser. Used
    # to build verification + invite links in outgoing emails.
    public_base_url: str = "http://localhost:8080"

    # Where the verify endpoint sends the user after successful verification.
    # In P1.A this just lands them on the Dograh UI through the gateway proxy.
    post_verify_redirect: str = "/"


settings = Settings()
