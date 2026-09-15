#!/usr/bin/env bash
# One command to install HA Light Panel, and the same command to upgrade it.
#
# curl -fsSL https://raw.githubusercontent.com/Teethree89/ha-light-panel/main/scripts/bootstrap.sh | sudo bash
#
# Releases, not main, are installed by default. Re-running this preserves the
# service environment and config.json while moving the deployed code forward.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Teethree89/ha-light-panel}"
SRC_DIR="${SRC_DIR:-/opt/src/ha-light-panel}"
APP_DIR="${APP_DIR:-/opt/ha-light-panel}"
ENV_FILE="${ENV_FILE:-/etc/ha-light-panel.env}"
SERVICE_NAME="${SERVICE_NAME:-ha-light-panel}"
SERVICE_USER="${SERVICE_USER:-ha-light-panel}"
VERSION="${VERSION:-}"

sort_release_tags() {
  python3 -c '
import re, sys
def key(tag):
    value = tag.removeprefix("v").split("+", 1)[0]
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?", value)
    if not match: return None
    release = tuple(int(part) for part in match.group(1, 2, 3))
    prerelease = match.group(4)
    if prerelease is None: return (*release, 1, ())
    pieces = tuple((0, int(x)) if x.isdigit() else (1, x.lower()) for x in re.findall(r"[A-Za-z]+|\d+", prerelease))
    return (*release, 0, pieces)
items = ((key(line.strip()), line.strip()) for line in sys.stdin)
for _, tag in sorted(item for item in items if item[0] is not None): print(tag)
'
}

installed_version() {
  node -p "require('$APP_DIR/package.json').version" 2>/dev/null || true
}

if [ "$(id -u)" != "0" ]; then
  echo "This installer needs root: it writes to /opt, /etc, and systemd." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y git
  else
    echo "git is required and could not be installed automatically." >&2
    exit 1
  fi
fi

if [ -d "$SRC_DIR/.git" ]; then
  git -C "$SRC_DIR" fetch --tags --prune --force --quiet
else
  mkdir -p "$(dirname "$SRC_DIR")"
  git clone --quiet "$REPO_URL" "$SRC_DIR"
fi

TARGET="${VERSION:-$(git -C "$SRC_DIR" tag --list | sort_release_tags | tail -n 1)}"
if [ -z "$TARGET" ]; then
  echo "No release tags found in $REPO_URL; refusing to install main." >&2
  exit 1
fi

INSTALLED="$(installed_version)"
if [ -z "${FORCE:-}" ] && [ "${TARGET#v}" = "${INSTALLED#v}" ]; then
  echo "HA Light Panel is already on $TARGET."
  exit 0
fi

echo "Installing $TARGET (currently ${INSTALLED:-unknown})"
git -C "$SRC_DIR" checkout --quiet "$TARGET"
exec env APP_DIR="$APP_DIR" ENV_FILE="$ENV_FILE" SERVICE_NAME="$SERVICE_NAME" SERVICE_USER="$SERVICE_USER" SRC_DIR="$SRC_DIR" \
  bash "$SRC_DIR/scripts/install-systemd.sh"
