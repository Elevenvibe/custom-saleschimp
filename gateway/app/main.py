"""SaaS Gateway entrypoint.

P0 surface:
    GET  /healthz                          gateway liveness
    POST /api/auth/super-admin/login       super-admin authentication
    GET  /api/auth/super-admin/me          echo authenticated claims
    *    /{path:path}                      reverse-proxy to Dograh UI/API

All other routes (multi-tenant onboarding, admin CRUD, plugin runtime) land
in later phases per docs/saas-architecture.md.
"""

from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI

# Import models so SQLAlchemy registers them on Base.metadata (used by alembic
# autogenerate). Side-effect import; intentional.
from app import models as _models  # noqa: F401
from app.auth.bootstrap import bootstrap_super_admin_if_needed
from app.auth.routes import router as auth_router
from app.config import settings
from app.proxy.routes import router as proxy_router

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(_: FastAPI):
    log.info("gateway.start", env=settings.environment)
    await bootstrap_super_admin_if_needed()
    yield
    log.info("gateway.stop")


app = FastAPI(
    title="SalesChimp Gateway",
    version="0.0.1",
    lifespan=lifespan,
)


@app.get("/healthz", include_in_schema=False)
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


# Gateway-owned routes. Mount BEFORE the catch-all proxy.
app.include_router(auth_router, prefix="/api/auth")

# Catch-all reverse proxy. MUST be mounted last — FastAPI matches in registration
# order for ambiguous routes.
app.include_router(proxy_router)
