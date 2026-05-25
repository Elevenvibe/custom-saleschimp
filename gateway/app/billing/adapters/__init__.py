"""Per-vendor adapters that talk to the provider's HTTP API.

Each integrated provider that we can fetch live model lists from gets its
own adapter implementing `ProviderAdapter`. Adapters are looked up by the
cost_provider's `slug`.

For now the framework + an OpenAI-compatible adapter (used by openai,
groq, cerebras, and openai-tts) ship. Provider-specific adapters
(Anthropic, ElevenLabs, Deepgram, Twilio, etc.) layer on top one by
one without changing this scaffolding.
"""

from app.billing.adapters.base import (
    AdapterError,
    AdapterFetchResult,
    ProviderAdapter,
)
from app.billing.adapters.openai_compatible import OpenAICompatibleAdapter
from app.billing.adapters.registry import get_adapter

__all__ = [
    "AdapterError",
    "AdapterFetchResult",
    "ProviderAdapter",
    "OpenAICompatibleAdapter",
    "get_adapter",
]
