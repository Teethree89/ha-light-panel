# Installation guide

HA Light Panel is a small Node service. Choose **one** service-install method
below, then optionally install the HACS integration to expose that running
service inside Home Assistant and through remote HA access.

| Where the panel runs | Recommended method |
|---|---|
| Home Assistant OS or Supervised | [Home Assistant add-on](#1-home-assistant-add-on) |
| A NAS, VM, Raspberry Pi, or another Docker host | [Docker Compose](#2-docker-compose) |
| Debian/Ubuntu-style Linux with systemd | [Managed systemd](#3-managed-systemd) |
| Development, a custom process manager, or an unusual host | [Manual Node.js](#4-manual-nodejs-or-custom-service) |

## Before you begin

1. In Home Assistant, click your user profile.
2. Under **Long-Lived Access Tokens**, select **Create Token**.
3. Copy the token now; Home Assistant will not show it again.
4. In **Developer Tools → States**, note the entity IDs you want on the panel.

The service needs an address that it can use to reach Home Assistant:

- A panel running on the same Linux host normally uses
  `http://127.0.0.1:8123`.
- A Docker container or another machine normally uses the Home Assistant LAN
  address, such as `http://192.168.1.50:8123`.
- `homeassistant.local` is convenient when it resolves on that host, but an IP
  address is often more reliable on kiosk browsers and containers.

Keep the token in the add-on options or an environment file. Never put it in
`config.json` or publish it in a screenshot.

## 1. Home Assistant add-on

Use this on Home Assistant OS or a Supervised installation.

1. Open **Settings → Add-ons → Add-on Store**.
2. Open the ⋮ menu, choose **Repositories**, and add:

   ```text
   https://github.com/Teethree89/ha-light-panel
   ```

3. Find **HA Light Panel**, select **Install**, then open its **Configuration**
   tab.
4. Set:

   ```yaml
   ha_url: http://homeassistant.local:8123
   ha_token: YOUR_LONG_LIVED_TOKEN
   # Optional: the browser-facing URL used by navigation links.
   ha_browser_url: https://your-home-assistant-address
   ```

5. Select **Save**, then **Start**. Check the add-on **Log**; it should report
   the panel URL and the config file it loaded.
6. Create `/config/ha-light-panel.json` using
   [`examples/starter.json`](../examples/starter.json), replace the example
   entity IDs, then restart the add-on.
7. Open `http://<your-ha-host>:8890/` on the LAN.

The full option reference and config-file workflow are in
[addon/DOCS.md](../addon/DOCS.md). Update this deployment from the add-on's
**Info** page: **Update**, then **Start** if Supervisor does not start it
automatically.

## 2. Docker Compose

Use Docker when the panel runs on a NAS, VM, Raspberry Pi, or another container
host. These commands run on that host, not inside Home Assistant.

1. Install Docker Engine and the Docker Compose plugin.
2. Clone a released checkout and enter it:

   ```sh
   git clone https://github.com/Teethree89/ha-light-panel.git
   cd ha-light-panel
   ```

3. Create your environment and panel config:

   ```sh
   cp .env.example .env
   cp examples/starter.json config.json
   ```

4. Edit `.env`. Use a Home Assistant URL reachable *from the container*:

   ```dotenv
   HA_URL=http://192.168.1.50:8123
   HA_BROWSER_URL=http://192.168.1.50:8123
   HA_TOKEN=YOUR_LONG_LIVED_TOKEN
   ```

5. Edit `config.json` and replace the starter entity IDs.
6. Build and start the service:

   ```sh
   docker compose -f docker-compose.example.yml --env-file .env up -d --build
   docker compose -f docker-compose.example.yml logs -f
   ```

7. Open `http://<docker-host-ip>:8890/`.

The compose example mounts `config.json` read-only. To apply an exported or
edited config, replace the host file and recreate the container:

```sh
docker compose -f docker-compose.example.yml --env-file .env up -d --force-recreate
```

To update a source checkout:

```sh
git pull --ff-only
docker compose -f docker-compose.example.yml --env-file .env up -d --build
```

## 3. Managed systemd

Use this on a Debian/Ubuntu-style Linux host with Node.js 20+ and Git. The
installer creates a dedicated service user, `/opt/ha-light-panel`,
`/etc/ha-light-panel.env`, and a guarded on-demand update unit.

1. On the panel host, run:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/Teethree89/ha-light-panel/main/scripts/bootstrap.sh | sudo bash
   ```

2. Set the Home Assistant URL and token:

   ```sh
   sudo nano /etc/ha-light-panel.env
   ```

   At minimum, set:

   ```dotenv
   HA_URL=http://127.0.0.1:8123
   HA_BROWSER_URL=http://your-ha-host:8123
   HA_TOKEN=YOUR_LONG_LIVED_TOKEN
   ```

3. Edit the generated config:

   ```sh
   sudo nano /opt/ha-light-panel/config.json
   ```

4. Restart and verify:

   ```sh
   sudo systemctl restart ha-light-panel
   sudo systemctl status ha-light-panel --no-pager
   curl http://127.0.0.1:8890/health
   ```

5. Open `http://<panel-host-ip>:8890/` from another device on the LAN.

For future updates, use **Update panel now** in the HA sidebar Overview, or run
the exact updater unit:

```sh
sudo systemctl start ha-light-panel-update.service
```

The updater is root-owned. The Node process can only create a local request for
it; it cannot execute privileged shell commands itself.

### Adopt an existing/custom systemd service

If the panel already runs as a differently named service, preserve its current
app directory, environment file, service user, and config while adding the
managed updater. Substitute your actual values:

```sh
curl -fsSL https://raw.githubusercontent.com/Teethree89/ha-light-panel/main/scripts/bootstrap.sh | \
  sudo env APP_DIR=/opt/frameo-svg-dashboard \
  ENV_FILE=/etc/frameo-dashboard.env \
  SERVICE_NAME=frameo-svg-dashboard \
  SERVICE_USER=frameo \
  SRC_DIR=/opt/src/ha-light-panel \
  bash
```

That example creates `frameo-svg-dashboard-update.service`; the Overview
detects and uses that exact unit. The installer preserves an existing
`config.json`. If an older Frameo deployment was using the built-in layout with
no config file, it captures that layout into a config before the server is
replaced.

## 4. Manual Node.js or custom service

Use this for local development or a process manager such as PM2, OpenRC, or
launchd. You are responsible for restarts and updates.

1. Install Node.js 20+ and Git.
2. Clone the project and create the files:

   ```sh
   git clone https://github.com/Teethree89/ha-light-panel.git
   cd ha-light-panel
   cp .env.example .env
   cp examples/starter.json config.json
   ```

3. Edit `.env` with `HA_URL`, `HA_BROWSER_URL`, and `HA_TOKEN`, then edit
   `config.json` with your entity IDs.
4. Validate and start:

   ```sh
   npm run validate
   npm start
   ```

5. Open `http://<host-ip>:8890/`.

For a custom process manager, load the values from `.env` as environment
variables and run `node /absolute/path/to/server.js`. To update, stop your
process, run `git pull --ff-only`, validate, and start it again. This deployment
does not expose an in-app update button because the panel cannot know how your
process manager owns the service.

## Optional: HACS integration and remote Home Assistant access

The HACS integration does **not** install or run the panel. It proxies an
already-running panel through Home Assistant at `/api/ha_light_panel/`, which
is useful for Nabu Casa and other remote-access paths that expose only port
8123.

1. In **HACS → ⋮ → Custom repositories**, add
   `https://github.com/Teethree89/ha-light-panel` as **Integration**.
2. Download **HA Light Panel** and restart Home Assistant.
3. Go to **Settings → Devices & Services → Add Integration → HA Light Panel**.
4. Enter the panel service URL:

   - Same Linux host: `http://127.0.0.1:8890`
   - Another LAN machine: `http://<panel-host-ip>:8890`
   - HAOS add-on: use **Find panel address**; the sidebar detects the add-on
     hostname when possible.

5. Use the Home Assistant sidebar item to open Overview, Builder, or copied
   device links.

See [integration.md](integration.md) for connection, discovery, and security
details.

## Visual Builder status — work in progress

The visual SVG Layout Builder is currently **WIP**. It can import the running
layout and create Display, Action, and Text cards, with entity bindings and
configurable action modals. It exports a `config.json` for you to review and
install manually.

It is not yet a replacement for every bespoke part of the shipped SVG dashboard
or a general Lovelace editor. Keep a backup before replacing your configuration,
test a downloaded config on a non-critical display first, and restart the
service yourself after installation. The builder never writes to Home Assistant
or directly changes a running service.
