#!/usr/bin/env bash
set -euo pipefail

FRAMEO_SSH_HOST="${FRAMEO_SSH_HOST:-frameo}"
OTG_MODE_PATH="${OTG_MODE_PATH:-/sys/devices/platform/ff2c0000.syscon/ff2c0000.syscon:usb2-phy@100/otg_mode}"

ssh "$FRAMEO_SSH_HOST" "/system/xbin/su 0 sh -s" <<EOF
set -eu

echo host > "$OTG_MODE_PATH"
sleep 1

echo "--- otg_mode ---"
cat "$OTG_MODE_PATH"

echo "--- extcon ---"
cat /sys/class/extcon/extcon1/state 2>/dev/null || true

echo "--- usb ---"
lsusb 2>/dev/null || toybox lsusb 2>/dev/null || true

echo "--- audio cards ---"
cat /proc/asound/cards 2>/dev/null || true
EOF
