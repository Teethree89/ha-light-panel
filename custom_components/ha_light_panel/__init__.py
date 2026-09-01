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

import homeassistant.helpers.config_validation as cv
from homeassistant.config_entries import ConfigEntry, SOURCE_IMPORT
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

from .const import CONF_UPSTREAM, DEFAULT_UPSTREAM, DOMAIN
from .views import async_register_views

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
    async_register_views(hass, entry.data.get(CONF_UPSTREAM, DEFAULT_UPSTREAM))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload the entry.

    Home Assistant has no API for removing a registered HTTP view, so the proxy
    view stays until the next restart. Report success anyway: the entry really
    is gone, and a restart clears the view.
    """
    return True
