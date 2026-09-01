# Configuration

HA Light Panel reads JSON with optional `//` and `/* */` comments.

Default config path:

```text
./config.json
```

Override it:

```sh
CONFIG_PATH=/path/to/config.json npm start
```

## Home Assistant

```json
{
  "homeAssistant": {
    "url": "http://homeassistant.local:8123",
    "browserUrl": "http://homeassistant.local:8123"
  }
}
```

Use `HA_TOKEN` for the token instead of putting it in config.

```sh
HA_TOKEN=...
```

## Mode Card

The mode card uses plain labels for household-facing status. Timers are optional, but they allow the panel to show states such as `Balancing rooms` with remaining time.

```json
{
  "panel": {
    "mode": {
      "operatingState": "sensor.hvac_operating_state",
      "miniMode": "climate.mini_split",
      "action": "sensor.mini_split_inferred_action",
      "airflowBoostTimer": "timer.airflow_boost",
      "dryAssistTimer": "timer.dry_assist",
      "postDryFanTimer": "timer.post_dry_fan_purge",
      "automationEnabled": "input_boolean.hvac_automation_enabled",
      "thermostatUnavailable": "binary_sensor.active_thermostat_unavailable",
      "heatDemand": "binary_sensor.heat_demand",
      "coolDemand": "binary_sensor.cool_demand",
      "humidityDemand": "binary_sensor.dehumidify_recommended"
    }
  }
}
```

## Rooms

The current layout displays up to six room cards.

```json
{
  "panel": {
    "rooms": [
      {
        "id": "living",
        "label": "Living Room",
        "temp": "sensor.living_room_temperature",
        "humidity": "sensor.living_room_humidity",
        "battery": "sensor.living_room_sensor_battery"
      }
    ]
  }
}
```

Values can be plain entities or entity attributes:

```json
{
  "temp": {
    "entity": "climate.living_room",
    "attribute": "current_temperature"
  }
}
```

## Room Extra Text

Static extra text:

```json
{
  "extra": "Home schedule"
}
```

Mapped entity state:

```json
{
  "extra": {
    "entity": "climate.my_thermostat",
    "hvacModeLabel": true
  }
}
```

Comfort-band status:

```json
{
  "extra": { "type": "comfortStatus" }
}
```

## Mini Split Status

Use `miniStatus` to render fan and compressor/action icons instead of raw text.

```json
{
  "id": "mini",
  "label": "Mini Split",
  "temp": {
    "entity": "climate.mini_split",
    "attribute": "current_temperature"
  },
  "miniStatus": {
    "mode": "climate.mini_split",
    "fan": {
      "entity": "climate.mini_split",
      "attribute": "fan_mode"
    },
    "action": "sensor.gree_inferred_action"
  }
}
```

## Buttons

Buttons call Home Assistant services.

```json
{
  "panel": {
    "actions": {
      "cooler": {
        "service": "script.adjust_temperature",
        "data": { "direction": "down", "step": 1 }
      },
      "warmer": {
        "service": "script.adjust_temperature",
        "data": { "direction": "up", "step": 1 }
      },
      "reset": {
        "service": "script.reset_temperature",
        "data": {}
      },
      "assist": {
        "service": "script.start_airflow_assist_now",
        "data": {}
      }
    }
  }
}
```

## Cameras

Basic snapshot camera:

```json
{
  "cameras": [
    {
      "slug": "driveway",
      "label": "Driveway",
      "sourceEntity": "camera.driveway",
      "batteryEntity": "binary_sensor.driveway_battery",
      "motionEntity": "binary_sensor.driveway_motion",
      "motionSwitch": "switch.driveway_camera_motion_detection",
      "tempEntity": "sensor.driveway_temperature"
    }
  ]
}
```

For powered cameras:

```json
{
  "powerLabel": "USB power"
}
```

For integrations with unreliable numeric battery attributes:

```json
{
  "ignoreBatteryLevel": true
}
```

