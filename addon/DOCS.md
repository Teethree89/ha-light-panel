# HA Light Panel — Add-on Documentation

## Installation

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**.
2. Click the three-dot menu (⋮) in the top-right and choose **Repositories**.
3. Add `https://github.com/Teethree89/ha-light-panel` and click **Add**.
4. Find **HA Light Panel** in the store and click **Install**.

## Configuration

| Option | Required | Default | Description |
|---|---|---|---|
| `ha_token` | Yes | — | Long-lived access token from your HA profile |
| `ha_url` | Yes | `http://homeassistant.local:8123` | URL the add-on uses to reach HA internally |
| `ha_browser_url` | No | same as `ha_url` | URL opened in the panel's browser navigation links |
| `config_path` | No | `/config/ha-light-panel.json` | Panel config file mapping your entities (see below) |
| `port` | No | `8890` | Port the web interface listens on |
| `poll_ms` | No | `2000` | Entity state poll interval in milliseconds (min 750) |

### Mapping your own entities

The add-on ships with a built-in reference layout. To show *your* sensors,
create a panel config file in your Home Assistant config directory:

1. Install the **File editor** (or **Studio Code Server**) add-on.
2. Create `/config/ha-light-panel.json`.
3. Paste the contents of
   [examples/starter.json](https://github.com/Teethree89/ha-light-panel/blob/main/examples/starter.json) —
   a small commented config with three room cards — and replace the example
   entity IDs with your own. For the everything-enabled reference, see
   [examples/frameo-climate.json](https://github.com/Teethree89/ha-light-panel/blob/main/examples/frameo-climate.json).
4. Restart the add-on.

The add-on log reports which file it loaded. If the file is missing it logs a
warning and falls back to the built-in defaults, so a typo in the path shows up
as "using built-in defaults" rather than an empty panel.

See the [configuration guide](https://github.com/Teethree89/ha-light-panel/blob/main/docs/configuration.md)
for the full key reference. `/config` is mounted read-only, so edit the file
with an editor add-on rather than from the panel.

### Getting a long-lived access token

1. Go to your HA profile (click your username in the sidebar).
2. Scroll to **Long-Lived Access Tokens** and click **Create Token**.
3. Copy the token and paste it into the `ha_token` option.

## Usage

Once started, open `http://<your-ha-host>:8890` in any browser.

For kiosk displays (Frameo, Fire tablet, old iPad), point Fully Kiosk Browser or
WallPanel at that URL. See the [Frameo setup guide](https://github.com/Teethree89/ha-light-panel/blob/main/docs/frameo-fully-kiosk.md) for detailed steps.

## Persistent data

The add-on stores nothing to `/data` — all configuration lives in the add-on options above.

## Live view, clips, and push-to-talk

Snapshots, climate cards, room sensors, and motion toggles work with plain Home
Assistant APIs and need nothing extra.

Direct live view, push-to-talk, local clip browsing, and the manual
snapshot-refresh button additionally require the sister project:

**[Blink Liveview Proxy](https://github.com/Teethree89/ha-blink-live-view-proxy)**

It has two halves, installed through two different mechanisms:

1. **Proxy service** — add its repo URL under Settings → Add-ons → Add-on Store
   → ⋮ → Repositories, then install its add-on.
2. **Proxy integration** — add the same repo URL in HACS → Integrations → ⋮ →
   Custom repositories, then add the integration and point it at the proxy.

That integration is what exposes the `camera.blink_live_*` entities and the
`/api/blink_liveview_proxy/...` routes this panel calls. Set `liveEntity` on each
camera to the matching `camera.blink_live_*` entity, and optionally set
`cameraPanel.liveProxyEntity` so the panel can show proxy health.

Until the proxy is installed those buttons return an error; the rest of the
panel is unaffected.
