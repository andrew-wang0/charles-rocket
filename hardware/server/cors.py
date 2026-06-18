from __future__ import annotations

from typing import Any

from aiohttp import web

PRIVATE_NETWORK_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Private-Network": "true",
}


def private_network_cors_header_list() -> list[tuple[str, str]]:
    return list(PRIVATE_NETWORK_CORS_HEADERS.items())


async def websocket_process_request(_path: str, request_headers: Any) -> tuple[int, list[tuple[str, str]], bytes] | None:
    if request_headers.get("Access-Control-Request-Private-Network", "").lower() != "true":
        return None

    return 204, private_network_cors_header_list(), b""


@web.middleware
async def private_network_cors_middleware(request: web.Request, handler: Any) -> web.StreamResponse:
    if request.method == "OPTIONS":
        return web.Response(status=204, headers=PRIVATE_NETWORK_CORS_HEADERS)

    response = await handler(request)
    for key, value in PRIVATE_NETWORK_CORS_HEADERS.items():
        response.headers[key] = value
    return response
