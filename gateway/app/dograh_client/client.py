"""Minimal typed client over Dograh's /api/v1/auth/* endpoints.

This is the seam between the gateway and Dograh — every other interaction
goes through the reverse proxy on the user's behalf. Use this client only
when the gateway itself needs to act on Dograh (e.g. creating a user during
verification).
"""

from dataclasses import dataclass

import httpx

from app.config import settings


class DograhError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(f"dograh {status_code}: {detail}")
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class DograhUser:
    id: int
    email: str
    organization_id: int
    provider_id: str
    token: str  # Dograh-issued JWT (sub=user_id, signed with OSS_JWT_SECRET)


class DograhClient:
    def __init__(self, base_url: str | None = None, timeout: float = 10.0):
        self._base = (base_url or settings.dograh_api_url).rstrip("/")
        self._timeout = timeout

    async def signup(self, *, email: str, password: str, name: str) -> DograhUser:
        """Call POST /api/v1/auth/signup.

        Dograh creates the user, auto-creates an organization owned by them,
        links the user, and returns a JWT. We surface the IDs so the gateway
        can write them into the `tenants` / `tenant_members` tables.
        """
        url = f"{self._base}/api/v1/auth/signup"
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            r = await client.post(
                url,
                json={"email": email, "password": password, "name": name},
            )
        if r.status_code == 409:
            raise DograhError(409, "email already registered in Dograh")
        if r.status_code >= 400:
            raise DograhError(r.status_code, _detail(r))

        data = r.json()
        u = data["user"]
        return DograhUser(
            id=u["id"],
            email=u["email"],
            organization_id=u["organization_id"],
            provider_id=u["provider_id"],
            token=data["token"],
        )

    async def login(self, *, email: str, password: str) -> DograhUser:
        url = f"{self._base}/api/v1/auth/login"
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            r = await client.post(url, json={"email": email, "password": password})
        if r.status_code == 401:
            raise DograhError(401, "invalid credentials")
        if r.status_code >= 400:
            raise DograhError(r.status_code, _detail(r))

        data = r.json()
        u = data["user"]
        return DograhUser(
            id=u["id"],
            email=u["email"],
            organization_id=u["organization_id"],
            provider_id=u["provider_id"],
            token=data["token"],
        )


def _detail(r: httpx.Response) -> str:
    try:
        d = r.json()
        return str(d.get("detail", d))
    except Exception:
        return r.text[:200]
