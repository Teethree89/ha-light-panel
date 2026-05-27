# HA Light Panel

A tiny Home Assistant panel server for low-power browsers, old tablets, kiosk displays, and digital photo frames.

Instead of loading the full Home Assistant frontend, HA Light Panel serves a small SVG/HTML interface and pulls state from the Home Assistant REST API. The browser does very little work, which makes it a good fit for slow Android WebViews and cheap wall panels.

If this saves you a little time, [buy me a coffee](https://paypal.me/ABPaintball/5). Add `Buy me a coffee` in the PayPal note so I know what it was for.

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-$5%20PayPal-00457C?logo=paypal)](https://paypal.me/ABPaintball/5)

## Features

- Lightweight climate dashboard with six room cards
- Compact SVG UI, no frontend framework
- Home Assistant REST polling
- Config-driven entity mapping
- Temperature, humidity, battery, HVAC mode, comfort band, and status-panel cards
- Optional camera snapshot grid
- Optional Blink live-view proxy integration hooks
- Service-backed action buttons for comfort tweaks and room balancing
- HAOS add-on, Docker, and systemd deployment examples
- No runtime npm dependencies

## Home Assistant OS Add-on

The easiest install path if you're running Home Assistant OS or Supervised:

1. Go to **Settings → Add-ons → Add-on Store**.
2. Click ⋮ → **Repositories** and add:
   ```
   https://github.com/Teethree89/ha-light-panel
   ```
3. Find **HA Light Panel**, click **Install**, then set your `ha_token` and `ha_url` in the add-on options and start it.

The panel will be available at `http://<your-ha-host>:8890/`.

See [addon/DOCS.md](https://github.com/Teethree89/ha-light-panel/blob/main/addon/DOCS.md) for the full option reference.

## Quick Start (Node.js)

1. Copy the example config:

```sh
cp examples/frameo-climate.json config.json
```

2. Create a Home Assistant long-lived access token.

In Home Assistant, open your profile, create a long-lived access token, and put it in `.env` or your service env file.

```sh
cp .env.example .env
```

3. Edit `.env`:

```sh
HA_URL=http://homeassistant.local:8123
HA_TOKEN=your-token-here
CONFIG_PATH=./config.json
```

4. Edit `config.json` and replace the example entity IDs with your entities.

5. Run it:

```sh
npm run validate
npm start
```

Open:

```text
http://localhost:8890/
```

## Docker

```sh
cp examples/frameo-climate.json config.json
cp .env.example .env
docker compose -f docker-compose.example.yml --env-file .env up -d --build
```

## systemd

On a Debian-style host with Node.js 20+:

```sh
sudo scripts/install-systemd.sh
sudo nano /etc/ha-light-panel.env
sudo nano /opt/ha-light-panel/config.json
sudo systemctl start ha-light-panel
```

Then open:

```text
http://your-server:8890/
```

## Configuration

See the [configuration guide](https://github.com/Teethree89/ha-light-panel/blob/main/docs/configuration.md).

The most important sections are:

- `homeAssistant`: HA URL and optional browser URL
- `panel.metrics`: top-card entity IDs
- `panel.rooms`: six room cards
- `panel.actions`: service calls for buttons
- `panel.statusPanel`: optional side status widget
- `cameras`: optional camera snapshot/live mappings

## Blink Live View Proxy

HA Light Panel can show Blink snapshots by using normal Home Assistant camera
entities. For direct live view, push-to-talk, local clip browsing, and manual
snapshot refresh buttons, it expects the separate Blink Liveview Proxy package:

[Blink Liveview Proxy](https://github.com/Teethree89/ha-blink-live-view-proxy)

The proxy package contains:

- a Home Assistant custom integration that exposes `camera.blink_live_*`
  entities and local `/api/blink_liveview_proxy/...` routes
- a small Python service that logs in to Blink with BlinkPy and bridges the
  direct Blink live-view stream
- install, configuration, systemd, and known-limitations docs

In this panel's camera config, set `sourceEntity` to the normal HA Blink camera
for snapshots, and set `liveEntity` to the matching proxy camera for live view.
The optional `liveProxyEntity` and `snapshotRefreshPath` settings let the panel
show proxy health and request fresh Blink snapshots from the proxy integration.

See the camera configuration notes in
[the camera configuration guide](https://github.com/Teethree89/ha-light-panel/blob/main/docs/configuration.md#cameras),
and the proxy setup guide in
[the Blink proxy install guide](https://github.com/Teethree89/ha-blink-live-view-proxy/blob/main/docs/INSTALL.md).

## Display Setup

For a Frameo or similar Android picture frame, see
[the Frameo Fully Kiosk guide](https://github.com/Teethree89/ha-light-panel/blob/main/docs/frameo-fully-kiosk.md).

For USB microphone, SSH, OTG host mode, and push-to-talk notes on Frameo-style
frames, see
[the Frameo USB microphone guide](https://github.com/Teethree89/ha-light-panel/blob/main/docs/frameo-usb-microphone.md).

Short version:

- Prefer `http://SERVER_IP:8890/` over `.local` names on Android WebView.
- Use Fully Kiosk Browser as the full-screen browser.
- Use Taskbar or another edge launcher if you want to switch between the photo-frame app and the panel.
- Use ADB for sideloading and setup when the frame exposes it.

## HTTPS

Plain HTTP is usually fine for a trusted LAN display. HTTPS becomes important for browser microphone access, push-to-talk, remote access, or anything leaving your LAN.

See the [HTTPS guide](https://github.com/Teethree89/ha-light-panel/blob/main/docs/https.md).

## Security Notes

This app is designed for a trusted LAN. It holds a Home Assistant token and exposes controls. Do not publish it directly to the internet. If you need remote access, put it behind HTTPS and authentication.

See [Security Notes](https://github.com/Teethree89/ha-light-panel/blob/main/SECURITY.md).

## Why

The normal HA frontend is excellent, but it can be heavy for older Android frames and kiosk browsers. HA Light Panel keeps Home Assistant as the backend and turns the display into a dumb, fast, low-power panel.
