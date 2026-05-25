"""Catalog of Dograh-integrated providers and their popular models.

Hand-curated index of the vendors Dograh's pipeline can speak to today.
The admin UI uses this to populate the "New provider" dropdown so super-
admins pick from a known list (with sane slug + name + suggested models)
instead of typing free-text — which cuts down on typos that would
otherwise lead to missed cost lookups at billing time.

Each model carries `reference_prices` — known list prices from the
vendor's published rate card. The /sync-prices admin action upserts
these into cost_provider_prices so admins can start with realistic
defaults and adjust per their negotiated rates.

Prices are in micros (millionths of a currency unit). For per_1k_tokens
on a $2.50/1M token model, the value is 2_500 ($0.0025 × 1_000_000).
Update this dict whenever a vendor adjusts its list price or a new
integration ships in the dograh submodule.
"""

from typing import Literal, TypedDict

ProviderKind = Literal["llm", "tts", "stt", "embedding", "telephony"]


class ModelPrice(TypedDict):
    unit: str
    price_micros: int


class IntegratedModel(TypedDict):
    variant: str
    label: str
    prices: list[ModelPrice]


class IntegratedProvider(TypedDict):
    slug: str
    name: str
    homepage: str
    models: list[IntegratedModel]


# Helper to keep model lines short.
def _llm(input_per_1k: float, output_per_1k: float) -> list[ModelPrice]:
    """LLM model with split input/output pricing in USD per 1k tokens."""
    return [
        {"unit": "per_1k_tokens", "price_micros": round(input_per_1k * 1_000_000)},
        # Output gets its own variant via the price row's notes; here we model it
        # as a second price under per_output_token (still per token, just the
        # output rate). The calculator uses (unit, variant) to disambiguate.
        # For UI simplicity we collapse both into per_1k_tokens; admins can
        # add a separate price line per output rate manually if they need it.
    ] if input_per_1k == output_per_1k else [
        {"unit": "per_1k_tokens", "price_micros": round(input_per_1k * 1_000_000)},
        {"unit": "per_output_token", "price_micros": round(output_per_1k * 1_000)},  # micros per token
    ]


def _per_min(usd: float) -> list[ModelPrice]:
    return [{"unit": "per_minute", "price_micros": round(usd * 1_000_000)}]


def _telephony_countries(
    by_code: dict[str, tuple[str, float]],
) -> list[IntegratedModel]:
    """Convert {country_code: (display_name, usd_per_minute)} to model rows.

    Variant is the ISO 3166-1 alpha-2 code so the price row's variant column
    self-documents which destination it covers.
    """
    return [
        {"variant": code, "label": name, "prices": _per_min(price)}
        for code, (name, price) in sorted(by_code.items())
    ]


def _per_1k_chars(usd: float) -> list[ModelPrice]:
    return [{"unit": "per_1k_chars", "price_micros": round(usd * 1_000_000)}]


def _per_char(usd: float) -> list[ModelPrice]:
    # USD per character → micros per character: usd * 1_000_000
    return [{"unit": "per_character", "price_micros": round(usd * 1_000_000)}]


def _embed_1k_tokens(usd: float) -> list[ModelPrice]:
    return [{"unit": "per_1k_tokens", "price_micros": round(usd * 1_000_000)}]


