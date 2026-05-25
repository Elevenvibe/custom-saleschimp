"""Base types for provider adapters."""

from dataclasses import dataclass, field
from typing import Protocol


class AdapterError(Exception):
    """Wraps any upstream-fetch failure with a user-friendly message."""

    def __init__(self, message: str, *, status: int | None = None):
        super().__init__(message)
        self.status = status


@dataclass
class FetchedModel:
    variant: str
    label: str | None = None


@dataclass
class AdapterFetchResult:
    models: list[FetchedModel] = field(default_factory=list)
    # Future: per-model prices when the adapter knows them. Most don't.
    notes: str | None = None


class ProviderAdapter(Protocol):
    """One adapter instance per (provider slug, credentials) pair."""

    slug: str

    async def fetch_models(self) -> AdapterFetchResult: ...
