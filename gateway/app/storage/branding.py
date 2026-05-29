"""MinIO-backed storage for tenant branding assets.

Logos + favicons uploaded on the org settings page land here. The
bucket (`tenant-branding` by default) is created on first use and
its policy is set to public-read so the URLs we hand back to the
browser are directly fetchable — same pattern Dograh uses for the
call-recording bucket.

The endpoint split (`minio_endpoint` vs `minio_public_endpoint`)
exists because the gateway talks to MinIO over the docker network
(`minio:9000`) but the URLs we return to the browser must use a
host the browser can reach (`localhost:9000` in dev, a real CDN
URL in prod).

Public-read on a separate bucket from voice-audio means a leaked
branding URL can't surface a recording, and vice versa.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Final

import aioboto3
import structlog
from botocore.exceptions import ClientError

from app.config import settings

log = structlog.get_logger()

# Hard caps surfaced as 400s to the caller before we even touch MinIO.
MAX_BYTES: Final[int] = 2 * 1024 * 1024  # 2 MB — generous for an org logo
ALLOWED_CONTENT_TYPES: Final[set[str]] = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/svg+xml",
    "image/x-icon",
    "image/vnd.microsoft.icon",
}

_bucket_ready = False
_bucket_lock = asyncio.Lock()


class StorageError(Exception):
    """Anything we want surfaced as a 400/500 from the route."""


def _session() -> aioboto3.Session:
    return aioboto3.Session(
        aws_access_key_id=settings.minio_access_key,
        aws_secret_access_key=settings.minio_secret_key,
    )


def _client():
    """Returns an aioboto3 s3 client context manager pointed at MinIO.

    Callers must use `async with` so the underlying http session is
    closed cleanly — leaking it on every upload would exhaust the
    asyncio loop's connection pool fast.
    """
    return _session().client(
        "s3",
        endpoint_url=f"http{'s' if settings.minio_secure else ''}://{settings.minio_endpoint}",
        region_name="us-east-1",  # MinIO ignores it but boto3 requires *some* region.
    )


async def _ensure_bucket() -> None:
    """Create the bucket if missing and pin a public-read policy so the
    URLs we hand back to the browser are directly fetchable. Safe to
    call on every upload because of the module-level flag + lock; the
    cost is one head_bucket round-trip on cold start."""
    global _bucket_ready
    if _bucket_ready:
        return
    async with _bucket_lock:
        if _bucket_ready:
            return
        bucket = settings.minio_branding_bucket
        async with _client() as s3:
            try:
                await s3.head_bucket(Bucket=bucket)
            except ClientError as e:
                code = e.response.get("Error", {}).get("Code", "")
                if code in {"404", "NoSuchBucket", "NotFound"}:
                    await s3.create_bucket(Bucket=bucket)
                    log.info("storage.bucket_created", bucket=bucket)
                else:
                    raise
            # Public-read policy. Idempotent — putting the same policy
            # twice is a no-op.
            policy = {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Principal": {"AWS": ["*"]},
                        "Action": ["s3:GetObject"],
                        "Resource": [f"arn:aws:s3:::{bucket}/*"],
                    }
                ],
            }
            try:
                await s3.put_bucket_policy(
                    Bucket=bucket, Policy=json.dumps(policy)
                )
            except ClientError as e:
                # Non-fatal — if put_bucket_policy fails (some MinIO
                # configs lock this down), we still upload; the URL will
                # 403 client-side and the operator can fix the policy.
                log.warning("storage.bucket_policy_failed", bucket=bucket, error=str(e))
        _bucket_ready = True


def _safe_extension(content_type: str, filename: str | None) -> str:
    """Pick a file extension from content_type, with the filename's
    suffix as a fallback. Keeps the object key human-readable in MinIO."""
    by_type = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
        "image/x-icon": ".ico",
        "image/vnd.microsoft.icon": ".ico",
    }
    if content_type in by_type:
        return by_type[content_type]
    if filename and "." in filename:
        ext = filename.rsplit(".", 1)[1].lower()
        # Defend against ../../escape attempts even though the key is
        # already path-sanitised below.
        if re.fullmatch(r"[a-z0-9]{2,5}", ext):
            return f".{ext}"
    return ""


async def upload_branding(
    *,
    tenant_id: int,
    kind: str,
    data: bytes,
    content_type: str,
    filename: str | None,
) -> str:
    """Validate + upload + return a public URL.

    Object key pattern: `tenants/<tenant_id>/<kind>-<unix_ms><ext>` so
    successive uploads don't overwrite each other (lets the browser cache
    forever; old objects can be garbage-collected later).
    """
    if kind not in {"logo", "favicon"}:
        raise StorageError(f"unsupported branding kind: {kind}")
    if len(data) == 0:
        raise StorageError("uploaded file is empty")
    if len(data) > MAX_BYTES:
        raise StorageError(f"file is too large ({len(data)} bytes, max {MAX_BYTES})")
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise StorageError(f"unsupported content type: {content_type}")

    await _ensure_bucket()

    import time

    ts = int(time.time() * 1000)
    ext = _safe_extension(content_type, filename)
    key = f"tenants/{tenant_id}/{kind}-{ts}{ext}"

    async with _client() as s3:
        await s3.put_object(
            Bucket=settings.minio_branding_bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl="public, max-age=31536000, immutable",
        )

    base = settings.minio_public_endpoint.rstrip("/")
    return f"{base}/{settings.minio_branding_bucket}/{key}"


async def upload_avatar(
    *,
    scope: str,
    scope_id: int,
    data: bytes,
    content_type: str,
    filename: str | None,
) -> str:
    """Upload a profile picture, reusing the branding bucket + public-read
    policy. `scope` namespaces the key (e.g. 'platform-users', 'members').
    Same validation as branding."""
    if len(data) == 0:
        raise StorageError("uploaded file is empty")
    if len(data) > MAX_BYTES:
        raise StorageError(f"file is too large ({len(data)} bytes, max {MAX_BYTES})")
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise StorageError(f"unsupported content type: {content_type}")

    await _ensure_bucket()

    import time

    ts = int(time.time() * 1000)
    ext = _safe_extension(content_type, filename)
    key = f"{scope}/{scope_id}/avatar-{ts}{ext}"

    async with _client() as s3:
        await s3.put_object(
            Bucket=settings.minio_branding_bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl="public, max-age=31536000, immutable",
        )

    base = settings.minio_public_endpoint.rstrip("/")
    return f"{base}/{settings.minio_branding_bucket}/{key}"
