"""Constants for the HA Light Panel reverse-proxy integration."""

DOMAIN = "ha_light_panel"

# Path prefix the browser sees. The panel (server.js) reads this from the
# X-Ingress-Path header and makes all of its own links and fetches absolute
# under it, so one relative dashboard link works on the LAN and remotely.
INGRESS_PATH = "/api/ha_light_panel"

# Where the panel actually listens. Home Assistant Container runs with host
# networking, so 127.0.0.1:8890 reaches a panel running under systemd on the
# same host directly.
DEFAULT_UPSTREAM = "http://127.0.0.1:8890"

CONF_UPSTREAM = "upstream"
