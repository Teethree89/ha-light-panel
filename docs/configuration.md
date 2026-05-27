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