Live view currently expects a compatible local proxy endpoint, such as the Blink
Liveview Proxy package documented in the
[main README](https://github.com/Teethree89/ha-light-panel#blink-live-view-proxy):

```json
{
  "liveEntity": "camera.blink_live_driveway"
}
```

The live camera page uses the `access_token` attribute from `liveEntity`.

## Fallback Chains

Any reading (`temp`, `humidity`, `battery`, and the `panel.metrics` entries) also
accepts an array. Entries are tried in order and the first one with a usable
value wins, which is how a card can prefer a dedicated sensor and fall back to a
climate entity's attribute:

```json
{
  "temp": [
    "sensor.thermostat_current_temperature",
    { "entity": "climate.main_thermostat", "attribute": "current_temperature" }
  ]
}
```

## Status Panel

`panel.statusPanel` drives the optional side widget. Any key may be omitted; the
widget simply renders `--` for readings it has no entity for. `alerts` is a list
and the widget shows "Alert" while any of them is `on`.

To echo the widget's status line inside a room card:

```json
{
  "extra": { "type": "statusPanel" }
}
```

For historical reasons this widget is still published as `sock` in the `/state`
JSON payload.

## Smoke and CO Panel

`panel.safetyPanel.rooms` drives the smoke/CO strip and its detail modal. Each
room combines any number of smoke sensors: the room reads as alarming if any is
`on`, clear only if all are `off`, and unknown otherwise. `co` is optional and
takes a single entity or a list; a room without one reports `na`.

```json
{
  "panel": {
    "safetyPanel": {
      "rooms": [
        {
          "id": "kitchen",
          "label": "Kitchen",
          "smoke": [
            "binary_sensor.kitchen_smoke_alarm",
            "binary_sensor.kitchen_hardwire_smoke_alarm"
          ],
          "co": "binary_sensor.kitchen_co_alarm"
        },
        {
          "id": "office",
          "label": "Office",
          "smoke": ["binary_sensor.office_smoke_alarm"]
        }
      ]
    }
  }
}
```

The layout has room for five entries. Pair it with a `silenceAlarm` action to
hush an active alarm from the panel:

```json
{
  "panel": {
    "actions": {
      "silenceAlarm": {
        "service": "script.hush_active_smoke_alarms",
        "data": {}
      }
    }
  }
}
```

## Server Metrics

The header strip can show host stats. All five are optional:

```json
{
  "panel": {
    "metrics": {
      "cpuTemp": "sensor.ha_server_cpu_temp",
      "ddrTemp": "sensor.ha_server_ddr_temp",
      "ramUsed": "sensor.ha_server_ram_used",
      "cpuLoad": "sensor.ha_server_cpu_load",
      "diskUsed": "sensor.ha_server_disk_used"
    }
  }
}
```

## Thermostats

`panel.thermostats` feeds the thermostat readings in the `/state` payload.

```json
{
  "panel": {
    "thermostats": {
      "primary": {
        "entity": "climate.main_thermostat",
        "tempEntity": "sensor.main_thermostat_temperature"
      },
      "mini": { "entity": "climate.mini_split" }
    }
  }
}
```

`tempEntity` is optional; without it the panel reads the `current_temperature`
attribute of `entity`.

## Operating States

`panel.mode` decides the headline status. `heatingStates` and `coolingStates`
list the values of `operatingState` that mean the system is actively running,
since those strings are specific to your automation:

```json
{
  "panel": {
    "mode": {
      "operatingState": "sensor.hvac_operating_state",
      "heatingStates": ["gree_heating"],
      "coolingStates": ["gree_cooling"]
    }
  }
}
```

## Balance Rooms

`panel.balance` gates the Balance Rooms button and explains why it is
unavailable. `focusRooms` must contain the room labels your focus-zone sensor
can report:

```json
{
  "panel": {
    "balance": {
      "manualOverrideTimer": "timer.airflow_manual_override",
      "focusZone": "sensor.airflow_focus_zone",
      "focusRooms": ["Living Room", "Master Bedroom", "Nursery"],
      "activeStates": ["gree_cooling", "gree_heating"]
    }
  }
}
```

## Settings Page

An optional page at `/hvac-settings`, reached from a **Settings** button that
appears next to **Cameras** on the main panel. It exposes two controls: a
humidity-biased-cooling toggle, and a seasonal mode switch that shows a
physical checklist before it changes anything.

```json
"settings": {
  "title": "HVAC Settings",
  "humidityCooling": {
    "entity": "input_boolean.humidity_biased_cooling_enabled",
    "label": "Humidity-Biased Cooling",
    "hint": "Shown under the label as explanatory text."
  },
  "seasonalMode": {
    "entity": "input_select.seasonal_mode",
    "furnaceGuard": "binary_sensor.furnace_outdoor_guard_active",
    "label": "Seasonal Mode",
    "hint": "Shown under the label as explanatory text.",
    "options": [
      {
        "value": "Winter",
        "label": "Winter Mode",
        "icon": "\u2744\ufe0f",
        "title": "Switch to Winter Mode?",
        "intro": "Before switching, go around the house and:",
        "confirmLabel": "I Understand \u2014 Switch to Winter",
        "steps": ["Open all supply registers.", "Open the fresh air intake."]
      }
    ]
  }
}
```

`options` drives both the mode cards and the confirmation checklists, so the
page is not limited to Winter/Summer — each entry's `value` must match an
option on the `input_select`. `furnaceGuard` is optional; without it the guard
line is left blank.

Omit `settings` entirely and the Settings button disappears, `/hvac-settings`
returns 404, and the Cameras button keeps its full width. `humidityCooling` and
`seasonalMode` are independent: configure one and only that control renders.

## Blink Ops

Optional operations tooling for a [Blink live-view proxy][proxy] running
alongside the panel. It adds a **Blink Status** button to the Cameras page
whose modal shows live-view proxy health and Home Assistant Blink integration
state, and offers a proxy restart, an integration reload, and an SMS re-auth
flow.

```json
"blinkOps": {
  "proxyStatusUrl": "http://127.0.0.1:8088/status",
  "reauthSpool": "/var/spool/blink-reauth/request.json",
  "reauthStatus": "/run/blink-reauth/status.json",
  "proxyRestartSpool": "/var/spool/blink-liveview-proxy-restart/request",
  "watchdogMs": 30000
}
```

| Key | Effect when set |
|---|---|
| `proxyStatusUrl` | Enables the whole feature. Without it none of the UI or the `/cameras/blink-*` routes exist. |
| `reauthSpool` / `reauthStatus` | Enables the SMS re-auth flow. |
| `proxyRestartSpool` | Enables **Restart Proxy** and the automatic restart when the proxy looks stale on page open. |
| `watchdogMs` | Reloads the Blink integration on this interval when the cameras look stuck. `0` disables it. |

The spool paths exist because the panel service is hardened
(`NoNewPrivileges`, `ProtectSystem=strict`) and cannot restart services or run
a privileged re-auth itself. It writes a request file instead; root systemd
`.path` units watch those files and do the work. Install that half with:

```sh
sudo ops/install-blink-ops.sh
```

which drops `scripts/blink-reauth.py` into `/usr/local/sbin`, creates the spool
directories, installs the units from `ops/systemd/`, and adds the
`ReadWritePaths` drop-in the hardened service needs. If a spool directory is
missing the panel says so in the modal rather than failing silently.

[proxy]: https://github.com/Teethree89/ha-blink-live-view-proxy

## Defaults and Precedence

Config keys are merged over the built-in defaults, so a config file only needs
the keys it wants to change. Objects merge key by key; arrays and scalars are
replaced outright, so listing three rooms yields exactly three room cards.

Sections that map one specific house — `metrics`, `mode`, `comfort`, `balance`,
`actions`, `thermostats`, `statusPanel`, `safetyPanel`, `rooms`, `settings`,
`cameraPanel`, `cameras`, and `blinkOps` — are the exception: once you supply a
config file, these come from that file alone. Inheriting them would show you
entities you do not own just because you omitted a key.

Environment variables win over the config file:

| Setting | Env var | Config key |
|---|---|---|
| Bind address | `HOST` | `server.host` |
| Port | `PORT` | `server.port` |
| Poll interval | `POLL_MS` | `server.pollMs` |
| HA URL | `HA_URL` | `homeAssistant.url` |
| Browser URL | `HA_BROWSER_URL` | `homeAssistant.browserUrl` |
| Token | `HA_TOKEN` | — (never stored in config) |

The panel logs which config file it loaded at startup, or that it fell back to
the built-in defaults. A config file that fails to parse is reported and the
defaults are used, so a bad edit degrades instead of taking the panel down.
