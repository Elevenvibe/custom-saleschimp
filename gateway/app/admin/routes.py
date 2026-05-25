from fastapi import APIRouter

from app.admin.audit import router as audit_router
from app.admin.dashboard import router as dashboard_router
from app.admin.email_providers import router as email_providers_router
from app.admin.packages import router as packages_router
from app.admin.platform_users import router as platform_users_router
from app.admin.plugins import router as plugins_router
from app.admin.tenants import router as tenants_router

router = APIRouter()
router.include_router(dashboard_router)
router.include_router(tenants_router)
router.include_router(platform_users_router)
router.include_router(audit_router)
router.include_router(packages_router)
router.include_router(plugins_router)
router.include_router(email_providers_router)
