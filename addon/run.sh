#!/usr/bin/with-contenv bashio

export HOST="0.0.0.0"
export PORT="$(bashio::config 'port')"
export POLL_MS="$(bashio::config 'poll_ms')"
export HA_TOKEN="$(bashio::config 'ha_token')"
export HA_URL="$(bashio::config 'ha_url')"

if bashio::config.has_value 'ha_browser_url'; then
  export HA_BROWSER_URL="$(bashio::config 'ha_browser_url')"
fi

bashio::log.info "Starting HA Light Panel on port ${PORT}..."
exec node /app/server.js
