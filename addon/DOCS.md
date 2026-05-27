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
| `port` | No | `8890` | Port the web interface listens on |
| `poll_ms` | No | `2000` | Entity state poll interval in milliseconds (min 750) |

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
