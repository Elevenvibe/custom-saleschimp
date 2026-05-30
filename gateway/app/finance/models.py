"""Finance — configurable tax rates.

A small catalog of named tax rates (VAT / GST / Sales Tax, etc.) the platform
can apply. `inclusive` records whether prices already include the tax or it's
added on top. At most one row is the default (enforced in the service layer).
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TaxRate(Base):
    __tablename__ = "tax_rates"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    # Percentage, e.g. 20.000 for 20%.
    rate: Mapped[float] = mapped_column(Numeric(6, 3), nullable=False)
    region: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # True: displayed prices already include this tax. False: added on top.
    inclusive: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
