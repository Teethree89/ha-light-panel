#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${APP_DIR:-/opt/ha-light-panel}"
ENV_FILE="${ENV_FILE:-/etc/ha-light-panel.env}"
SERVICE_NAME="${SERVICE_NAME:-ha-light-panel}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
UPDATE_SERVICE_NAME="${SERVICE_NAME}-update"
UPDATE_PATH_NAME="${SERVICE_NAME}-update.path"
UPDATE_TIMER_NAME="${SERVICE_NAME}-update.timer"
UPDATE_SERVICE_FILE="/etc/systemd/system/${UPDATE_SERVICE_NAME}.service"
UPDATE_PATH_FILE="/etc/systemd/system/${UPDATE_PATH_NAME}"
UPDATE_TIMER_FILE="/etc/systemd/system/${UPDATE_TIMER_NAME}"
UPDATE_SCRIPT="/usr/local/sbin/${SERVICE_NAME}-update.sh"
STATE_DIR="${STATE_DIR:-/var/lib/${SERVICE_NAME}}"
UPDATE_REQUEST_PATH="${UPDATE_REQUEST_PATH:-$STATE_DIR/update.request}"
SRC_DIR="${SRC_DIR:-$ROOT}"
UPDATE_ENV_FILE="/etc/${SERVICE_NAME}/update.env"
SERVICE_USER="${SERVICE_USER:-ha-light-panel}"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo scripts/install-systemd.sh" >&2
  exit 1
fi

# An older deployment may deliberately rely on the server's built-in layout
# rather than a config.json. Record that before installing the new code so an
# adoption never turns a working default layout into the starter example.
EXISTING_APP=0
[[ -f "$APP_DIR/server.js" ]] && EXISTING_APP=1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install nodejs first." >&2
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$SERVICE_USER"
fi

mkdir -p "$APP_DIR" "$STATE_DIR" "$(dirname "$UPDATE_ENV_FILE")"
install -m 0644 "$ROOT/server.js" "$ROOT/package.json" "$APP_DIR/"
mkdir -p "$APP_DIR/examples"
install -m 0644 "$ROOT/examples/frameo-climate.json" "$APP_DIR/examples/"

if [[ ! -f "$APP_DIR/config.json" && "$EXISTING_APP" != "1" ]]; then
  install -m 0644 "$ROOT/examples/frameo-climate.json" "$APP_DIR/config.json"
  echo "Created $APP_DIR/config.json from the example. Edit it for your HA entities."
elif [[ ! -f "$APP_DIR/config.json" ]]; then
  # Legacy installations commonly rendered DEFAULT_CONFIG directly. Capture
  # that exact layout before replacing server.js, so adoption neither swaps in
  # the generic example nor leaves the owner without an editable config.
  bash "$ROOT/scripts/capture-default-config.sh" --no-backup
  echo "Captured the existing built-in layout in $APP_DIR/config.json."
fi

if [[ ! -f "$ENV_FILE" ]]; then
  printf '%s\n' \
    'HOST=0.0.0.0' \
    'PORT=8890' \
    'POLL_MS=2000' \
    "CONFIG_PATH=$APP_DIR/config.json" \
    'HA_URL=http://homeassistant.local:8123' \
    'HA_BROWSER_URL=http://homeassistant.local:8123' \
    'HA_TOKEN=replace-with-a-home-assistant-long-lived-access-token' \
    >"$ENV_FILE"
  chmod 0600 "$ENV_FILE"
  echo "Created $ENV_FILE. Edit HA_URL and HA_TOKEN before starting the service."
fi

# Older environment files remain valid. Add only the updater variables they do
# not already have, so re-running the installer never changes a user's token
# or panel settings.
grep -q '^UPDATE_REQUEST_PATH=' "$ENV_FILE" || printf 'UPDATE_REQUEST_PATH=%s\n' "$UPDATE_REQUEST_PATH" >>"$ENV_FILE"
grep -q '^UPDATE_SERVICE=' "$ENV_FILE" || printf 'UPDATE_SERVICE=%s\n' "$UPDATE_SERVICE_NAME" >>"$ENV_FILE"