INTEGRATED_PROVIDERS: dict[ProviderKind, list[IntegratedProvider]] = {
    "llm": [
        {
            "slug": "openai",
            "name": "OpenAI",
            "homepage": "https://openai.com",
            "models": [
                # Input/output blended into per_1k_tokens; admins can split via separate rows.
                {"variant": "gpt-4o", "label": "GPT-4o", "prices": _llm(0.0025, 0.010)},
                {"variant": "gpt-4o-mini", "label": "GPT-4o mini", "prices": _llm(0.00015, 0.0006)},
                {"variant": "gpt-4-turbo", "label": "GPT-4 Turbo", "prices": _llm(0.010, 0.030)},
                {"variant": "gpt-3.5-turbo", "label": "GPT-3.5 Turbo", "prices": _llm(0.0005, 0.0015)},
                {"variant": "gpt-5", "label": "GPT-5 (placeholder)", "prices": _llm(0.005, 0.015)},
            ],
        },
        {
            "slug": "anthropic",
            "name": "Anthropic",
            "homepage": "https://anthropic.com",
            "models": [
                {"variant": "claude-sonnet-4.5", "label": "Claude Sonnet 4.5", "prices": _llm(0.003, 0.015)},
                {"variant": "claude-opus-4.7", "label": "Claude Opus 4.7", "prices": _llm(0.015, 0.075)},
                {"variant": "claude-haiku-4.5", "label": "Claude Haiku 4.5", "prices": _llm(0.0008, 0.004)},
            ],
        },
        {
            "slug": "google-gemini",
            "name": "Google Gemini",
            "homepage": "https://ai.google.dev",
            "models": [
                {"variant": "gemini-2.0-flash", "label": "Gemini 2.0 Flash", "prices": _llm(0.00010, 0.00040)},
                {"variant": "gemini-1.5-pro", "label": "Gemini 1.5 Pro", "prices": _llm(0.00125, 0.005)},
            ],
        },
        {
            "slug": "groq",
            "name": "Groq",
            "homepage": "https://groq.com",
            "models": [
                {"variant": "llama-3.3-70b-versatile", "label": "Llama 3.3 70B", "prices": _llm(0.00059, 0.00079)},
                {"variant": "llama-3.1-8b-instant", "label": "Llama 3.1 8B Instant", "prices": _llm(0.00005, 0.00008)},
            ],
        },
        {
            "slug": "cerebras",
            "name": "Cerebras",
            "homepage": "https://cerebras.ai",
            "models": [
                {"variant": "llama-3.3-70b", "label": "Llama 3.3 70B", "prices": _llm(0.00085, 0.0012)},
            ],
        },
    ],
    "tts": [
        {
            "slug": "elevenlabs",
            "name": "ElevenLabs",
            "homepage": "https://elevenlabs.io",
            "models": [
                # ElevenLabs prices by characters; ~$0.30 per 1k chars on a typical plan
                {"variant": "eleven_turbo_v2_5", "label": "Turbo v2.5", "prices": _per_1k_chars(0.30)},
                {"variant": "eleven_multilingual_v2", "label": "Multilingual v2", "prices": _per_1k_chars(0.30)},
                {"variant": "eleven_flash_v2_5", "label": "Flash v2.5", "prices": _per_1k_chars(0.15)},
            ],
        },
        {
            "slug": "cartesia",
            "name": "Cartesia",
            "homepage": "https://cartesia.ai",
            "models": [
                {"variant": "sonic-2", "label": "Sonic 2", "prices": _per_1k_chars(0.25)},
                {"variant": "sonic-turbo", "label": "Sonic Turbo", "prices": _per_1k_chars(0.10)},
            ],
        },
        {
            "slug": "openai-tts",
            "name": "OpenAI TTS",
            "homepage": "https://platform.openai.com",
            "models": [
                {"variant": "tts-1", "label": "TTS-1", "prices": _per_1k_chars(0.015)},
                {"variant": "tts-1-hd", "label": "TTS-1 HD", "prices": _per_1k_chars(0.030)},
            ],
        },
        {
            "slug": "deepgram-tts",
            "name": "Deepgram Aura",
            "homepage": "https://deepgram.com",
            "models": [
                {"variant": "aura-2-thalia-en", "label": "Aura 2 Thalia (EN)", "prices": _per_1k_chars(0.030)},
                {"variant": "aura-2-asteria-en", "label": "Aura 2 Asteria (EN)", "prices": _per_1k_chars(0.030)},
            ],
        },
        {
            "slug": "azure-tts",
            "name": "Azure Speech",
            "homepage": "https://azure.microsoft.com/products/ai-services/ai-speech",
            "models": [
                {"variant": "neural", "label": "Neural voices", "prices": _per_1k_chars(0.016)},
            ],
        },
    ],
    "stt": [
        {
            "slug": "deepgram",
            "name": "Deepgram",
            "homepage": "https://deepgram.com",
            "models": [
                {"variant": "nova-3", "label": "Nova-3", "prices": _per_min(0.0058)},
                {"variant": "nova-2", "label": "Nova-2", "prices": _per_min(0.0043)},
            ],
        },
        {
            "slug": "assemblyai",
            "name": "AssemblyAI",
            "homepage": "https://assemblyai.com",
            "models": [
                {"variant": "best", "label": "Best (universal-2)", "prices": _per_min(0.0062)},
                {"variant": "nano", "label": "Nano", "prices": _per_min(0.0020)},
            ],
        },
        {
            "slug": "google-stt",
            "name": "Google Speech-to-Text",
            "homepage": "https://cloud.google.com/speech-to-text",
            "models": [
                {"variant": "latest_long", "label": "Latest long", "prices": _per_min(0.024)},
                {"variant": "latest_short", "label": "Latest short", "prices": _per_min(0.024)},
            ],
        },
        {
            "slug": "openai-whisper",
            "name": "OpenAI Whisper",
            "homepage": "https://platform.openai.com",
            "models": [
                {"variant": "whisper-1", "label": "Whisper-1", "prices": _per_min(0.006)},
            ],
        },
        {
            "slug": "azure-stt",
            "name": "Azure Speech",
            "homepage": "https://azure.microsoft.com/products/ai-services/ai-speech",
            "models": [
                {"variant": "standard", "label": "Standard", "prices": _per_min(0.0167)},
            ],
        },
    ],
    "embedding": [
        {
            "slug": "openai-embeddings",
            "name": "OpenAI Embeddings",
            "homepage": "https://platform.openai.com",
            "models": [
                {"variant": "text-embedding-3-large", "label": "text-embedding-3-large", "prices": _embed_1k_tokens(0.00013)},
                {"variant": "text-embedding-3-small", "label": "text-embedding-3-small", "prices": _embed_1k_tokens(0.00002)},
            ],
        },
        {
            "slug": "cohere",
            "name": "Cohere",
            "homepage": "https://cohere.com",
            "models": [
                {"variant": "embed-english-v3", "label": "Embed English v3", "prices": _embed_1k_tokens(0.00010)},
                {"variant": "embed-multilingual-v3", "label": "Embed Multilingual v3", "prices": _embed_1k_tokens(0.00010)},
            ],
        },
    ],
    # Telephony providers price by destination country, not by model.
    # `variant` is the ISO 3166-1 alpha-2 country code; `label` is the
    # human-readable country name. Each provider lists a starter set of
    # destinations with reference per-minute prices — admins add more via
    # the AddPriceDialog country multi-select.
    "telephony": [
        {
            "slug": "twilio",
            "name": "Twilio",
            "homepage": "https://twilio.com",
            "models": _telephony_countries({
                "US": ("United States", 0.0140),
                "CA": ("Canada", 0.0140),
                "GB": ("United Kingdom", 0.0250),
                "AU": ("Australia", 0.0420),
                "DE": ("Germany", 0.0190),
                "FR": ("France", 0.0180),
                "IN": ("India", 0.0130),
                "BR": ("Brazil", 0.0220),
                "MX": ("Mexico", 0.0200),
                "JP": ("Japan", 0.0530),
            }),
        },
        {
            "slug": "vonage",
            "name": "Vonage",
            "homepage": "https://vonage.com",
            "models": _telephony_countries({
                "US": ("United States", 0.0130),
                "CA": ("Canada", 0.0130),
                "GB": ("United Kingdom", 0.0240),
                "AU": ("Australia", 0.0410),
                "DE": ("Germany", 0.0180),
                "IN": ("India", 0.0125),
            }),
        },
        {
            "slug": "cloudonix",
            "name": "Cloudonix",
            "homepage": "https://cloudonix.com",
            "models": _telephony_countries({
                "US": ("United States", 0.010),
                "CA": ("Canada", 0.010),
                "GB": ("United Kingdom", 0.020),
                "IL": ("Israel", 0.010),
            }),
        },
        {
            "slug": "telnyx",
            "name": "Telnyx",
            "homepage": "https://telnyx.com",
            "models": _telephony_countries({
                "US": ("United States", 0.0070),
                "CA": ("Canada", 0.0070),
                "GB": ("United Kingdom", 0.0210),
                "AU": ("Australia", 0.0390),
                "DE": ("Germany", 0.0170),
                "IN": ("India", 0.0110),
            }),
        },
        {
            "slug": "plivo",
            "name": "Plivo",
            "homepage": "https://plivo.com",
            "models": _telephony_countries({
                "US": ("United States", 0.0090),
                "CA": ("Canada", 0.0090),
                "GB": ("United Kingdom", 0.0230),
                "AU": ("Australia", 0.0430),
                "IN": ("India", 0.0120),
            }),
        },
    ],
}


