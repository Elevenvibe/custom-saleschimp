"""Adapter for OpenAI-compatible /v1/models endpoints.

Used by openai, groq, cerebras, openai-tts, openai-whisper, openai-embeddings.
All of them expose the same shape: GET {base_url}/models with a Bearer token
returns `{"data": [{"id": "..."}, ...]}`.
"""

from dataclasses import dataclass

import httpx

from app.billing.adapters.base import (
    AdapterError,
    AdapterFetchResult,
    FetchedModel,
)


@dataclass
class OpenAICompatibleAdapter:
    slug: str
    api_key: str
    base_url: str = "https://api.openai.com/v1"
    # Optional ID-substring filter so groq/cerebras adapters can skip whisper/etc.
    model_prefix: str | None = None

    async def fetch_models(self) -> AdapterFetchResult:
        url = f"{self.base_url.rstrip('/')}/models"
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.get(
                    url, headers={"Authorization": f"Bearer {self.api_key}"}
                )
        except httpx.HTTPError as e:
            raise AdapterError(f"connect to {self.slug} failed: {e}") from e
        if r.status_code == 401:
            raise AdapterError("invalid API key", status=401)
        if r.status_code >= 400:
            raise AdapterError(
                f"{self.slug} returned {r.status_code}: {r.text[:200]}",
                status=r.status_code,
            )
        body = r.json()
        models: list[FetchedModel] = []
        for item in body.get("data", []):
            mid = item.get("id")
            if not mid:
                continue
            if self.model_prefix and not mid.startswith(self.model_prefix):
                continue
            models.append(FetchedModel(variant=mid, label=mid))
        models.sort(key=lambda m: m.variant)
        return AdapterFetchResult(models=models, notes=f"{len(models)} models from {url}")
