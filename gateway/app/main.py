"""SaaS Gateway entrypoint.

P0 scope: serve /healthz; the reverse-proxy, auth, and admin routes will be
mounted as they're implemented. The compose override puts this service on
port 8080 alongside (not in front of) Dograh's existing ports, so adding
gateway is non-disruptive.
"""

from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI

from app.config import settings

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(_: FastAPI):
    log.info("gateway.start", env=settings.environment)
    yield
    log.info("gateway.stop")


app = FastAPI(
    title="SalesChimp Gateway",
    version="0.0.1",
    lifespan=lifespan,
)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


# Future mounts (each lands in its own phase per docs/saas-architecture.md):
#   from app.auth.routes import router as auth_router
#   app.include_router(auth_router, prefix="/api/auth")
#   from app.admin.routes import router as admin_router
#   app.include_router(admin_router, prefix="/api/admin")
#   from app.proxy.routes import router as proxy_router
#   app.include_router(proxy_router)   # catch-all proxy, mounted last
