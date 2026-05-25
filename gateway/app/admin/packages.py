from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_super_admin
from app.db import get_session
from app.packages.models import Package, PackagePlugin

router = APIRouter(prefix="/packages", tags=["admin:packages"])


@router.get("")
async def list_packages(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[dict]:
    rows = (
        await session.execute(select(Package).order_by(Package.monthly_price_cents))
    ).scalars().all()
    out = []
    for pkg in rows:
        plugins = (
            await session.execute(
                select(PackagePlugin.plugin_id).where(PackagePlugin.package_id == pkg.id)
            )
        ).scalars().all()
        out.append(
            {
                "id": pkg.id,
                "slug": pkg.slug,
                "name": pkg.name,
                "description": pkg.description,
                "monthly_price_cents": pkg.monthly_price_cents,
                "limits": pkg.limits,
                "plugins": list(plugins),
                "created_at": pkg.created_at.isoformat(),
            }
        )
    return out
