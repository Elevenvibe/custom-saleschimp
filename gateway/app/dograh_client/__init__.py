"""Typed client over the slice of Dograh's HTTP API the gateway needs.

Keep this module small: only methods we actually call. Every other call
gets routed by the reverse proxy, not by this client.
"""

from app.dograh_client.client import DograhClient, DograhError

__all__ = ["DograhClient", "DograhError"]
