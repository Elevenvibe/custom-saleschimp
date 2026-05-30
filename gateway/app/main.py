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
from app.billing.cron import start_price_sync_loop, stop_price_sync_loop
from app.customer_auth.bootstrap import bootstrap_demo_tenant_if_needed
from app.auth.routes import router as auth_router
from app.auth.social_routes import router as social_auth_router
from app.config import settings
from app.customer_auth.invites import public_router as invites_public_router
from app.customer_auth.marketplace import router as customer_marketplace_router
from app.customer_auth.logs import router as customer_logs_router
from app.customer_auth.notifications import router as customer_notifications_router
from app.customer_auth.integrations import router as customer_integrations_router
from app.customer_auth.settings import router as customer_settings_router
from app.integrations.internal_routes import router as internal_integrations_router
from app.customer_auth.org_settings import router as org_settings_router
from app.customer_auth.suspension import (
    router as suspension_router,
    suspension_middleware,
)
from app.customer_auth.session_exchange import router as session_exchange_router
from app.mailbox.cron import start_mail_fetcher_loop, stop_mail_fetcher_loop
from app.mailbox.mail_routes import tenant_router as mail_tenant_router
from app.mailbox.routes import tenant_router as mailbox_tenant_router
from app.tickets.routes import tenant_router as tickets_tenant_router
from app.customer_auth.sso import router as customer_sso_router
from app.customer_auth.invites import tenant_router as invites_tenant_router
from app.customer_auth.login import router as customer_login_router
from app.customer_auth.me import router as customer_me_router
from app.customer_auth.plans import router as customer_plans_router
from app.customer_auth.routes import router as customer_auth_router
from app.customer_auth.payments import router as customer_payments_router
from app.customer_auth.wallet import router as customer_wallet_router
from app.fx.cron import start_fx_fetcher_loop, stop_fx_fetcher_loop
from app.seed.cron import start_seed_loops, stop_seed_loops
from app.seed.lockdown import demo_lockdown_middleware
from app.payments.cron import start_auto_reload_loop, stop_auto_reload_loop
from app.payments.webhooks import router as payments_webhook_router
from app.wallet.ingest import start_usage_ingest_loop, stop_usage_ingest_loop
from app.pages.routes import router as pages_router
from app.proxy.routes import router as proxy_router
from app.proxy.ws import router as ws_proxy_router

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(_: FastAPI):
    log.info("gateway.start", env=settings.environment)
    await bootstrap_super_admin_if_needed()
    await bootstrap_demo_tenant_if_needed()
    await start_price_sync_loop()
    await start_usage_ingest_loop()
    await start_auto_reload_loop()
    await start_fx_fetcher_loop()
    await start_mail_fetcher_loop()
    await start_seed_loops()
    yield
    await stop_seed_loops()
    await stop_mail_fetcher_loop()
    await stop_fx_fetcher_loop()
    await stop_auto_reload_loop()
    await stop_usage_ingest_loop()
    await stop_price_sync_loop()
    log.info("gateway.stop")


app = FastAPI(
    title="SalesChimp Gateway",
    version="0.0.1",
    lifespan=lifespan,
)


@app.get("/healthz", include_in_schema=False)
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


# Suspension enforcement — blocks suspended tenants from non-allowlisted
# /api/tenant/* routes (allowlist keeps me/tickets/suspension-info open so
# the /suspended page + support reply still work).
#
# ORDER MATTERS: Starlette runs the LAST-added middleware OUTERMOST. We
# register this FIRST so CORS (added after) ends up outermost and wraps
# this middleware's 403 response with Access-Control-Allow-Origin —
# otherwise the browser sees a header-less cross-origin 403 and reports
# "Failed to fetch" instead of letting the console read the
# {code:'tenant_suspended'} body and redirect to /suspended.
app.middleware("http")(suspension_middleware)

# Demo CRUD lockdown — 403s mutations on the demo tenant when CRUD is off.
# Registered AFTER suspension (so suspension is outermost between the two,
# and a suspended demo tenant still hits the suspended page), BEFORE CORS
# (so CORS wraps the 403 response with the right headers — same reasoning).
app.middleware("http")(demo_lockdown_middleware)

# CORS for cross-origin browser apps (admin UI + customer app). Added
# LAST → outermost → its headers cover every response, including the
# suspension middleware's 403 and any error.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Gateway-owned routes. Mount BEFORE the catch-all proxy.
app.include_router(auth_router, prefix="/api/auth")
app.include_router(social_auth_router, prefix="/api/auth")
app.include_router(customer_auth_router, prefix="/api/auth")
app.include_router(customer_login_router, prefix="/api/auth")
app.include_router(invites_public_router, prefix="/api/auth")
app.include_router(customer_sso_router, prefix="/api/auth")
app.include_router(session_exchange_router, prefix="/api/auth")
app.include_router(org_settings_router, prefix="/api/tenant")
app.include_router(suspension_router, prefix="/api/tenant")
app.include_router(tickets_tenant_router, prefix="/api/tenant")
app.include_router(customer_logs_router, prefix="/api/tenant")
app.include_router(mailbox_tenant_router, prefix="/api/tenant")
app.include_router(mail_tenant_router, prefix="/api/tenant")
app.include_router(customer_marketplace_router, prefix="/api/tenant")
app.include_router(invites_tenant_router, prefix="/api/tenant")
app.include_router(customer_me_router, prefix="/api/tenant")
app.include_router(customer_notifications_router, prefix="/api/tenant")
app.include_router(customer_integrations_router, prefix="/api/tenant")
app.include_router(customer_settings_router, prefix="/api/tenant")
app.include_router(internal_integrations_router)
app.include_router(customer_plans_router, prefix="/api/tenant")
app.include_router(customer_wallet_router, prefix="/api/tenant")
app.include_router(customer_payments_router, prefix="/api/tenant")
app.include_router(payments_webhook_router, prefix="/api")
app.include_router(admin_router, prefix="/api/admin")
app.include_router(pages_router)

# WebSocket proxy for /api/v1/* upgrade requests. Mounted before the HTTP
# catch-all so the upgrade is routed correctly; the HTTP proxy still handles
# everything else on /api/v1/*.
app.include_router(ws_proxy_router)

# Catch-all HTTP reverse proxy. MUST be mounted last — FastAPI matches in
# registration order for ambiguous routes.
app.include_router(proxy_router)
