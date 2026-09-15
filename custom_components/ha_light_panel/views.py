"""Reverse-proxy HTTP view for the wall panel."""

from __future__ import annotations

import logging
from pathlib import Path

from aiohttp import ClientError, ClientTimeout, web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import ASSET_URL_BASE, DOMAIN, INGRESS_PATH

LOGGER = logging.getLogger(__name__)
FRONTEND_ROOT = Path(__file__).parent / "frontend"

# Hop-by-hop headers (and a few aiohttp manages itself) must not be relayed.
_SKIP_REQUEST_HEADERS = {
    "host",
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "upgrade",
}
# aiohttp transparently decompresses the upstream body, so the original
# content-encoding/length no longer describe what we forward.
_SKIP_RESPONSE_HEADERS = _SKIP_REQUEST_HEADERS | {"content-encoding"}


def async_register_views(hass: HomeAssistant, upstream: str) -> None:
    """Register the browser-facing reverse-proxy view (once)."""
    if hass.data.setdefault(DOMAIN, {}).get("_view_registered"):
        return
    async_register_assets(hass)
    hass.http.register_view(HaLightPanelProxyView(hass, upstream))
    hass.data[DOMAIN]["_view_registered"] = True


def async_register_assets(hass: HomeAssistant) -> None:
    """Register static integration assets before the sidebar module loads."""
    if hass.data.setdefault(DOMAIN, {}).get("_assets_registered"):
        return
    hass.http.register_view(HaLightPanelAssetView())
    hass.data[DOMAIN]["_assets_registered"] = True


class HaLightPanelAssetView(HomeAssistantView):
    """Serve the HA sidebar module without proxying it to the panel server."""

    requires_auth = False
    url = f"{ASSET_URL_BASE}/{{filename}}"
    name = "api:ha_light_panel:assets"

    _content_types = {"ha-light-panel-sidebar.js": "application/javascript"}

    async def get(self, _request: web.Request, filename: str) -> web.FileResponse:
        """Return an allow-listed frontend asset."""
        if filename not in self._content_types:
            raise web.HTTPNotFound()
        asset = FRONTEND_ROOT / filename
        if not asset.is_file():
            raise web.HTTPNotFound(text=f"Missing frontend asset: {filename}\n")
        return web.FileResponse(
            asset,
            headers={
                "Cache-Control": "no-cache",
                "Content-Type": self._content_types[filename],
            },
        )


class HaLightPanelProxyView(HomeAssistantView):
    """Proxy the LAN-only panel through HA core for remote access.

    Unauthenticated to match the existing ``blink_liveview_proxy`` views; this
    surfaces the same camera/climate data those already expose. The live-view
    stream and push-to-talk live at ``/api/blink_liveview_proxy/*`` and are hit
    directly on the HA origin, so this view only needs plain HTTP (no
    websocket bridging).
    """

    requires_auth = False
    url = f"{INGRESS_PATH}/{{requested_path:.*}}"
    extra_urls = [INGRESS_PATH]
    name = f"api:{DOMAIN}"

    def __init__(self, hass: HomeAssistant, upstream: str) -> None:
        self.hass = hass
        self._upstream = upstream.rstrip("/")

    async def get(
        self, request: web.Request, requested_path: str = ""
    ) -> web.StreamResponse:
        """Proxy a GET request."""
        return await self._proxy(request, requested_path)

    async def post(
        self, request: web.Request, requested_path: str = ""
    ) -> web.StreamResponse:
        """Proxy a POST request."""
        return await self._proxy(request, requested_path)

    async def _proxy(
        self, request: web.Request, requested_path: str
    ) -> web.StreamResponse:
        session = async_get_clientsession(self.hass)
        target = f"{self._upstream}/{requested_path.lstrip('/')}"
        if request.query_string:
            target = f"{target}?{request.query_string}"

        headers = {
            key: value
            for key, value in request.headers.items()
            if key.lower() not in _SKIP_REQUEST_HEADERS
        }
        # Tell the panel which prefix the browser sees so it can rewrite its
        # own links and fetches to stay under the ingress path.
        headers["X-Ingress-Path"] = INGRESS_PATH

        body = await request.read() if request.body_exists else None

        try:
            upstream = await session.request(
                request.method,
                target,
                headers=headers,
                data=body,
                allow_redirects=False,
                timeout=ClientTimeout(total=None, sock_connect=10, sock_read=120),
            )
        except ClientError as err:
            LOGGER.warning("Panel proxy failed for %s: %s", target, err)
            raise web.HTTPBadGateway(text="The panel is unreachable\n")

        response = web.StreamResponse(status=upstream.status)
        for key, value in upstream.headers.items():
            if key.lower() not in _SKIP_RESPONSE_HEADERS:
                response.headers[key] = value
        await response.prepare(request)
        try:
            async for chunk in upstream.content.iter_chunked(64 * 1024):
                await response.write(chunk)
        finally:
            upstream.release()
        await response.write_eof()
        return response
