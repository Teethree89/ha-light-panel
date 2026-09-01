#!/usr/bin/env node
// Runs the panel against a fake Home Assistant, so you can look at it (or take
// a screenshot for the README) without a real HA instance, a token, or exposing
// your own house's entities.
//
//   npm run demo
//
// The panel talks to Home Assistant over two REST endpoints and nothing else:
//
//   GET  /api/states            -> array of { entity_id, state, attributes }
//   POST /api/services/<d>/<s>  -> fire a service, response body unused
//
// That is the whole contract, so a small stub is indistinguishable from the
// real thing as far as the panel is concerned. Entity ids below match
// examples/frameo-climate.json.

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = process.env.DEMO_CONFIG || path.join(ROOT, 'examples/frameo-climate.json');
const PANEL_PORT = Number(process.env.PORT || 8890);
const HA_PORT = Number(process.env.DEMO_HA_PORT || 8123);
const HA_ONLY = process.argv.includes('--ha-only');

const sensor = (id, state, attributes = {}) => ({ entity_id: id, state: String(state), attributes });

// A plausible mild evening: cooling just finished, everything healthy.
const STATES = [
  // headline metrics
  sensor('sensor.home_temperature', 71.4),
  sensor('sensor.home_humidity', 46),
  sensor('sensor.average_temperature', 71.1),
  sensor('sensor.outside_temperature', 58),
  sensor('sensor.hvac_inferred_action', 'idle'),

  // host stats strip
  sensor('sensor.ha_server_cpu_temp', 47),
  sensor('sensor.ha_server_ddr_temp', 43),
  sensor('sensor.ha_server_ram_used', 38),
  sensor('sensor.ha_server_cpu_load', 0.42),
  sensor('sensor.ha_server_disk_used', 61),

  // mode card
  sensor('sensor.hvac_operating_state', 'idle'),
  sensor('input_boolean.hvac_automation_enabled', 'on'),
  sensor('binary_sensor.active_thermostat_unavailable', 'off'),
  sensor('binary_sensor.heat_demand', 'off'),
  sensor('binary_sensor.cool_demand', 'off'),
  sensor('binary_sensor.dehumidify_recommended', 'off'),
  sensor('timer.airflow_boost', 'idle', { remaining: '0:00:00', duration: '0:20:00' }),
  sensor('timer.dry_assist', 'idle', { remaining: '0:00:00', duration: '0:30:00' }),
  sensor('timer.post_dry_fan_purge', 'idle', { remaining: '0:00:00', duration: '0:10:00' }),
  sensor('timer.airflow_manual_override', 'idle', { remaining: '0:00:00' }),
  sensor('sensor.airflow_focus_zone', 'Bedroom'),

  // comfort band
  sensor('sensor.heat_target', 68),
  sensor('sensor.cool_target', 75),
  sensor('input_boolean.comfort_hold_active', 'off'),
  sensor('input_boolean.schedule_enabled', 'on'),
  sensor('sensor.schedule_period', 'day'),
  sensor('sensor.schedule_comfort_setting', 'balanced'),

  // rooms
  sensor('sensor.living_room_temperature', 71.8),
  sensor('sensor.living_room_humidity', 45),
  sensor('sensor.living_room_sensor_battery', 92),
  sensor('sensor.bedroom_temperature', 69.6),
  sensor('sensor.bedroom_humidity', 47),
  sensor('sensor.bedroom_sensor_battery', 88),
  sensor('sensor.nursery_temperature', 70.9),
  sensor('sensor.nursery_humidity', 48),
  sensor('sensor.nursery_sensor_battery', 74),
  sensor('sensor.nursery_sleep_state', 'sleeping'),
  sensor('climate.main_thermostat', 'heat_cool', { current_temperature: 71.2, current_humidity: 46, hvac_mode: 'heat_cool' }),
  sensor('sensor.main_thermostat_temperature', 71.2),
  sensor('climate.mini_split', 'cool', { current_temperature: 70.4, fan_mode: 'medium_low', hvac_mode: 'cool' }),
  sensor('sensor.mini_split_inferred_action', 'idle'),

  // status widget
  sensor('sensor.status_heart_rate', 98),
  sensor('sensor.status_oxygen', 98),
  sensor('sensor.status_oxygen_average', 97),
  sensor('sensor.status_battery', 76),
  sensor('sensor.status_battery_remaining', 512),
  sensor('sensor.status_signal_strength', -54),
  sensor('sensor.status_skin_temperature', 93.4),
  sensor('sensor.status_sleep_state', 'sleeping'),
  sensor('binary_sensor.status_charging', 'off'),
  sensor('binary_sensor.status_not_worn', 'off'),
  sensor('binary_sensor.status_disconnected', 'off'),
  sensor('binary_sensor.status_alert', 'off'),

  // smoke / CO strip, all clear
  sensor('binary_sensor.kitchen_smoke_alarm', 'off'),
  sensor('binary_sensor.kitchen_hardwire_smoke_alarm', 'off'),
  sensor('binary_sensor.kitchen_co_alarm', 'off'),
  sensor('binary_sensor.living_room_smoke_alarm', 'off'),
  sensor('binary_sensor.bedroom_smoke_alarm', 'off'),
  sensor('binary_sensor.nursery_smoke_alarm', 'off'),
  sensor('binary_sensor.nursery_co_alarm', 'off'),
  sensor('binary_sensor.garage_smoke_alarm', 'off'),

  // cameras
  sensor('alarm_control_panel.home_alarm', 'armed_away'),
  sensor('binary_sensor.camera_live_proxy', 'on'),
  ...['driveway', 'front_door', 'powered_camera'].flatMap(slug => [
    sensor(`camera.${slug}`, 'idle', {
      entity_picture: `/api/camera_proxy/camera.${slug}`,
      battery_level: slug === 'driveway' ? 84 : 61
    }),
    sensor(`camera.blink_live_${slug}`, 'idle', { access_token: 'demo' }),
    sensor(`binary_sensor.${slug}_battery`, 'off'),
    sensor(`binary_sensor.${slug}_motion`, 'off'),
    sensor(`switch.${slug}_camera_motion_detection`, 'on'),
    sensor(`switch.${slug}_motion_detection`, 'on'),
    sensor(`sensor.${slug}_temperature`, 64)
  ]),

  // Backs the optional /hvac-settings page.
  sensor('input_boolean.humidity_biased_cooling_enabled', 'on'),
  sensor('input_select.seasonal_mode', 'Summer', {
    options: ['Winter', 'Summer']
  }),
  sensor('binary_sensor.furnace_outdoor_guard_active', 'on')
];

