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
from fastapi.middleware.cors import CORSMiddleware

# Import models so SQLAlchemy registers them on Base.metadata (used by alembic
# autogenerate). Side-effect import; intentional.
from app import models as _models  # noqa: F401
from app.admin.routes import router as admin_router
from app.auth.bootstrap import bootstrap_super_admin_if_needed
from app.customer_auth.bootstrap import bootstrap_demo_tenant_if_needed
from app.auth.routes import router as auth_router
from app.config import settings
from app.customer_auth.invites import public_router as invites_public_router
from app.customer_auth.invites import tenant_router as invites_tenant_router
from app.customer_auth.login import router as customer_login_router
from app.customer_auth.me import router as customer_me_router
from app.customer_auth.routes import router as customer_auth_router
from app.pages.routes import router as pages_router
from app.proxy.routes import router as proxy_router
from app.proxy.ws import router as ws_proxy_router

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(_: FastAPI):
    log.info("gateway.start", env=settings.environment)
    await bootstrap_super_admin_if_needed()
    await bootstrap_demo_tenant_if_needed()
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


# CORS for cross-origin browser apps (admin UI + customer app).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Gateway-owned routes. Mount BEFORE the catch-all proxy.
app.include_router(auth_router, prefix="/api/auth")
app.include_router(customer_auth_router, prefix="/api/auth")
app.include_router(customer_login_router, prefix="/api/auth")
app.include_router(invites_public_router, prefix="/api/auth")
app.include_router(invites_tenant_router, prefix="/api/tenant")
app.include_router(customer_me_router, prefix="/api/tenant")
app.include_router(admin_router, prefix="/api/admin")
app.include_router(pages_router)

# WebSocket proxy for /api/v1/* upgrade requests. Mounted before the HTTP
# catch-all so the upgrade is routed correctly; the HTTP proxy still handles
# everything else on /api/v1/*.
app.include_router(ws_proxy_router)

# Catch-all HTTP reverse proxy. MUST be mounted last — FastAPI matches in
# registration order for ambiguous routes.
app.include_router(proxy_router)
