#!/usr/bin/env bash
# Installs the privileged proxy-restart hook used by the Blink Status modal.
#
# The panel service runs hardened — NoNewPrivileges, ProtectSystem=strict — so
# it cannot restart services itself. Instead it writes a request file, and the
# root .path unit installed here notices the write and does the privileged
# work. Nothing is exposed over the network.
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

# Spool directory the panel writes into and the .path unit watches.
install -d -o "$PANEL_USER" -g "$PANEL_USER" -m 0755 /var/spool/blink-liveview-proxy-restart

install -m 0644 "$REPO_DIR/ops/systemd/blink-liveview-proxy-restart.path" /etc/systemd/system/
install -m 0644 "$REPO_DIR/ops/systemd/blink-liveview-proxy-restart.service" /etc/systemd/system/

# ProtectSystem=strict blocks the spool writes without this drop-in.
DROPIN="/etc/systemd/system/${PANEL_SERVICE}.service.d"
install -d -m 0755 "$DROPIN"
install -m 0644 "$REPO_DIR/ops/systemd/ha-light-panel.service.d/blink-ops.conf" "$DROPIN/blink-ops.conf"

# Clean up the legacy official-Blink re-auth path from releases through 0.8.0.
systemctl disable --now blink-reauth.path 2>/dev/null || true
rm -f /etc/systemd/system/blink-reauth.path /etc/systemd/system/blink-reauth.service \
  /usr/local/sbin/blink-reauth.py
systemctl daemon-reload
systemctl enable --now blink-liveview-proxy-restart.path
systemctl restart "${PANEL_SERVICE}.service"

cat <<'DONE'

Installed. Now add a blinkOps section to your panel config:

  "blinkOps": {
    "proxyStatusUrl": "http://127.0.0.1:8088/status",
    "proxyRestartSpool": "/var/spool/blink-liveview-proxy-restart/request"
  }

and restart the panel. The Cameras page will grow a "Blink Status" button.
DONE
