#!/usr/bin/with-contenv bashio

export HOST="0.0.0.0"
export PORT="$(bashio::config 'port')"
export POLL_MS="$(bashio::config 'poll_ms')"
export HA_TOKEN="$(bashio::config 'ha_token')"
export HA_URL="$(bashio::config 'ha_url')"

if bashio::config.has_value 'ha_browser_url'; then
  export HA_BROWSER_URL="$(bashio::config 'ha_browser_url')"
fi

# Point the panel at a config file in the Home Assistant config directory, so
# entity mapping is editable from the File editor add-on. Without one the panel
# falls back to its built-in reference layout.
if bashio::config.has_value 'config_path'; then
  CONFIG_PATH="$(bashio::config 'config_path')"
  if [ -f "$CONFIG_PATH" ]; then
    export CONFIG_PATH
    bashio::log.info "Using panel config: ${CONFIG_PATH}"
  else
    bashio::log.warning "No panel config at ${CONFIG_PATH}; using built-in defaults."
    bashio::log.warning "Copy examples/frameo-climate.json there and edit it for your entities."
  fi
fi

bashio::log.info "Starting HA Light Panel on port ${PORT}..."
exec node /app/server.js