install -m 0644 "$ROOT/systemd/ha-light-panel.service" "$SERVICE_FILE"
sed -i "s#WorkingDirectory=/opt/ha-light-panel#WorkingDirectory=$APP_DIR#" "$SERVICE_FILE"
sed -i "s#EnvironmentFile=/etc/ha-light-panel.env#EnvironmentFile=$ENV_FILE#" "$SERVICE_FILE"
sed -i "s#ExecStart=/usr/bin/node /opt/ha-light-panel/server.js#ExecStart=$(command -v node) $APP_DIR/server.js#" "$SERVICE_FILE"
sed -i "s#User=ha-light-panel#User=$SERVICE_USER#" "$SERVICE_FILE"
sed -i "s#Group=ha-light-panel#Group=$SERVICE_USER#" "$SERVICE_FILE"
sed -i "s#ReadWritePaths=/tmp#ReadWritePaths=/tmp $STATE_DIR#" "$SERVICE_FILE"

# Match the Blink proxy's install model: retain a tagged source checkout for
# future upgrades, install a root-owned updater, and let the unprivileged Node
# service request it only through a watched file.
install -m 0755 "$SRC_DIR/scripts/bootstrap.sh" "$UPDATE_SCRIPT"
install -m 0644 "$SRC_DIR/systemd/ha-light-panel-update.service" "$UPDATE_SERVICE_FILE"
install -m 0644 "$SRC_DIR/systemd/ha-light-panel-update.path" "$UPDATE_PATH_FILE"
install -m 0644 "$SRC_DIR/systemd/ha-light-panel-update.timer" "$UPDATE_TIMER_FILE"
sed -i "s#ha-light-panel-update.service#$UPDATE_SERVICE_NAME.service#g" "$UPDATE_PATH_FILE"
sed -i "s#ha-light-panel-update.service#$UPDATE_SERVICE_NAME.service#g" "$UPDATE_SERVICE_FILE"
sed -i "s#ha-light-panel-update.sh#$SERVICE_NAME-update.sh#g" "$UPDATE_SERVICE_FILE"
sed -i "s#EnvironmentFile=-/etc/ha-light-panel/update.env#EnvironmentFile=-$UPDATE_ENV_FILE#" "$UPDATE_SERVICE_FILE"
sed -i "s#ha-light-panel/update.request#${UPDATE_REQUEST_PATH#/var/lib/}#g" "$UPDATE_PATH_FILE"
( umask 077
  printf 'SRC_DIR=%s\nAPP_DIR=%s\nENV_FILE=%s\nSERVICE_NAME=%s\nSTATE_DIR=%s\nUPDATE_REQUEST_PATH=%s\n' \
    "$SRC_DIR" "$APP_DIR" "$ENV_FILE" "$SERVICE_NAME" "$STATE_DIR" "$UPDATE_REQUEST_PATH" >"$UPDATE_ENV_FILE"
)

# Code is root-owned; preserve an existing config's owner and mode. A custom
# service user may deliberately keep its config or secret reference private.
chown root:root "$APP_DIR/server.js" "$APP_DIR/package.json" "$APP_DIR/examples/frameo-climate.json"
chown "$SERVICE_USER":"$SERVICE_USER" "$STATE_DIR"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME.service"
systemctl enable --now "$UPDATE_PATH_NAME"
# Re-running this script is the upgrade path. Restart so the long-running
# process cannot keep serving the code that was just replaced.
systemctl restart "$SERVICE_NAME.service"

if [[ "${INSTALL_AUTOUPDATE:-0}" = "1" ]]; then
  systemctl enable --now "$UPDATE_TIMER_NAME"
  UPDATE_NOTE="daily timer enabled"
else
  UPDATE_NOTE="on demand (set INSTALL_AUTOUPDATE=1 for a daily check)"
fi

echo "Installed $SERVICE_NAME."
echo "Next:"
echo "  1. Edit $ENV_FILE and set HA_TOKEN."
echo "  2. Edit $APP_DIR/config.json."
echo "  3. Run: systemctl start $SERVICE_NAME"
echo "  Updates: $UPDATE_NOTE"
echo "  Re-run this installer, or use: curl -fsSL https://raw.githubusercontent.com/Teethree89/ha-light-panel/main/scripts/bootstrap.sh | sudo bash"
