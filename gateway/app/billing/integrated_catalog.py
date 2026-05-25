"""Catalog of Dograh-integrated providers and their popular models.

Hand-curated index of the vendors Dograh's pipeline can speak to today.
The admin UI uses this to populate the "New provider" dropdown so super-
admins pick from a known list (with sane slug + name + suggested models)
instead of typing free-text — which cuts down on typos that would
otherwise lead to missed cost lookups at billing time.

Update this dict whenever a new provider lands in the dograh submodule
(or in our gateway-side integration). Each model is a default `variant`
that the UI suggests when adding a price for that provider.

Money figures aren't stored here — admins still own pricing. This is a
catalog of names + models only.
"""

from typing import Literal, TypedDict

ProviderKind = Literal["llm", "tts", "stt", "embedding", "telephony"]


class IntegratedModel(TypedDict):
    variant: str
    label: str
    # Hint for the UI about which unit makes sense (per_1k_tokens for LLM,
    # per_minute for TTS/STT/telephony, etc.). UI uses it as a default; the
    # admin can override.
    suggested_unit: str


class IntegratedProvider(TypedDict):
    slug: str
    name: str
    homepage: str
    models: list[IntegratedModel]


INTEGRATED_PROVIDERS: dict[ProviderKind, list[IntegratedProvider]] = {
    "llm": [
        {
            "slug": "openai",
            "name": "OpenAI",
            "homepage": "https://openai.com",
            "models": [
                {"variant": "gpt-4o", "label": "GPT-4o", "suggested_unit": "per_1k_tokens"},
                {"variant": "gpt-4o-mini", "label": "GPT-4o mini", "suggested_unit": "per_1k_tokens"},
                {"variant": "gpt-4-turbo", "label": "GPT-4 Turbo", "suggested_unit": "per_1k_tokens"},
                {"variant": "gpt-3.5-turbo", "label": "GPT-3.5 Turbo", "suggested_unit": "per_1k_tokens"},
            ],
        },
        {
            "slug": "anthropic",
            "name": "Anthropic",
            "homepage": "https://anthropic.com",
            "models": [
                {"variant": "claude-sonnet-4.5", "label": "Claude Sonnet 4.5", "suggested_unit": "per_1k_tokens"},
                {"variant": "claude-opus-4.7", "label": "Claude Opus 4.7", "suggested_unit": "per_1k_tokens"},
                {"variant": "claude-haiku-4.5", "label": "Claude Haiku 4.5", "suggested_unit": "per_1k_tokens"},
            ],
        },
        {
            "slug": "google-gemini",
            "name": "Google Gemini",
            "homepage": "https://ai.google.dev",
            "models": [
                {"variant": "gemini-2.0-flash", "label": "Gemini 2.0 Flash", "suggested_unit": "per_1k_tokens"},
                {"variant": "gemini-1.5-pro", "label": "Gemini 1.5 Pro", "suggested_unit": "per_1k_tokens"},
            ],
        },
        {
            "slug": "groq",
            "name": "Groq",
            "homepage": "https://groq.com",
            "models": [
                {"variant": "llama-3.3-70b-versatile", "label": "Llama 3.3 70B", "suggested_unit": "per_1k_tokens"},
                {"variant": "llama-3.1-8b-instant", "label": "Llama 3.1 8B Instant", "suggested_unit": "per_1k_tokens"},
            ],
        },
        {
            "slug": "cerebras",
            "name": "Cerebras",
            "homepage": "https://cerebras.ai",
            "models": [
                {"variant": "llama-3.3-70b", "label": "Llama 3.3 70B", "suggested_unit": "per_1k_tokens"},
            ],
        },
    ],
    "tts": [
        {
            "slug": "elevenlabs",
            "name": "ElevenLabs",
            "homepage": "https://elevenlabs.io",
            "models": [
                {"variant": "eleven_turbo_v2_5", "label": "Turbo v2.5", "suggested_unit": "per_character"},
                {"variant": "eleven_multilingual_v2", "label": "Multilingual v2", "suggested_unit": "per_character"},
                {"variant": "eleven_flash_v2_5", "label": "Flash v2.5", "suggested_unit": "per_character"},
            ],
        },
        {
            "slug": "cartesia",
            "name": "Cartesia",
            "homepage": "https://cartesia.ai",
            "models": [
                {"variant": "sonic-2", "label": "Sonic 2", "suggested_unit": "per_character"},
                {"variant": "sonic-turbo", "label": "Sonic Turbo", "suggested_unit": "per_character"},
            ],
        },
        {
            "slug": "openai-tts",
            "name": "OpenAI TTS",
            "homepage": "https://platform.openai.com",
            "models": [
                {"variant": "tts-1", "label": "TTS-1", "suggested_unit": "per_1k_chars"},
                {"variant": "tts-1-hd", "label": "TTS-1 HD", "suggested_unit": "per_1k_chars"},
            ],
        },
        {
            "slug": "deepgram-tts",
            "name": "Deepgram Aura",
            "homepage": "https://deepgram.com",
            "models": [
                {"variant": "aura-2-thalia-en", "label": "Aura 2 Thalia (EN)", "suggested_unit": "per_character"},
                {"variant": "aura-2-asteria-en", "label": "Aura 2 Asteria (EN)", "suggested_unit": "per_character"},
            ],
        },
        {
            "slug": "azure-tts",
            "name": "Azure Speech",
            "homepage": "https://azure.microsoft.com/products/ai-services/ai-speech",
            "models": [
                {"variant": "neural", "label": "Neural voices", "suggested_unit": "per_1k_chars"},
            ],
        },
    ],
    "stt": [
        {
            "slug": "deepgram",
            "name": "Deepgram",
            "homepage": "https://deepgram.com",
            "models": [
                {"variant": "nova-3", "label": "Nova-3", "suggested_unit": "per_minute"},
                {"variant": "nova-2", "label": "Nova-2", "suggested_unit": "per_minute"},
            ],
        },
        {
            "slug": "assemblyai",
            "name": "AssemblyAI",
            "homepage": "https://assemblyai.com",
            "models": [
                {"variant": "best", "label": "Best (universal-2)", "suggested_unit": "per_minute"},
                {"variant": "nano", "label": "Nano", "suggested_unit": "per_minute"},
            ],
        },
        {
            "slug": "google-stt",
            "name": "Google Speech-to-Text",
            "homepage": "https://cloud.google.com/speech-to-text",
            "models": [
                {"variant": "latest_long", "label": "Latest long", "suggested_unit": "per_minute"},
                {"variant": "latest_short", "label": "Latest short", "suggested_unit": "per_minute"},
            ],
        },
        {
            "slug": "openai-whisper",
            "name": "OpenAI Whisper",
            "homepage": "https://platform.openai.com",
            "models": [
                {"variant": "whisper-1", "label": "Whisper-1", "suggested_unit": "per_minute"},
            ],
        },
        {
            "slug": "azure-stt",
            "name": "Azure Speech",
            "homepage": "https://azure.microsoft.com/products/ai-services/ai-speech",
            "models": [
                {"variant": "standard", "label": "Standard", "suggested_unit": "per_minute"},
            ],
        },
    ],
    "embedding": [
        {
            "slug": "openai-embeddings",
            "name": "OpenAI Embeddings",
            "homepage": "https://platform.openai.com",
            "models": [
                {"variant": "text-embedding-3-large", "label": "text-embedding-3-large", "suggested_unit": "per_1k_tokens"},
                {"variant": "text-embedding-3-small", "label": "text-embedding-3-small", "suggested_unit": "per_1k_tokens"},
            ],
        },
        {
            "slug": "cohere",
            "name": "Cohere",
            "homepage": "https://cohere.com",
            "models": [
                {"variant": "embed-english-v3", "label": "Embed English v3", "suggested_unit": "per_1k_tokens"},
                {"variant": "embed-multilingual-v3", "label": "Embed Multilingual v3", "suggested_unit": "per_1k_tokens"},
            ],
        },
    ],
    "telephony": [
        {
            "slug": "twilio",
            "name": "Twilio",
            "homepage": "https://twilio.com",
            "models": [
                {"variant": "outbound", "label": "Outbound voice", "suggested_unit": "per_minute"},
                {"variant": "inbound", "label": "Inbound voice", "suggested_unit": "per_minute"},
            ],
        },
        {
            "slug": "vonage",
            "name": "Vonage",
            "homepage": "https://vonage.com",
            "models": [
                {"variant": "outbound", "label": "Outbound voice", "suggested_unit": "per_minute"},
                {"variant": "inbound", "label": "Inbound voice", "suggested_unit": "per_minute"},
            ],
        },
        {
            "slug": "cloudonix",
            "name": "Cloudonix",
            "homepage": "https://cloudonix.com",
            "models": [
                {"variant": "outbound", "label": "Outbound voice", "suggested_unit": "per_minute"},
                {"variant": "inbound", "label": "Inbound voice", "suggested_unit": "per_minute"},
            ],
        },
        {
            "slug": "telnyx",
            "name": "Telnyx",
            "homepage": "https://telnyx.com",
            "models": [
                {"variant": "outbound", "label": "Outbound voice", "suggested_unit": "per_minute"},
                {"variant": "inbound", "label": "Inbound voice", "suggested_unit": "per_minute"},
            ],
        },
        {
            "slug": "plivo",
            "name": "Plivo",
            "homepage": "https://plivo.com",
            "models": [
                {"variant": "outbound", "label": "Outbound voice", "suggested_unit": "per_minute"},
                {"variant": "inbound", "label": "Inbound voice", "suggested_unit": "per_minute"},
            ],
        },
    ],
}
