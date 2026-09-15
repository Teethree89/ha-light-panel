#!/usr/bin/env bash
# Export the legacy in-code Frameo layout to an explicit config.json.
#
# This is intentionally opt-in for installations that already have a config:
# it makes a timestamped backup before replacing it. The installer uses
# --no-backup only when it has already established that no config exists.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${APP_DIR:-/opt/ha-light-panel}"
NODE_BIN="${NODE_BIN:-node}"
TARGET="$APP_DIR/config.json"
NO_BACKUP=0

if [[ "${1:-}" == "--no-backup" ]]; then
  NO_BACKUP=1
elif [[ -n "${1:-}" ]]; then
  echo "Usage: $0 [--no-backup]" >&2
  exit 2
fi

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "Node.js is required to export the panel layout." >&2
  exit 1
fi

mkdir -p "$APP_DIR"
TARGET_MODE="0644"
TARGET_OWNER="root:root"
if [[ -f "$TARGET" && "$NO_BACKUP" != "1" ]]; then
  BACKUP="$APP_DIR/config.json.before-layout-capture.$(date -u +%Y%m%dT%H%M%SZ)"
  TARGET_MODE="$(stat -c '%a' "$TARGET")"
  TARGET_OWNER="$(stat -c '%u:%g' "$TARGET")"
  cp --preserve=mode,ownership "$TARGET" "$BACKUP"
  echo "Backed up existing config to $BACKUP"
fi

TEMP_FILE="$(mktemp "$APP_DIR/.config.json.capture.XXXXXX")"
trap 'rm -f "$TEMP_FILE"' EXIT
"$NODE_BIN" "$ROOT/server.js" --print-default-config >"$TEMP_FILE"
install -m "$TARGET_MODE" "$TEMP_FILE" "$TARGET"
chown "$TARGET_OWNER" "$TARGET"
echo "Wrote the legacy built-in panel layout to $TARGET"