# ISO 3166-1 alpha-2 → display name. Used by the admin UI's country multi-select
# and as the canonical list of valid telephony variants. Trimmed to the ~80
# destinations Dograh-class voice traffic typically targets; admins can still
# enter a custom variant for anything missing.
COUNTRIES: list[tuple[str, str]] = [
    ("AE", "United Arab Emirates"),
    ("AR", "Argentina"),
    ("AT", "Austria"),
    ("AU", "Australia"),
    ("BE", "Belgium"),
    ("BG", "Bulgaria"),
    ("BR", "Brazil"),
    ("CA", "Canada"),
    ("CH", "Switzerland"),
    ("CL", "Chile"),
    ("CN", "China"),
    ("CO", "Colombia"),
    ("CZ", "Czechia"),
    ("DE", "Germany"),
    ("DK", "Denmark"),
    ("EG", "Egypt"),
    ("ES", "Spain"),
    ("FI", "Finland"),
    ("FR", "France"),
    ("GB", "United Kingdom"),
    ("GR", "Greece"),
    ("HK", "Hong Kong"),
    ("HR", "Croatia"),
    ("HU", "Hungary"),
    ("ID", "Indonesia"),
    ("IE", "Ireland"),
    ("IL", "Israel"),
    ("IN", "India"),
    ("IT", "Italy"),
    ("JP", "Japan"),
    ("KE", "Kenya"),
    ("KR", "South Korea"),
    ("LT", "Lithuania"),
    ("LU", "Luxembourg"),
    ("LV", "Latvia"),
    ("MA", "Morocco"),
    ("MX", "Mexico"),
    ("MY", "Malaysia"),
    ("NG", "Nigeria"),
    ("NL", "Netherlands"),
    ("NO", "Norway"),
    ("NZ", "New Zealand"),
    ("PE", "Peru"),
    ("PH", "Philippines"),
    ("PK", "Pakistan"),
    ("PL", "Poland"),
    ("PT", "Portugal"),
    ("RO", "Romania"),
    ("RS", "Serbia"),
    ("RU", "Russia"),
    ("SA", "Saudi Arabia"),
    ("SE", "Sweden"),
    ("SG", "Singapore"),
    ("SI", "Slovenia"),
    ("SK", "Slovakia"),
    ("TH", "Thailand"),
    ("TR", "Turkey"),
    ("TW", "Taiwan"),
    ("UA", "Ukraine"),
    ("US", "United States"),
    ("VN", "Vietnam"),
    ("ZA", "South Africa"),
]



def find_provider(slug: str) -> tuple[ProviderKind, IntegratedProvider] | None:
    for kind, providers in INTEGRATED_PROVIDERS.items():
        for p in providers:
            if p["slug"] == slug:
                return kind, p
    return None
