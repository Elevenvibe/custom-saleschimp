from fastapi import APIRouter

from app.admin.audit import router as audit_router
from app.admin.cost_providers import markup_router, router as cost_providers_router
from app.admin.dashboard import router as dashboard_router
from app.admin.email_providers import router as email_providers_router
from app.admin.invites import router as invites_router
from app.admin.packages import router as packages_router
from app.admin.platform_users import router as platform_users_router
from app.admin.plugins import router as plugins_router
from app.admin.price_sync import router as price_sync_router
from app.admin.fx_rates import router as fx_rates_router
from app.admin.payment_providers import router as payment_providers_router
from app.admin.payments import router as admin_payments_router
from app.admin.marketplace import router as admin_marketplace_router
from app.admin.sso import router as admin_sso_router
from app.admin.tenants import router as tenants_router
from app.admin.wallet import router as wallet_router
from app.mailbox.mail_routes import admin_router as mail_admin_router
from app.mailbox.routes import admin_router as mailbox_admin_router
from app.tickets.routes import admin_router as tickets_admin_router

router = APIRouter()
router.include_router(dashboard_router)
router.include_router(tenants_router)
router.include_router(platform_users_router)
router.include_router(audit_router)
router.include_router(packages_router)
router.include_router(plugins_router)
router.include_router(email_providers_router)
router.include_router(invites_router)
router.include_router(cost_providers_router)
router.include_router(markup_router)
router.include_router(price_sync_router)
router.include_router(wallet_router)
router.include_router(admin_payments_router)
router.include_router(payment_providers_router)
router.include_router(fx_rates_router)
router.include_router(admin_sso_router)
router.include_router(admin_marketplace_router)
router.include_router(tickets_admin_router)
router.include_router(mailbox_admin_router)
router.include_router(mail_admin_router)
