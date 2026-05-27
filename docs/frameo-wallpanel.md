# Frameo WallPanel Notes

HA Light Panel now documents Fully Kiosk Browser as the primary Frameo browser.

See [frameo-fully-kiosk.md](frameo-fully-kiosk.md) for the current setup.

WallPanel can still work for basic dashboard display, but the tested microphone,
USB-host, and push-to-talk workflow uses Fully Kiosk Browser because its
JavaScript bridge can start SimpleSSHD, run host-mode commands, and read OS
audio diagnostics.
