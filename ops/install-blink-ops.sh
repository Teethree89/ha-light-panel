#!/usr/bin/env bash
# Installs the privileged half of the Blink ops features (Restart Proxy and the
# SMS re-auth flow on the panel's Blink Status modal).
#
# The panel service runs hardened — NoNewPrivileges, ProtectSystem=strict — so
# it cannot restart services or run the re-auth orchestrator itself. Instead it
# writes a request file, and the root .path units installed here notice the
# write and do the privileged work. Nothing is exposed over the network.
#
# Run as root on the host running the panel:
#
#   sudo ops/install-blink-ops.sh
#
# Then set blinkOps in your panel config (see docs/configuration.md) and
# restart the panel.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "This script installs systemd units; run it with sudo." >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PANEL_SERVICE="${PANEL_SERVICE:-ha-light-panel}"
PANEL_USER="${PANEL_USER:-ha-light-panel}"

echo "Installing from $REPO_DIR (panel service: $PANEL_SERVICE, user: $PANEL_USER)"

# The orchestrator itself.
install -m 0755 "$REPO_DIR/scripts/blink-reauth.py" /usr/local/sbin/blink-reauth.py

# Spool directories the panel writes into and the .path units watch.
for dir in /var/spool/blink-reauth /var/spool/blink-liveview-proxy-restart; do
  install -d -o "$PANEL_USER" -g "$PANEL_USER" -m 0755 "$dir"
done

install -m 0644 "$REPO_DIR/ops/systemd/blink-reauth.path" /etc/systemd/system/
install -m 0644 "$REPO_DIR/ops/systemd/blink-reauth.service" /etc/systemd/system/
install -m 0644 "$REPO_DIR/ops/systemd/blink-liveview-proxy-restart.path" /etc/systemd/system/
install -m 0644 "$REPO_DIR/ops/systemd/blink-liveview-proxy-restart.service" /etc/systemd/system/

# ProtectSystem=strict blocks the spool writes without this drop-in.
DROPIN="/etc/systemd/system/${PANEL_SERVICE}.service.d"
install -d -m 0755 "$DROPIN"
install -m 0644 "$REPO_DIR/ops/systemd/ha-light-panel.service.d/blink-ops.conf" "$DROPIN/blink-ops.conf"

systemctl daemon-reload
systemctl enable --now blink-reauth.path blink-liveview-proxy-restart.path
systemctl restart "${PANEL_SERVICE}.service"

cat <<'DONE'

Installed. Now add a blinkOps section to your panel config:

  "blinkOps": {
    "proxyStatusUrl": "http://127.0.0.1:8088/status",
    "reauthSpool": "/var/spool/blink-reauth/request.json",
    "reauthStatus": "/run/blink-reauth/status.json",
    "proxyRestartSpool": "/var/spool/blink-liveview-proxy-restart/request",
    "watchdogMs": 30000
  }

and restart the panel. The Cameras page will grow a "Blink Status" button.
DONE
