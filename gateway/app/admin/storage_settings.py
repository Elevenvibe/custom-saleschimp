"""Super-admin Storage Settings.

  GET  /api/admin/storage-settings        catalog + current config + env preview
  PUT  /api/admin/storage-settings        select backend + save its credentials
  POST /api/admin/storage-settings/test    validate connectivity (head_bucket)

Dograh stores user files (call recordings, audio) on a single platform-wide
storage backend selected via environment variables, resolved at process
start (see dograh/api/services/storage.py — ENABLE_AWS_S3 + S3_*/MINIO_*).

This page is the control-plane home for that config: the super-admin picks a
backend and enters its keys here (Fernet-encrypted at rest), and we render
the exact env-var block Dograh needs. Applying it to the running Dograh
process is an env change + restart — live propagation (Dograh reading this
config from the control DB) is the documented follow-up, consistent with the
gateway-owns-the-control-plane boundary used elsewhere.

Backends listed match Dograh's filesystem implementations: S3 + MinIO are
live; GCS + Azure are on Dograh's roadmap and shown as not-yet-available.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

import aioboto3
import structlog
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.deps import require_super_admin
from app.auth.models import PlatformSetting
from app.db import get_session
from app.email.crypto import decrypt_dict, encrypt_dict

log = structlog.get_logger()

router = APIRouter(prefix="/storage-settings", tags=["admin:storage-settings"])

_KEY = "storage"
_MASK = "••••••••"

Backend = Literal["s3", "minio"]


# Catalog mirrors dograh/api/services/filesystem implementations + roadmap.
BACKENDS_CATALOG = [
    {
        "key": "s3",
        "name": "Amazon S3",
        "description": "AWS S3 (or any S3-compatible cloud bucket). Recommended for production.",
        "available": True,
    },
    {
        "key": "minio",
        "name": "MinIO",
        "description": "Self-hosted, S3-compatible object storage. Ships with local/OSS deployments.",
        "available": True,
    },
    {
        "key": "gcs",
        "name": "Google Cloud Storage",
        "description": "On Dograh's roadmap — not yet available.",
        "available": False,
    },
    {
        "key": "azure",
        "name": "Azure Blob Storage",
        "description": "On Dograh's roadmap — not yet available.",
        "available": False,
    },
]


# ---- IO shapes ------------------------------------------------------------


class S3Config(BaseModel):
    bucket: str = ""
    region: str = "us-east-1"
    access_key_id: str = ""
    has_secret: bool = False


class MinioConfig(BaseModel):
    endpoint: str = ""
    public_endpoint: str = ""
    bucket: str = "voice-audio"
    access_key: str = ""
    secure: bool = False
    has_secret: bool = False


class StorageOut(BaseModel):
    backend: Backend
    catalog: list[dict[str, Any]]
    s3: S3Config
    minio: MinioConfig
    # The env-var block Dograh consumes for the selected backend. Secret
    # values are masked — operators paste their own secret in.
    env_preview: dict[str, str]


# ---- helpers --------------------------------------------------------------


async def _row(session: AsyncSession) -> PlatformSetting | None:
    return (
        await session.execute(select(PlatformSetting).where(PlatformSetting.key == _KEY))
    ).scalar_one_or_none()


async def _value(session: AsyncSession) -> dict[str, Any]:
    row = await _row(session)
    return dict(row.value) if row and row.value else {}


def _secret(cfg: dict[str, Any]) -> str | None:
    enc = cfg.get("secret_enc")
    if not enc:
        return None
    try:
        return decrypt_dict(enc).get("secret")
    except Exception:  # noqa: BLE001
        return None


def _env_preview(value: dict[str, Any]) -> dict[str, str]:
    backend = value.get("backend") or "minio"
    if backend == "s3":
        s3 = value.get("s3") or {}
        has_secret = bool(s3.get("secret_enc"))
        return {
            "ENABLE_AWS_S3": "true",
            "S3_BUCKET": s3.get("bucket") or "",
            "S3_REGION": s3.get("region") or "us-east-1",
            "AWS_ACCESS_KEY_ID": s3.get("access_key_id") or "",
            "AWS_SECRET_ACCESS_KEY": _MASK if has_secret else "",
        }
    minio = value.get("minio") or {}
    has_secret = bool(minio.get("secret_enc"))
    return {
        "ENABLE_AWS_S3": "false",
        "MINIO_ENDPOINT": minio.get("endpoint") or "minio:9000",
        "MINIO_PUBLIC_ENDPOINT": minio.get("public_endpoint") or "",
        "MINIO_BUCKET": minio.get("bucket") or "voice-audio",
        "MINIO_ACCESS_KEY": minio.get("access_key") or "",
        "MINIO_SECRET_KEY": _MASK if has_secret else "",
        "MINIO_SECURE": "true" if minio.get("secure") else "false",
    }


def _serialize(value: dict[str, Any]) -> StorageOut:
    s3 = value.get("s3") or {}
    minio = value.get("minio") or {}
    return StorageOut(
        backend=value.get("backend") or "minio",  # type: ignore[arg-type]
        catalog=BACKENDS_CATALOG,
        s3=S3Config(
            bucket=s3.get("bucket") or "",
            region=s3.get("region") or "us-east-1",
            access_key_id=s3.get("access_key_id") or "",
            has_secret=bool(s3.get("secret_enc")),
        ),
        minio=MinioConfig(
            endpoint=minio.get("endpoint") or "",
            public_endpoint=minio.get("public_endpoint") or "",
            bucket=minio.get("bucket") or "voice-audio",
            access_key=minio.get("access_key") or "",
            secure=bool(minio.get("secure")),
            has_secret=bool(minio.get("secret_enc")),
        ),
        env_preview=_env_preview(value),
    )


def _uid(claims: dict) -> int | None:
    sub = claims.get("sub", "")
    if isinstance(sub, str) and sub.startswith("p_"):
        try:
            return int(sub[2:])
        except ValueError:
            return None
    return None


# ---- routes ---------------------------------------------------------------


@router.get("", response_model=StorageOut)
async def get_storage(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> StorageOut:
    return _serialize(await _value(session))


class S3In(BaseModel):
    bucket: str = ""
    region: str = "us-east-1"
    access_key_id: str = ""
    secret_access_key: str | None = None  # write-only


class MinioIn(BaseModel):
    endpoint: str = ""
    public_endpoint: str = ""
    bucket: str = "voice-audio"
    access_key: str = ""
    secret_key: str | None = None  # write-only
    secure: bool = False


class StorageIn(BaseModel):
    backend: Backend
    s3: S3In | None = None
    minio: MinioIn | None = None


@router.put("", response_model=StorageOut)
async def put_storage(
    body: StorageIn,
    claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> StorageOut:
    value = await _value(session)
    value["backend"] = body.backend

    if body.s3 is not None:
        s3 = dict(value.get("s3") or {})
        s3.update(
            {
                "bucket": body.s3.bucket.strip(),
                "region": (body.s3.region or "us-east-1").strip(),
                "access_key_id": body.s3.access_key_id.strip(),
            }
        )
        if body.s3.secret_access_key:
            s3["secret_enc"] = encrypt_dict({"secret": body.s3.secret_access_key})
        value["s3"] = s3

    if body.minio is not None:
        minio = dict(value.get("minio") or {})
        minio.update(
            {
                "endpoint": body.minio.endpoint.strip(),
                "public_endpoint": body.minio.public_endpoint.strip(),
                "bucket": (body.minio.bucket or "voice-audio").strip(),
                "access_key": body.minio.access_key.strip(),
                "secure": bool(body.minio.secure),
            }
        )
        if body.minio.secret_key:
            minio["secret_enc"] = encrypt_dict({"secret": body.minio.secret_key})
        value["minio"] = minio

    row = await _row(session)
    if row is None:
        session.add(PlatformSetting(key=_KEY, value=value))
    else:
        row.value = value

    await record_audit(
        session, actor_kind="platform", actor_user_id=_uid(claims),
        action="admin.storage.update", target_kind="platform_setting",
        target_id=_KEY, payload={"backend": body.backend},
    )
    await session.commit()
    return _serialize(value)


class TestOut(BaseModel):
    ok: bool
    backend: str
    detail: str


@router.post("/test", response_model=TestOut)
async def test_storage(
    _claims: Annotated[dict, Depends(require_super_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TestOut:
    """Validate the SAVED config for the selected backend by issuing a
    head_bucket against it. Save before testing."""
    value = await _value(session)
    backend = value.get("backend") or "minio"

    if backend == "s3":
        s3 = value.get("s3") or {}
        bucket = s3.get("bucket")
        secret = _secret(s3)
        if not (bucket and s3.get("access_key_id") and secret):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "S3 bucket + access key + secret required")
        sess = aioboto3.Session(
            aws_access_key_id=s3["access_key_id"], aws_secret_access_key=secret,
        )
        client_kwargs: dict[str, Any] = {
            "region_name": s3.get("region") or "us-east-1",
            "config": BotoConfig(connect_timeout=6, read_timeout=6, retries={"max_attempts": 1}),
        }
    else:
        minio = value.get("minio") or {}
        bucket = minio.get("bucket")
        endpoint = minio.get("endpoint")
        secret = _secret(minio)
        if not (bucket and endpoint and minio.get("access_key") and secret):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "MinIO endpoint + bucket + access key + secret required"
            )
        scheme = "https" if minio.get("secure") else "http"
        sess = aioboto3.Session(
            aws_access_key_id=minio["access_key"], aws_secret_access_key=secret,
        )
        client_kwargs = {
            "endpoint_url": f"{scheme}://{endpoint}",
            "region_name": "us-east-1",
            "config": BotoConfig(connect_timeout=6, read_timeout=6, retries={"max_attempts": 1}),
        }

    try:
        async with sess.client("s3", **client_kwargs) as s3c:
            await s3c.head_bucket(Bucket=bucket)
        return TestOut(ok=True, backend=backend, detail=f"Connected — bucket '{bucket}' is reachable.")
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in {"404", "NoSuchBucket", "NotFound"}:
            return TestOut(ok=False, backend=backend, detail=f"Credentials OK but bucket '{bucket}' was not found.")
        if code in {"403", "AccessDenied", "Forbidden"}:
            return TestOut(ok=False, backend=backend, detail="Access denied — check the keys and bucket policy.")
        return TestOut(ok=False, backend=backend, detail=f"Storage error: {code or e}")
    except (BotoCoreError, OSError) as e:
        return TestOut(ok=False, backend=backend, detail=f"Could not reach storage: {e}")
