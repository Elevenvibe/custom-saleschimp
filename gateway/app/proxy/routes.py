"""HTTP reverse proxy to Dograh's UI and API.

Mounted last so explicit gateway routes (/healthz, /api/auth/*, /api/admin/*,
/api/x/*) win. Anything else falls through to here.

Routing rule:
    /api/v1/*  -> Dograh API
    everything else -> Dograh UI (Next.js)

WebSocket upgrade is NOT proxied yet — webrtc_signaling on /api/v1/ws/* should
hit the API directly until P0+ adds ws:// support. Tracked as a known gap.
"""

from collections.abc import AsyncIterator

import httpx
from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.config import settings

router = APIRouter()

# Headers that must not be forwarded (hop-by-hop or set by the proxy stack).
_HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}


def _select_upstream(path: str) -> str:
    if path.startswith("api/v1") or path == "api/v1":
        return settings.dograh_api_url
    return settings.dograh_ui_url


def _filter_headers(headers) -> dict[str, str]:
    return {k: v for k, v in headers.items() if k.lower() not in _HOP_BY_HOP}


async def _iter_body(response: httpx.Response) -> AsyncIterator[bytes]:
    async for chunk in response.aiter_raw():
        yield chunk


@router.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    include_in_schema=False,
)
async def proxy(path: str, request: Request) -> StreamingResponse:
    upstream = _select_upstream(path)
    target_url = f"{upstream.rstrip('/')}/{path}"

    timeout = httpx.Timeout(
        connect=settings.proxy_connect_timeout,
        read=settings.proxy_read_timeout,
        write=settings.proxy_read_timeout,
        pool=settings.proxy_read_timeout,
    )

    body = await request.body()

    try:
        client = httpx.AsyncClient(timeout=timeout, follow_redirects=False)
        upstream_req = client.build_request(
            method=request.method,
            url=target_url,
            params=request.query_params,
            headers=_filter_headers(request.headers),
            content=body if body else None,
        )
        response = await client.send(upstream_req, stream=True)
    except httpx.ConnectError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"upstream connect failed: {e}",
        ) from e
    except httpx.ReadTimeout as e:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="upstream read timeout",
        ) from e

    out_headers = _filter_headers(response.headers)

    async def stream_and_close():
        try:
            async for chunk in response.aiter_raw():
                yield chunk
        finally:
            await response.aclose()
            await client.aclose()

    return StreamingResponse(
        stream_and_close(),
        status_code=response.status_code,
        headers=out_headers,
        media_type=response.headers.get("content-type"),
    )
