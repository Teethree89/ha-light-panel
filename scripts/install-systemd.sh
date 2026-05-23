#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ha-light-panel}"
ENV_FILE="${ENV_FILE:-/etc/ha-light-panel.env}"
SERVICE_FILE="/etc/systemd/system/ha-light-panel.service"
SERVICE_USER="${SERVICE_USER:-ha-light-panel}"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo scripts/install-systemd.sh" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install nodejs first." >&2
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$SERVICE_USER"
fi

mkdir -p "$APP_DIR"
install -m 0644 server.js package.json "$APP_DIR/"
mkdir -p "$APP_DIR/examples"
install -m 0644 examples/frameo-climate.json "$APP_DIR/examples/"

if [[ ! -f "$APP_DIR/config.json" ]]; then
  install -m 0644 examples/frameo-climate.json "$APP_DIR/config.json"
  echo "Created $APP_DIR/config.json from the example. Edit it for your HA entities."
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cat >"$ENV_FILE" <<EOF
HOST=0.0.0.0
PORT=8890
POLL_MS=2000
CONFIG_PATH=$APP_DIR/config.json
HA_URL=http://homeassistant.local:8123
HA_BROWSER_URL=http://homeassistant.local:8123
HA_TOKEN=replace-with-a-home-assistant-long-lived-access-token
EOF
  chmod 0600 "$ENV_FILE"
  echo "Created $ENV_FILE. Edit HA_URL and HA_TOKEN before starting the service."
fi

install -m 0644 systemd/ha-light-panel.service "$SERVICE_FILE"
sed -i "s#WorkingDirectory=/opt/ha-light-panel#WorkingDirectory=$APP_DIR#" "$SERVICE_FILE"
sed -i "s#EnvironmentFile=/etc/ha-light-panel.env#EnvironmentFile=$ENV_FILE#" "$SERVICE_FILE"
sed -i "s#ExecStart=/usr/bin/node /opt/ha-light-panel/server.js#ExecStart=$(command -v node) $APP_DIR/server.js#" "$SERVICE_FILE"

chown -R root:root "$APP_DIR"
systemctl daemon-reload
systemctl enable ha-light-panel.service

echo "Installed ha-light-panel."
echo "Next:"
echo "  1. Edit $ENV_FILE and set HA_TOKEN."
echo "  2. Edit $APP_DIR/config.json."
echo "  3. Run: systemctl start ha-light-panel"