// Stand-in camera image, so snapshot tiles are not broken images.
function placeholderImage(label) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
      <rect width="640" height="360" fill="#0f172a"/>
      <text x="320" y="176" text-anchor="middle" fill="#334155"
        font-family="system-ui,sans-serif" font-size="34" font-weight="700">DEMO CAMERA</text>
      <text x="320" y="212" text-anchor="middle" fill="#1e293b"
        font-family="system-ui,sans-serif" font-size="20">${label}</text>
    </svg>`
  );
}

const ha = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/states') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(STATES));
    return;
  }

  if (url.pathname.startsWith('/api/camera_proxy/')) {
    const label = url.pathname.split('/').pop();
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
    res.end(placeholderImage(label));
    return;
  }

  if (url.pathname.startsWith('/api/services/')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      console.log(`[fake-ha] service ${url.pathname.replace('/api/services/', '')} ${body || '{}'}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('[]');
    });
    return;
  }

  // Live view and clips belong to the Blink proxy, which the demo does not run.
  if (url.pathname.startsWith('/api/blink_liveview_proxy/')) {
    res.writeHead(503, { 'content-type': 'text/plain' });
    res.end('The demo does not run the Blink Liveview Proxy.');
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

ha.listen(HA_PORT, '127.0.0.1', () => {
  console.log(`[fake-ha]  listening on http://127.0.0.1:${HA_PORT} (${STATES.length} entities)`);

  if (HA_ONLY) {
    console.log('[fake-ha]  --ha-only: not starting the panel.');
    console.log(`[fake-ha]  Point the panel at it with HA_URL=http://127.0.0.1:${HA_PORT} HA_TOKEN=demo`);
    return;
  }

  const panel = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(PANEL_PORT),
      HA_URL: `http://127.0.0.1:${HA_PORT}`,
      HA_BROWSER_URL: `http://127.0.0.1:${HA_PORT}`,
      HA_TOKEN: 'demo-token',
      CONFIG_PATH: CONFIG
    },
    stdio: 'inherit'
  });

  console.log(`[demo]     config: ${CONFIG}`);
  console.log(`[demo]     open http://127.0.0.1:${PANEL_PORT}/  (cameras: /cameras)`);

  const stop = () => {
    panel.kill('SIGTERM');
    ha.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  panel.on('exit', code => {
    ha.close();
    process.exit(code ?? 0);
  });
});
