"""HA Light Panel reverse-proxy integration.

Exposes a LAN-only panel (default port 8890) through Home Assistant core at
``/api/ha_light_panel/`` so it is reachable wherever HA itself is — including
Nabu Casa Cloud, which only tunnels HA core on port 8123.

Configurable from the UI, or from YAML:

    ha_light_panel:
      upstream: http://127.0.0.1:8890
"""

from __future__ import annotations

import voluptuous as vol

from homeassistant.components import panel_custom
import homeassistant.helpers.config_validation as cv
from homeassistant.config_entries import ConfigEntry, SOURCE_IMPORT
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

from .const import (
    CONF_UPSTREAM,
    DEFAULT_UPSTREAM,
    DOMAIN,
    SIDEBAR_PANEL_MODULE_URL,
    SIDEBAR_PANEL_PATH,
)
from .views import async_register_assets, async_register_views

CONFIG_SCHEMA = vol.Schema(
    {
        vol.Optional(DOMAIN): vol.Any(
            None,
            vol.Schema(
                {vol.Optional(CONF_UPSTREAM, default=DEFAULT_UPSTREAM): cv.string}
            ),
        )
    },
    extra=vol.ALLOW_EXTRA,
)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Import a YAML configuration into a config entry."""
    async_register_assets(hass)
    await _async_register_sidebar_panel(hass)
    if DOMAIN not in config:
        return True

    conf = config[DOMAIN] or {}
    hass.async_create_task(
        hass.config_entries.flow.async_init(
            DOMAIN,
            context={"source": SOURCE_IMPORT},
            data={CONF_UPSTREAM: conf.get(CONF_UPSTREAM, DEFAULT_UPSTREAM)},
        )
    )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Register the reverse-proxy view."""
    await _async_register_sidebar_panel(hass)
    async_register_views(hass, entry.data.get(CONF_UPSTREAM, DEFAULT_UPSTREAM))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload the entry.

    Home Assistant has no API for removing a registered HTTP view, so the proxy
    view stays until the next restart. Report success anyway: the entry really
    is gone, and a restart clears the view.
    """
    return True


async def _async_register_sidebar_panel(hass: HomeAssistant) -> None:
    """Put the panel overview and builder behind one HA sidebar entry."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("_sidebar_panel_registered"):
        return

    # The panel's own overview and builder stay independently reachable at the
    # ingress URLs. This custom panel only provides native HA navigation and
    # keeps the sidebar visible while either page is open.
    from homeassistant.loader import async_get_integration

    integration = await async_get_integration(hass, DOMAIN)
    version = str(integration.version or "0")
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=SIDEBAR_PANEL_PATH,
        webcomponent_name="ha-light-panel-sidebar",
        sidebar_title="HA Light Panel",
        sidebar_icon="mdi:view-dashboard-edit-outline",
        module_url=f"{SIDEBAR_PANEL_MODULE_URL}?v={version}",
        require_admin=True,
    )
    domain_data["_sidebar_panel_registered"] = True
