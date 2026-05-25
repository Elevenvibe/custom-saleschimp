"""Fernet-based encryption for provider secrets stored in the Control DB.

The key comes from `GATEWAY_SECRETS_KEY`. Generate with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

If the key is missing, encryption/decryption fail loudly so we never silently
store plaintext.
"""

import json
from functools import lru_cache
from typing import Any

from cryptography.fernet import Fernet

from app.config import settings


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    if not settings.secrets_key:
        raise RuntimeError(
            "GATEWAY_SECRETS_KEY is not set — refusing to encrypt/decrypt. "
            "Generate one with: python -c 'from cryptography.fernet import "
            "Fernet; print(Fernet.generate_key().decode())'"
        )
    return Fernet(settings.secrets_key.encode())


def encrypt_dict(value: dict[str, Any]) -> dict[str, str]:
    """Wrap a JSON-encodable dict as {"_enc": "<fernet-ciphertext>"}.

    Stored as JSONB so the column shape doesn't change between encrypted and
    debug/plaintext rows (debug rows would be e.g. {"_dev_plain": {...}}).
    """
    raw = json.dumps(value, separators=(",", ":")).encode()
    return {"_enc": _fernet().encrypt(raw).decode()}


def decrypt_dict(stored: dict[str, Any]) -> dict[str, Any]:
    if "_enc" not in stored:
        raise ValueError("config_encrypted does not look encrypted (no _enc key)")
    raw = _fernet().decrypt(stored["_enc"].encode())
    return json.loads(raw)
