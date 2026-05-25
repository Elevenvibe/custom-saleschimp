from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GATEWAY_", case_sensitive=False)

    # Core
    environment: str = "local"
    log_level: str = "INFO"

    # Control DB (Postgres). Defaults to the shared postgres service / database 'control'.
    database_url: str = "postgresql+asyncpg://postgres:postgres@postgres:5432/control"

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


settings = Settings()
