"""Map a cost_providers.slug to a live ProviderAdapter, given creds."""

from typing import Any

from app.billing.adapters.base import AdapterError, ProviderAdapter
from app.billing.adapters.openai_compatible import OpenAICompatibleAdapter

# Endpoints for OpenAI-compatible vendors. Add a row here when a new adapter ships.
_OPENAI_COMPATIBLE: dict[str, dict[str, str]] = {
    "openai":              {"base_url": "https://api.openai.com/v1"},
    "openai-tts":          {"base_url": "https://api.openai.com/v1"},
    "openai-whisper":      {"base_url": "https://api.openai.com/v1"},
    "openai-embeddings":   {"base_url": "https://api.openai.com/v1"},
    "groq":                {"base_url": "https://api.groq.com/openai/v1"},
    "cerebras":            {"base_url": "https://api.cerebras.ai/v1"},
}


def get_adapter(slug: str, credentials: dict[str, Any]) -> ProviderAdapter:
    """Build a live adapter for the given provider slug + decrypted credentials.

    Raises AdapterError if we don't have a live adapter for this provider yet
    (the catalog is still useful — admins can sync reference prices from it).
    """
    api_key = credentials.get("api_key")
    if not api_key:
        raise AdapterError(f"missing api_key for {slug}")

    if slug in _OPENAI_COMPATIBLE:
        cfg = _OPENAI_COMPATIBLE[slug]
        return OpenAICompatibleAdapter(slug=slug, api_key=api_key, base_url=cfg["base_url"])

    raise AdapterError(
        f"no live adapter for {slug} yet — using the catalog. "
        "Add one in gateway/app/billing/adapters/ to enable live model fetch."
    )
