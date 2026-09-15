"""Reverse-proxy HTTP view for the wall panel."""

from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import urlparse

from aiohttp import ClientError, ClientTimeout, web

from homeassistant.components.http import HomeAssistantView, require_admin
from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import ASSET_URL_BASE, CONF_UPSTREAM, DEFAULT_UPSTREAM, DOMAIN, INGRESS_PATH

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
    hass.http.register_view(HaLightPanelSidebarStatusView(hass))
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


def _entry(hass: HomeAssistant):
    """Return the single configured panel entry, if there is one."""
    entries = hass.config_entries.async_entries(DOMAIN)
    return entries[0] if entries else None


def _valid_upstream(value: object) -> str | None:
    """Accept only a complete HTTP(S) URL from the admin setup form."""
    upstream = str(value or "").strip().rstrip("/")
    parsed = urlparse(upstream)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return upstream


async def _probe_upstream(hass: HomeAssistant, upstream: str) -> dict:
    """Tell setup apart from a panel process that is merely unhealthy in HA."""
    try:
        async with async_get_clientsession(hass).get(
            f"{upstream}/health", timeout=ClientTimeout(total=3)
        ) as response:
            # /health is intentionally 503 when the panel is missing an HA
            # token. That is still a running panel, and its offline builder is
            # useful, so both documented health codes prove the URL is right.
            if response.status not in {200, 503}:
                return {"reachable": False, "detail": f"HTTP {response.status}"}
            payload = await response.json(content_type=None)
            if not isinstance(payload, dict) or "pollMs" not in payload:
                return {"reachable": False, "detail": "This is not an HA Light Panel service."}
            return {"reachable": True, "detail": "Panel service is reachable."}
    except (ClientError, TimeoutError, ValueError) as err:
        return {"reachable": False, "detail": str(err) or "Connection failed."}


def _addon_candidates(hass: HomeAssistant) -> list[dict[str, str]]:
    """Offer a real Supervisor add-on hostname when HAOS can name one."""
    try:
        from homeassistant.components.hassio import get_addons_info  # type: ignore[import-not-found]

        addons = get_addons_info(hass)
    except Exception:  # noqa: BLE001 - no Supervisor on Container/Core installs
        return []

    candidates = []
    for slug, info in addons.items():
        if not info:
            continue
        name = str(info.get("name") or "")
        if slug.endswith("ha_light_panel") or name == "HA Light Panel":
            options = info.get("options") or {}
            port = options.get("port", 8890)
            candidates.append(
                {
                    "label": f"Detected HA Light Panel add-on ({name or slug})",
                    # Supervisor's DNS name is the add-on slug with valid
                    # hostname separators; its repo prefix makes the address
                    # unique even when several third-party add-ons share a
                    # short name.
                    "url": f"http://{slug.replace('_', '-')}:{port}",
                }
            )
    return candidates


class HaLightPanelSidebarStatusView(HomeAssistantView):
    """Give the authenticated sidebar an actionable connection diagnosis."""

    requires_auth = True
    url = f"{INGRESS_PATH}/sidebar-status"
    name = "api:ha_light_panel:sidebar_status"

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    @require_admin
    async def get(self, _request: web.Request) -> web.Response:
        entry = _entry(self.hass)
        upstream = _valid_upstream(entry.data.get(CONF_UPSTREAM)) if entry else ""
        probe = await _probe_upstream(self.hass, upstream) if upstream else {
            "reachable": False,
            "detail": "The integration has not been configured yet.",
        }
        return web.json_response(
            {
                "configured": entry is not None,
                "upstream": upstream,
                "entry_state": str(entry.state) if entry else "not_configured",
                "reachable": probe["reachable"],
                "detail": probe["detail"],
                "default_upstream": DEFAULT_UPSTREAM,
                "candidates": _addon_candidates(self.hass),
            }
        )

    @require_admin
    async def post(self, request: web.Request) -> web.Response:
        """Create the entry, or save a corrected URL for the next restart."""
        try:
            payload = await request.json()
        except (ValueError, web.HTTPException):
            raise web.HTTPBadRequest(text="Expected a JSON setup request.\n")
        upstream = _valid_upstream(payload.get("upstream") if isinstance(payload, dict) else None)
        if not upstream:
            raise web.HTTPBadRequest(text="Enter a full URL, such as http://127.0.0.1:8890.\n")

        entry = _entry(self.hass)
        if entry is None:
            await self.hass.config_entries.flow.async_init(
                DOMAIN,
                context={"source": SOURCE_USER},
                data={CONF_UPSTREAM: upstream},
            )
            return web.json_response(
                {"saved": True, "restart_required": False, "upstream": upstream}
            )

        self.hass.config_entries.async_update_entry(
            entry, data={**entry.data, CONF_UPSTREAM: upstream}
        )
        # The registered aiohttp proxy captures its upstream address. HA core
        # has no public API to remove that route, so applying a correction to
        # an existing entry requires the same restart documented for removal.
        return web.json_response(
            {"saved": True, "restart_required": True, "upstream": upstream}
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
