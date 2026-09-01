"""Config flow for HA Light Panel.

The integration has exactly one setting — where the panel is listening — so the
flow is a single form. YAML setups are imported once and then managed here.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import CONF_UPSTREAM, DEFAULT_UPSTREAM, DOMAIN


class HaLightPanelConfigFlow(ConfigFlow, domain=DOMAIN):
    """Ask for the upstream URL, once."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle a flow started from the UI."""
        # One panel per Home Assistant; a second entry would just register the
        # same view again.
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        if user_input is not None:
            return self.async_create_entry(title="HA Light Panel", data=user_input)

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {vol.Optional(CONF_UPSTREAM, default=DEFAULT_UPSTREAM): str}
            ),
        )

    async def async_step_import(self, import_data: dict[str, Any]) -> ConfigFlowResult:
        """Import a YAML configuration."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        return self.async_create_entry(title="HA Light Panel", data=import_data)
