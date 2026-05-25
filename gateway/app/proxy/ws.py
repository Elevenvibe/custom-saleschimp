"""WebSocket reverse proxy to the Dograh API.

Bridges client ↔ Dograh on `/api/v1/ws/*` (and any other ws endpoint under
`/api/v1/`). Mirrors the HTTP proxy's routing rule.

The bridge accepts the incoming ws, opens an upstream ws, then runs two
forwarding tasks concurrently — when either side closes, the other is torn
down. Binary and text frames are both handled.
"""

from __future__ import annotations

import asyncio
from urllib.parse import urlencode

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from starlette.websockets import WebSocketState
from websockets import ConnectionClosed, InvalidHandshake
from websockets.asyncio.client import connect as ws_connect

from app.config import settings

log = structlog.get_logger()

router = APIRouter()

# Only forward headers that carry user identity / state. Everything else
# (Host, Connection, Upgrade, Sec-WebSocket-*, Accept-Encoding, Cache-Control,
# Pragma, User-Agent, …) is set by the websockets client itself or is harmless
# noise that can confuse upstream middleware. Forwarding less = fewer 403s.
_FORWARD_HEADERS = {
    "authorization",
    "cookie",
    "x-forwarded-for",
    "x-forwarded-proto",
    "x-real-ip",
    "x-request-id",
}


def _build_upstream_url(path: str, query: str) -> str:
    """`path` is captured by the `/api/v1/{path:path}` route and does NOT
    include the `/api/v1/` prefix — Dograh mounts its routes under that
    prefix so we have to add it back when forming the upstream URL."""
    base = settings.dograh_api_url.rstrip("/")
    # Translate http(s) -> ws(s)
    if base.startswith("https://"):
        base = "wss://" + base[len("https://") :]
    elif base.startswith("http://"):
        base = "ws://" + base[len("http://") :]
    url = f"{base}/api/v1/{path}"
    if query:
        url = f"{url}?{query}"
    return url


@router.websocket("/api/v1/{path:path}")
async def ws_proxy(client_ws: WebSocket, path: str) -> None:
    # Forward subprotocols + filtered headers to the upstream handshake.
    subprotocols = client_ws.headers.get("sec-websocket-protocol")
    sub_list = (
        [p.strip() for p in subprotocols.split(",")] if subprotocols else None
    )
    fwd_headers = [
        (k, v)
        for k, v in client_ws.headers.items()
        if k.lower() in _FORWARD_HEADERS
    ]

    query_string = client_ws.url.query
    upstream_url = _build_upstream_url(path, query_string)

    try:
        upstream = await ws_connect(
            upstream_url,
            additional_headers=fwd_headers,
            subprotocols=sub_list,
            open_timeout=settings.proxy_connect_timeout,
            max_size=None,  # let Dograh enforce its own limits
        )
    except (OSError, InvalidHandshake) as e:
        log.warning("ws_proxy.upstream_connect_failed", path=path, error=str(e))
        await client_ws.close(code=status.WS_1011_INTERNAL_ERROR)
        return

    # Accept the client now that we have an upstream. If the upstream negotiated
    # a subprotocol, mirror it back to the client.
    await client_ws.accept(subprotocol=upstream.subprotocol)

    # Track the upstream's final close code/reason so we can mirror it to
    # the client. Dograh signals errors via close codes (e.g. 1008 "workflow
    # not found", 1011 "not implemented") and they're meaningless to debug
    # if the proxy swallows them.
    upstream_close: dict[str, object] = {"code": 1000, "reason": ""}

    async def client_to_upstream() -> None:
        try:
            while True:
                msg = await client_ws.receive()
                if msg["type"] == "websocket.disconnect":
                    return
                if "text" in msg and msg["text"] is not None:
                    await upstream.send(msg["text"])
                elif "bytes" in msg and msg["bytes"] is not None:
                    await upstream.send(msg["bytes"])
        except WebSocketDisconnect:
            return
        except ConnectionClosed:
            return

    async def upstream_to_client() -> None:
        try:
            async for msg in upstream:
                if isinstance(msg, bytes):
                    await client_ws.send_bytes(msg)
                else:
                    await client_ws.send_text(msg)
        except ConnectionClosed as e:
            upstream_close["code"] = e.code or 1011
            upstream_close["reason"] = e.reason or ""
            return

    pump1 = asyncio.create_task(client_to_upstream())
    pump2 = asyncio.create_task(upstream_to_client())

    done, pending = await asyncio.wait(
        {pump1, pump2}, return_when=asyncio.FIRST_COMPLETED
    )
    for t in pending:
        t.cancel()
    try:
        await upstream.close()
    except Exception:
        pass
    if client_ws.client_state != WebSocketState.DISCONNECTED:
        try:
            await client_ws.close(
                code=int(upstream_close["code"]),
                reason=str(upstream_close["reason"]),
            )
        except Exception:
            pass
