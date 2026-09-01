const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// Config loading
//
// Everything the panel renders is described by a config file. The built-in
// DEFAULT_CONFIG below is the reference deployment, so the server still starts
// and renders with no config file present. Anything in the config file is
// merged over those defaults, and environment variables win over both.
// ---------------------------------------------------------------------------

const CONFIG_PATH = process.env.CONFIG_PATH || path.resolve(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  server: {
    host: '0.0.0.0',
    port: 8890,
    pollMs: 2000
  },
  homeAssistant: {
    url: 'http://ha-server.local:8123',
    browserUrl: '',
    secureBrowserUrl: ''
  },
  panel: {
    title: 'Frameo Climate',
    thermostats: {
      primary: { entity: 'climate.my_ecobee_3', tempEntity: 'sensor.my_ecobee_current_temperature_2' },
      mini: { entity: 'climate.kitchen_mini_split' }
    },
    metrics: {
      roomTemp: 'sensor.hybrid_hvac_room_temperature',
      roomHumidity: 'sensor.hybrid_hvac_room_humidity',
      averageTemp: 'sensor.hybrid_hvac_average_temperature',
      outsideTemp: 'sensor.gree_vireo_24k_outside_temperature',
      action: 'sensor.gree_inferred_action',
      cpuTemp: 'sensor.ha_server_cpu_temp',
      ddrTemp: 'sensor.ha_server_ddr_temp',
      ramUsed: 'sensor.ha_server_ram_used',
      cpuLoad: 'sensor.ha_server_cpu_load',
      diskUsed: 'sensor.ha_server_disk_used'
    },
    mode: {
      operatingState: 'sensor.hybrid_hvac_operating_state',
      miniMode: 'climate.kitchen_mini_split',
      action: 'sensor.gree_inferred_action',
      airflowBoostTimer: 'timer.hybrid_hvac_airflow_boost',
      dryAssistTimer: 'timer.hybrid_hvac_dry_assist',
      postDryFanTimer: 'timer.hybrid_hvac_post_dry_fan_purge',
      automationEnabled: 'input_boolean.hybrid_hvac_heat_control_enabled',
      thermostatUnavailable: 'binary_sensor.hybrid_hvac_active_thermostat_unavailable',
      heatDemand: 'binary_sensor.hybrid_hvac_heat_demand',
      coolDemand: 'binary_sensor.hybrid_hvac_cool_demand',
      humidityDemand: 'binary_sensor.hybrid_hvac_dehumidify_recommended',
      heatingStates: ['gree_heating'],
      coolingStates: ['gree_cooling']
    },
    comfort: {
      heatTarget: 'sensor.hybrid_hvac_heat_target',
      coolTarget: 'sensor.hybrid_hvac_cool_target',
      holdActive: 'input_boolean.hybrid_hvac_comfort_hold_active',
      scheduleEnabled: 'input_boolean.hybrid_hvac_schedule_enabled',
      schedulePeriod: 'sensor.hybrid_hvac_schedule_period',
      scheduleProfile: 'sensor.hybrid_hvac_schedule_comfort_setting'
    },
    balance: {
      manualOverrideTimer: 'timer.hybrid_hvac_airflow_manual_override',
      focusZone: 'sensor.hybrid_hvac_airflow_focus_zone',
      focusRooms: ['Living Room', 'Master Bedroom', 'Rennis Room'],
      activeStates: ['gree_cooling', 'gree_heating']
    },
    actions: {
      cooler: { service: 'script.hybrid_hvac_adjust_comfort_temperature', data: { direction: 'down', step: 1 } },
      warmer: { service: 'script.hybrid_hvac_adjust_comfort_temperature', data: { direction: 'up', step: 1 } },
      reset: { service: 'script.hybrid_hvac_reset_gree_target', data: {} },
      assist: { service: 'script.hybrid_hvac_start_airflow_assist_now', data: {} },
      silenceAlarm: { service: 'script.family_safety_hush_active_smoke_alarms', data: {} }
    },
    // Optional /hvac-settings page, reached from the Settings button. Drop the
    // whole block (or blank out the entities) and the button and the route
    // both disappear.
    settings: {
      title: 'HVAC Settings',
      humidityCooling: {
        entity: 'input_boolean.hybrid_hvac_humidity_biased_cooling_enabled',
        label: 'Humidity-Biased Cooling',
        hint: 'When indoor humidity is above the max humidity setting, this lowers the mini split\'s cooling target a few degrees so it keeps condensing water instead of just cooling dry air. Turning it off leaves cooling at the plain comfort target regardless of humidity.'
      },
      seasonalMode: {
        entity: 'input_select.hybrid_hvac_seasonal_mode',
        furnaceGuard: 'binary_sensor.hybrid_hvac_furnace_outdoor_guard_active',
        label: 'Seasonal Mode',
        hint: 'Switching modes means physically reconfiguring the registers, their covers, the furnace, and the fresh air intake. Tapping the mode you are not in shows the checklist before anything changes. Summer Mode also holds the furnace back automatically, regardless of outdoor temperature, since the registers and fresh air intake are covered; Winter Mode leaves the furnace fully available.',
        options: [
          {
            value: 'Winter',
            label: 'Winter Mode',
            icon: '\u2744\ufe0f',
            title: 'Switch to Winter Mode?',
            confirmLabel: 'I Understand \u2014 Switch to Winter',
            steps: ['Open all supply registers.', 'Open the fresh air intake.']
          },
          {
            value: 'Summer',
            label: 'Summer Mode',
            icon: '\u2600\ufe0f',
            title: 'Switch to Summer Mode?',
            confirmLabel: 'I Understand \u2014 Switch to Summer',
            steps: [
              'Close all supply registers.',
              'Put the register covers on.',
              'Open the furnace.',
              'Close the fresh air intake.'
            ]
          }
        ]
      }
    },
    statusPanel: {
      label: 'Status',
      heart: 'sensor.renni_s_smart_sock_heart_rate',
      oxygen: 'sensor.renni_s_smart_sock_o2_saturation',
      oxygenAverage: 'sensor.renni_s_smart_sock_o2_saturation_10_minute_average',
      battery: 'sensor.renni_s_smart_sock_battery_percentage',
      remaining: 'sensor.renni_s_smart_sock_battery_remaining',
      signal: 'sensor.renni_s_smart_sock_signal_strength',
      skinTemp: 'sensor.renni_s_smart_sock_skin_temperature',
      sleep: 'sensor.renni_s_smart_sock_sleep_state',
      charging: 'binary_sensor.renni_s_smart_sock_charging',
      sockOff: 'binary_sensor.renni_s_smart_sock_sock_off',
      disconnected: 'binary_sensor.renni_s_smart_sock_sock_disconnected_alert',
      alerts: [
        'binary_sensor.renni_s_smart_sock_high_heart_rate_alert',
        'binary_sensor.renni_s_smart_sock_low_heart_rate_alert',
        'binary_sensor.renni_s_smart_sock_high_oxygen_alert',
        'binary_sensor.renni_s_smart_sock_low_oxygen_alert',
        'binary_sensor.renni_s_smart_sock_low_battery_alert',
        'binary_sensor.renni_s_smart_sock_lost_power_alert'
      ]
    },
    safetyPanel: {
      rooms: [
        {
          id: 'kitchen',
          label: 'Kitchen',
          smoke: [
            'binary_sensor.kitchen_smoke_alarm',
            'binary_sensor.kitchen_hardwire_smoke_alarm',
            'binary_sensor.kitchen_too_much_smoke'
          ],
          co: 'binary_sensor.kitchen_co_alarm'
        },
        {
          id: 'office',
          label: 'Office',
          smoke: [
            'binary_sensor.office_smoke_alarm',
            'binary_sensor.office_hardwire_smoke_alarm',
            'binary_sensor.office_too_much_smoke'
          ]
        },
        {
          id: 'master',
          label: 'Master',
          smoke: [
            'binary_sensor.master_smoke_alarm',
            'binary_sensor.master_hardwire_smoke_alarm',
            'binary_sensor.master_too_much_smoke'
          ]
        },
        {
          id: 'rennis',
          label: "Renni's",
          smoke: [
            'binary_sensor.rennis_room_smoke_alarm',
            'binary_sensor.rennis_room_hardwire_smoke_alarm',
            'binary_sensor.rennis_room_too_much_smoke'
          ]
        },
        {
          id: 'living',
          label: 'Living',
          smoke: [
            'binary_sensor.living_room_smoke_alarm',
            'binary_sensor.living_room_hardwire_smoke_alarm',
            'binary_sensor.living_room_too_much_smoke'
          ]
        }
      ]
    },
    rooms: [
      {
        id: 'living',
        label: 'Living Room',
        temp: 'sensor.sonoff_snzb_02dr2_temperature',
        humidity: 'sensor.sonoff_snzb_02dr2_humidity',
        battery: 'sensor.sonoff_snzb_02dr2_battery'
      },
      {
        id: 'master',
        label: 'Master Bedroom',
        temp: 'sensor.sonoff_snzb_02dr2_temperature_2',
        humidity: 'sensor.sonoff_snzb_02dr2_humidity_2',
        battery: 'sensor.sonoff_snzb_02dr2_battery_2'
      },
      {
        id: 'rennis',
        label: 'Rennis Room',
        temp: 'sensor.sonoff_snzb_02dr2_temperature_3',
        humidity: 'sensor.sonoff_snzb_02dr2_humidity_3',
        battery: 'sensor.sonoff_snzb_02dr2_battery_3',
        extra: { type: 'statusPanel' }
      },
      {
        id: 'ecobee',
        label: 'Ecobee',
        temp: [
          'sensor.my_ecobee_current_temperature_2',
          { entity: 'climate.my_ecobee_3', attribute: 'current_temperature' }
        ],
        humidity: { entity: 'climate.my_ecobee_3', attribute: 'current_humidity' },
        extra: { entity: 'climate.my_ecobee_3', hvacModeLabel: true }
      },
      {
        id: 'mini',
        label: 'Mini Split',
        temp: { entity: 'climate.kitchen_mini_split', attribute: 'current_temperature' },
        miniStatus: {
          mode: 'climate.kitchen_mini_split',
          fan: { entity: 'climate.kitchen_mini_split', attribute: 'fan_mode' },
          action: 'sensor.gree_inferred_action'
        }
      },
      {
        id: 'whole',
        label: 'Whole Home',
        temp: ['sensor.hybrid_hvac_average_temperature', 'sensor.hybrid_hvac_room_temperature'],
        humidity: 'sensor.hybrid_hvac_room_humidity',
        extra: { type: 'comfortStatus' }
      }
    ]
  },
  cameraPanel: {
    alarmEntity: 'alarm_control_panel.blink_114_cooper',
    liveProxyEntity: 'binary_sensor.blink_liveview_proxy',
    snapshotRefreshPath: '/api/blink_liveview_proxy/cameras/{slug}/snapshot-refresh'
  },
  cameras: [
    {
      slug: 'driveway',
      label: 'Driveway',
      sourceEntity: 'camera.driveway',
      liveEntity: 'camera.blink_live_driveway',
      batteryEntity: 'binary_sensor.driveway_battery',
      motionEntity: 'binary_sensor.driveway_motion',
      motionSwitch: 'switch.driveway_camera_motion_detection',
      tempEntity: 'sensor.blink_driveway_temperature'
    },
    {
      slug: 'back_porch',
      label: 'Back Porch',
      sourceEntity: 'camera.back_porch',
      liveEntity: 'camera.blink_live_back_porch',
      batteryEntity: 'binary_sensor.back_porch_battery',
      motionEntity: 'binary_sensor.back_porch_motion',
      motionSwitch: 'switch.back_porch_camera_motion_detection',
      tempEntity: 'sensor.blink_back_porch_temperature'
    },
    {
      slug: 'riccis_window',
      label: "Ricci's Window",
      sourceEntity: 'camera.riccis_window',
      liveEntity: 'camera.blink_live_riccis_window',
      batteryEntity: 'binary_sensor.riccis_window_battery',
      motionEntity: 'binary_sensor.riccis_window_motion',
      motionSwitch: 'switch.riccis_window_camera_motion_detection',
      tempEntity: 'sensor.blink_riccis_window_temperature'
    },
    {
      slug: 'back_door',
      label: 'Back Door',
      sourceEntity: 'camera.back_door',
      liveEntity: 'camera.blink_live_back_door',
      batteryEntity: 'binary_sensor.back_door_battery',
      motionEntity: 'binary_sensor.back_door_motion',
      motionSwitch: 'switch.back_door_camera_motion_detection',
      tempEntity: 'sensor.blink_back_door_temperature'
    },
    {
      slug: 'oven_cam',
      label: 'Oven Cam',
      sourceEntity: 'camera.oven_cam',
      liveEntity: 'camera.blink_live_oven_cam',
      powerLabel: 'USB power',
      motionEntity: 'binary_sensor.oven_cam_motion',
      motionSwitch: 'switch.oven_cam_camera_motion_detection'
    },
    {
      slug: 'front_droor',
      label: 'Front Door',
      sourceEntity: 'camera.front_droor',
      liveEntity: 'camera.blink_live_front_droor',
      ignoreBatteryLevel: true,
      batteryEntity: 'binary_sensor.front_droor_battery',
      motionEntity: 'binary_sensor.front_droor_motion',
      motionSwitch: 'switch.front_droor_camera_motion_detection'
    }
  ]
};

// JSON with `//` and `/* */` comments, matching scripts/validate-config.js.
function stripJsonComments(text) {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      output += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1;
      index += 1;
      continue;
    }
    output += char;
  }
  return output;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Objects merge key by key; arrays and scalars are replaced outright, so a
// config file that lists three rooms gets exactly three rooms.
function mergeConfig(base, override) {
  if (!isPlainObject(override)) return override === undefined ? base : override;
  if (!isPlainObject(base)) return override;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = value === undefined ? result[key] : mergeConfig(result[key], value);
  }
  return result;
}

// Sections that map one specific house's entities. When a config file is
// supplied these come from that file alone — inheriting the reference
// deployment here would show a new user cameras and smoke alarms they do not
// own, just because they omitted a key. Structural defaults (server ports,
// labels, titles) are still inherited.
const DEPLOYMENT_SECTIONS = [
  ['panel', 'metrics'],
  ['panel', 'mode'],
  ['panel', 'comfort'],
  ['panel', 'balance'],
  ['panel', 'actions'],
  ['panel', 'settings'],
  ['panel', 'thermostats'],
  ['panel', 'statusPanel'],
  ['panel', 'safetyPanel'],
  ['panel', 'rooms'],
  ['cameraPanel'],
  ['cameras']
];

function withoutDeploymentSections(config) {
  const clone = structuredClone(config);
  for (const keys of DEPLOYMENT_SECTIONS) {
    let node = clone;
    for (let index = 0; index < keys.length - 1 && node; index += 1) node = node[keys[index]];
    if (node) delete node[keys[keys.length - 1]];
  }
  return clone;
}

function loadConfig() {
  let fileConfig = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      fileConfig = JSON.parse(stripJsonComments(fs.readFileSync(CONFIG_PATH, 'utf8')));
      console.log(`Loaded config: ${CONFIG_PATH}`);
    } catch (error) {
      console.error(`Config error in ${CONFIG_PATH}: ${error.message}`);
      console.error('Falling back to built-in defaults.');
      fileConfig = {};
    }
  } else {
    console.log(`No config at ${CONFIG_PATH}; using built-in defaults.`);
  }
  const base = Object.keys(fileConfig).length
    ? withoutDeploymentSections(DEFAULT_CONFIG)
    : DEFAULT_CONFIG;
  return mergeConfig(base, fileConfig);
}

const CONFIG = loadConfig();
const PANEL = CONFIG.panel || {};
const LABELS = PANEL.labels || {};
const CAMERA_PANEL = CONFIG.cameraPanel || {};
const CAMERAS = Array.isArray(CONFIG.cameras) ? CONFIG.cameras : [];

// A bad env value used to yield NaN, which silently listened on a random port
// and made the poll throttle compare against NaN (that is, poll every request).
function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const HOST = process.env.HOST || CONFIG.server?.host || '0.0.0.0';
const PORT = positiveNumber(process.env.PORT, positiveNumber(CONFIG.server?.port, 8890));
const POLL_MS = Math.max(750, positiveNumber(process.env.POLL_MS, positiveNumber(CONFIG.server?.pollMs, 2000)));
const SECRET_FILE = process.env.HA_SECRET_FILE || '';

const ENTITY_ID_PATTERN = /^[a-z_]+\.[a-z0-9_]+$/;

// Rather than maintain a hand-written list that drifts from the config, walk
// the whole config and collect every string that looks like an entity id.
function collectEntityIds(node, found = new Set()) {
  if (typeof node === 'string') {
    if (ENTITY_ID_PATTERN.test(node)) found.add(node);
    return found;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectEntityIds(item, found);
    return found;
  }
  if (isPlainObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      // Service ids (script.foo) live under `actions` and are not entities to poll.
      if (key === 'service') continue;
      collectEntityIds(value, found);
    }
  }
  return found;
}

const ENTITY_IDS = [...collectEntityIds({ panel: PANEL, cameraPanel: CAMERA_PANEL, cameras: CAMERAS })];
const ENTITY_ID_SET = new Set(ENTITY_IDS);

let stateById = {};
let lastPollAt = 0;
let pollPromise = null;
let lastError = '';
let lastBlinkReloadAt = 0;

const BLINK_RELOAD_COOLDOWN_MS = 5 * 60 * 1000;

function readSecretText() {
  if (!SECRET_FILE || !fs.existsSync(SECRET_FILE)) return '';
  return fs.readFileSync(SECRET_FILE, 'utf8');
}

function readSecretField(sectionName, fieldName) {
  const text = readSecretText();
  if (!text) return '';
  const section = text.split(`## ${sectionName}`)[1]?.split('\n## ')[0] || text;
  const match = section.match(new RegExp(`- ${escapeRegex(fieldName)}:\\s*` + '`?([^`\\n]+)`?'));
  return match ? match[1].trim() : '';
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function haBaseUrl() {
  return trimSlash(
    process.env.HA_URL ||
    CONFIG.homeAssistant?.url ||
    readSecretField('Home Assistant UI', 'URL') ||
    'http://ha-server.local:8123'
  );
}

function haBrowserUrl() {
  if (process.env.HA_BROWSER_URL) return trimSlash(process.env.HA_BROWSER_URL);
  if (CONFIG.homeAssistant?.browserUrl) return trimSlash(CONFIG.homeAssistant.browserUrl);
  const fallbackIp = readSecretField('SSH', 'Fallback IP');
  if (fallbackIp) return `http://${fallbackIp}:8123`;
  return haBaseUrl();
}

function haSecureBrowserUrl() {
  if (process.env.HA_SECURE_BROWSER_URL) return trimSlash(process.env.HA_SECURE_BROWSER_URL);
  if (CONFIG.homeAssistant?.secureBrowserUrl) return trimSlash(CONFIG.homeAssistant.secureBrowserUrl);
  try {
    const url = new URL(haBrowserUrl());
    return `https://${url.hostname}`;
  } catch (error) {
    return '';
  }
}

function haToken() {
  return process.env.HA_TOKEN || readSecretField('Home Assistant API', 'Long-Lived Access Token');
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

async function haFetch(apiPath, options = {}) {
  const token = haToken();
  if (!token) throw new Error(`Missing HA token. Set HA_TOKEN or HA_SECRET_FILE.`);

  const response = await fetch(`${haBaseUrl()}${apiPath}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HA ${response.status} ${response.statusText}: ${body.slice(0, 180)}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;
  return response.json();
}

// `passthrough` returns non-2xx responses to the caller instead of throwing, so
// a proxy can relay the real status rather than collapsing it into a 500.
async function haRawFetch(apiPath, options = {}) {
  const { passthrough = false, ...fetchOptions } = options;
  const token = haToken();
  if (!token) throw new Error(`Missing HA token. Set HA_TOKEN or HA_SECRET_FILE.`);

  const response = await fetch(`${haBaseUrl()}${apiPath}`, {
    ...fetchOptions,
    headers: {
      authorization: `Bearer ${token}`,
      ...(fetchOptions.headers || {})
    }
  });

  if (!passthrough && !response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HA ${response.status} ${response.statusText}: ${body.slice(0, 180)}`);
  }

  return response;
}

async function proxyHaResponse(req, res, apiPath, options = {}) {
  const response = await haRawFetch(apiPath, {
    method: req.method,
    headers: pickForwardHeaders(req.headers),
    passthrough: true
  });

  const headers = {
    'content-type': response.headers.get('content-type') || 'application/octet-stream',
    'cache-control': options.cacheControl || response.headers.get('cache-control') || 'no-store'
  };

  // Range metadata has to survive the hop or the browser cannot seek a clip or
  // a live stream. content-length and content-encoding are deliberately not
  // forwarded: fetch() already decompressed the body, so the upstream values
  // would describe bytes we are no longer sending.
  for (const name of ['content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }

  if (options.rewriteHtml) {
    const text = await response.text();
    send(res, response.status, headers, text);
    return;
  }

  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  let closed = false;
  req.on('close', () => {
    closed = true;
    reader.cancel().catch(() => {});
  });

  try {
    while (!closed) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise(resolve => res.once('drain', resolve));
      }
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
}

function proxyHaWebSocket(req, socket, head, apiPath) {
  const token = haToken();
  if (!token) {
    socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\nMissing HA token');
    socket.destroy();
    return;
  }

  let target;
  try {
    target = new URL(haBaseUrl());
  } catch (error) {
    socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\nInvalid HA URL');
    socket.destroy();
    return;
  }

  const transport = target.protocol === 'https:' ? https : http;
  const upstreamReq = transport.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    method: 'GET',
    path: apiPath,
    headers: {
      ...req.headers,
      host: target.host,
      authorization: `Bearer ${token}`
    }
  });

  upstreamReq.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
    socket.write(
      `HTTP/1.1 ${upstreamRes.statusCode || 101} ${upstreamRes.statusMessage || 'Switching Protocols'}\r\n` +
      Object.entries(upstreamRes.headers)
        .map(([name, value]) => Array.isArray(value)
          ? value.map(item => `${name}: ${item}`).join('\r\n')
          : `${name}: ${value}`)
        .join('\r\n') +
      '\r\n\r\n'
    );
    if (upstreamHead?.length) socket.write(upstreamHead);
    if (head?.length) upstreamSocket.write(head);
    upstreamSocket.on('error', () => socket.destroy());
    socket.on('error', () => upstreamSocket.destroy());
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });

  upstreamReq.on('response', response => {
    socket.write(
      `HTTP/1.1 ${response.statusCode || 502} ${response.statusMessage || 'Bad Gateway'}\r\n` +
      Object.entries(response.headers)
        .map(([name, value]) => Array.isArray(value)
          ? value.map(item => `${name}: ${item}`).join('\r\n')
          : `${name}: ${value}`)
        .join('\r\n') +
      '\r\n\r\n'
    );
    response.pipe(socket);
  });

  upstreamReq.on('error', error => {
    if (!socket.destroyed) {
      socket.write(`HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n${error.message}`);
      socket.destroy();
    }
  });

  upstreamReq.end();
}

function blinkStaticAliasPath(pathname) {
  const legacyPrefix = '/local/blink-liveview-proxy/';
  if (!pathname.startsWith(legacyPrefix)) return pathname;
  return `/api/blink_liveview_proxy/static/${encodeURIComponent(pathname.slice(legacyPrefix.length))}`;
}

// A malformed Host header (`Host: a b`) makes `new URL` throw ERR_INVALID_URL.
// At the top of a request handler that throw is uncaught and takes the whole
// process down, so parsing is contained here and falls back to a fixed base.
function parseRequestUrl(req) {
  try {
    return new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (error) {
    try {
      return new URL(req.url, 'http://localhost');
    } catch (innerError) {
      return null;
    }
  }
}

function pickForwardHeaders(headers) {
  const picked = {};
  for (const name of ['accept', 'range', 'user-agent']) {
    if (headers[name]) picked[name] = headers[name];
  }
  return picked;
}

async function pollStates(force = false) {
  const now = Date.now();
  if (!force && now - lastPollAt < POLL_MS && Object.keys(stateById).length) return stateById;
  if (pollPromise) return pollPromise;

  pollPromise = (async () => {
    const states = await haFetch('/api/states');
    const next = {};
    for (const item of states || []) {
      if (ENTITY_ID_SET.has(item.entity_id)) next[item.entity_id] = item;
    }
    stateById = next;
    lastPollAt = Date.now();
    lastError = '';
    return stateById;
  })().catch(error => {
    lastError = error.message;
    throw error;
  }).finally(() => {
    pollPromise = null;
  });

  return pollPromise;
}

function entity(id) {
  return stateById[id] || null;
}

function state(id, fallback = 'unknown') {
  return entity(id)?.state ?? fallback;
}

function attr(id, name, fallback = null) {
  const value = entity(id)?.attributes?.[name];
  return value === undefined || value === null ? fallback : value;
}

function isOn(id) {
  return state(id, 'off') === 'on';
}

function numberState(id, fallback = null) {
  const value = Number.parseFloat(state(id, ''));
  return Number.isFinite(value) ? value : fallback;
}

function numberAttr(id, name, fallback = null) {
  const value = Number.parseFloat(attr(id, name, ''));
  return Number.isFinite(value) ? value : fallback;
}

function round(value, places = 0) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function titleCase(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function isValidState(value) {
  return value !== undefined && value !== null && !['', 'unknown', 'unavailable', 'none'].includes(String(value));
}

function textState(id, fallback = '--') {
  const value = state(id, '');
  return isValidState(value) ? String(value) : fallback;
}

// A config value pointing at a reading. Accepts a bare entity id, an
// { entity, attribute } pair, or an array of either that is tried in order so a
// card can fall back from a dedicated sensor to a climate entity's attribute.
function specNumber(spec, places = 1) {
  if (spec === undefined || spec === null || spec === '') return null;
  if (Array.isArray(spec)) {
    for (const candidate of spec) {
      const value = specNumber(candidate, places);
      if (value !== null) return value;
    }
    return null;
  }
  if (typeof spec === 'object') {
    if (!spec.entity) return null;
    const value = spec.attribute
      ? numberAttr(spec.entity, spec.attribute)
      : numberState(spec.entity);
    return round(value, places);
  }
  return round(numberState(spec), places);
}

function specText(spec, fallback = '') {
  if (!spec) return fallback;
  if (Array.isArray(spec)) {
    for (const candidate of spec) {
      const value = specText(candidate, '');
      if (isValidState(value)) return value;
    }
    return fallback;
  }
  if (typeof spec === 'object') {
    if (!spec.entity) return fallback;
    const value = spec.attribute
      ? attr(spec.entity, spec.attribute, '')
      : state(spec.entity, '');
    return isValidState(value) ? String(value) : fallback;
  }
  return textState(spec, fallback);
}

// The `extra` line under a room's temperature. Either a literal string or one
// of the shapes documented in docs/configuration.md.
function roomExtra(spec, context) {
  if (!spec) return '';
  if (typeof spec === 'string') return spec;
  if (spec.type === 'comfortStatus') return context.comfort?.status || '';
  if (spec.type === 'statusPanel') return context.status?.status || '';
  if (spec.hvacModeLabel) return hvacModeLabel(state(spec.entity, 'unknown'));
  if (spec.entity) return specText(spec, spec.fallback || '');
  return '';
}

function buildRoom(room, context) {
  const card = {
    id: room.id,
    label: room.label,
    temp: specNumber(room.temp, 1),
    humidity: specNumber(room.humidity, 1),
    battery: room.battery ? specNumber(room.battery, 0) : null,
    extra: roomExtra(room.extra, context)
  };

  if (room.miniStatus) {
    const mode = specText(room.miniStatus.mode, '');
    card.miniStatus = {
      fan: miniFanLabel(mode, specText(room.miniStatus.fan, '')),
      compressor: miniActionLabel(specText(room.miniStatus.action, ''))
    };
  }

  return card;
}

function hvacModeLabel(value) {
  const text = String(value || '');
  const labels = {
    heat_cool: 'Auto temp',
    cool: 'Cooling',
    heat: 'Heating',
    off: 'Off',
    auto: 'Auto',
    dry: 'Dry',
    fan_only: 'Fan only'
  };
  return labels[text] || titleCase(text);
}

function miniFanLabel(hvacMode, fanMode) {
  const mode = String(hvacMode || '');
  if (mode === 'off') return 'Off';
  if (!isValidState(fanMode)) return hvacModeLabel(mode);
  const text = String(fanMode || '').toLowerCase();
  const labels = {
    auto: 'Auto',
    quiet: 'Quiet',
    low: 'Low',
    medium_low: 'Med Lo',
    medium: 'Med',
    medium_high: 'Med Hi',
    high: 'High',
    turbo: 'Turbo'
  };
  return labels[text] || titleCase(text).replace('Medium', 'Med').replace('Low', 'Lo').replace('High', 'Hi');
}

function miniActionLabel(value) {
  const text = String(value || '');
  const labels = {
    off: 'Off',
    idle: 'Idle',
    cool: 'Cool',
    cooling: 'Cool',
    heat: 'Heat',
    heating: 'Heat',
    dry: 'Dry',
    drying: 'Dry',
    dehumidify: 'Dry',
    fan_only: 'Fan'
  };
  return labels[text] || titleCase(text);
}

function durationSeconds(value) {
  const parts = String(value || '').split(':').map(part => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return null;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function secondsLabel(seconds) {
  if (!Number.isFinite(seconds)) return '';
  if (seconds <= 0) return '';
  const minutes = Math.ceil(seconds / 60);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} hr ${rest} min left` : `${hours} hr left`;
  }
  return `${minutes} min left`;
}

function remainingLabel(value) {
  return secondsLabel(durationSeconds(value));
}

function timerRemainingSeconds(entityId) {
  if (state(entityId) === 'active') {
    const finishesAt = Date.parse(attr(entityId, 'finishes_at', ''));
    if (Number.isFinite(finishesAt)) {
      return Math.max(0, Math.ceil((finishesAt - Date.now()) / 1000));
    }
  }
  return durationSeconds(attr(entityId, 'remaining', ''));
}

function timerInfo(label, entityId) {
  const remainingSeconds = timerRemainingSeconds(entityId);
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) return null;
  const duration = durationSeconds(attr(entityId, 'duration', ''));
  const totalSeconds = Number.isFinite(duration) && duration > 0 ? duration : remainingSeconds;
  return {
    label,
    remainingSeconds,
    totalSeconds,
    remaining: secondsLabel(remainingSeconds),
    progress: Math.max(0, Math.min(1, remainingSeconds / totalSeconds))
  };
}

function timerDetail(label, entityId) {
  const timer = timerInfo(label, entityId);
  return timer?.remaining ? `${label}: ${timer.remaining}` : label;
}

function cameraConfig(slug) {
  return CAMERAS.find(camera => camera.slug === slug) || null;
}

function cameraSummary(camera) {
  const source = entity(camera.sourceEntity);
  const sourceState = state(camera.sourceEntity, 'unknown');
  const snapshotAvailable = Boolean(source?.attributes?.entity_picture);
  const batteryLevel = camera.ignoreBatteryLevel ? null : Number.parseFloat(source?.attributes?.battery_level);
  const batteryLow = camera.powerLabel || !camera.batteryEntity ? false : isOn(camera.batteryEntity);
  const temp = camera.tempEntity ? round(numberState(camera.tempEntity), 0) : null;
  const motion = state(camera.motionEntity, 'off');
  const motionEnabled = state(camera.motionSwitch, 'unknown');
  const battery = camera.powerLabel ||
    (Number.isFinite(batteryLevel)
      ? `${Math.round(batteryLevel)}%`
      : camera.batteryEntity
        ? batteryLow ? 'Low' : 'OK'
        : '');

  return {
    slug: camera.slug,
    label: camera.label,
    snapshotUrl: `/camera/${camera.slug}/snapshot.jpg`,
    liveUrl: `/live/${camera.slug}`,
    clipsUrl: `/clips/${camera.slug}`,
    sourceEntity: camera.sourceEntity,
    snapshotAvailable,
    battery,
    powerLabel: camera.powerLabel || '',
    batteryLow,
    motion,
    motionEnabled,
    temp: camera.tempEntity && temp !== null ? `${temp} F` : '',
    state: sourceState
  };
}

function cameraNeedsBlinkReload(camera) {
  return camera.state === 'unavailable' || camera.state === 'unknown' || !camera.snapshotAvailable;
}

function camerasState() {
  const cameras = CAMERAS.map(cameraSummary);
  return {
    ok: !lastError,
    error: lastError,
    updatedAt: new Date(lastPollAt || Date.now()).toISOString(),
    alarm: {
      entityId: CAMERA_PANEL.alarmEntity || '',
      state: CAMERA_PANEL.alarmEntity ? state(CAMERA_PANEL.alarmEntity, 'unknown') : 'unknown'
    },
    liveProxy: CAMERA_PANEL.liveProxyEntity ? state(CAMERA_PANEL.liveProxyEntity, 'unknown') : 'unknown',
    lastBlinkReloadAt: lastBlinkReloadAt ? new Date(lastBlinkReloadAt).toISOString() : '',
    snapshotIssue: cameras.some(cameraNeedsBlinkReload),
    cameras
  };
}

function modeSummary() {
  const mode = PANEL.mode || {};

  if (mode.automationEnabled && state(mode.automationEnabled, 'on') === 'off') {
    return { type: 'paused', label: 'Paused', detail: 'Automation disabled' };
  }
  if (mode.thermostatUnavailable && isOn(mode.thermostatUnavailable)) {
    return { type: 'offline', label: 'Offline', detail: 'Active thermostat unavailable' };
  }
  if (mode.airflowBoostTimer && state(mode.airflowBoostTimer, 'idle') === 'active') {
    return {
      type: 'balance',
      label: 'Balancing',
      detail: timerDetail('Airflow boost', mode.airflowBoostTimer),
      timer: timerInfo('Airflow', mode.airflowBoostTimer)
    };
  }
  if (mode.dryAssistTimer && state(mode.dryAssistTimer, 'idle') === 'active') {
    return {
      type: 'dry',
      label: 'Dry assist',
      detail: timerDetail('Dry assist', mode.dryAssistTimer),
      timer: timerInfo('Drying', mode.dryAssistTimer)
    };
  }
  if (mode.postDryFanTimer && state(mode.postDryFanTimer, 'idle') === 'active') {
    return {
      type: 'fan',
      label: 'Circulating',
      detail: timerDetail('Coil dry fan', mode.postDryFanTimer),
      timer: timerInfo('Fan', mode.postDryFanTimer)
    };
  }

  const operatingState = mode.operatingState ? state(mode.operatingState, '') : '';
  const miniMode = mode.miniMode ? state(mode.miniMode, '') : '';
  const miniAction = mode.action ? state(mode.action, '') : '';

  if (miniMode === 'dry' || ['dry', 'drying', 'dehumidify'].includes(miniAction)) {
    return { type: 'dry', label: 'Dry assist', detail: 'Drying house air' };
  }
  if (mode.heatDemand && isOn(mode.heatDemand)) {
    return { type: 'heat', label: 'Heating', detail: 'Warming the house' };
  }
  if (mode.coolDemand && isOn(mode.coolDemand) && mode.humidityDemand && isOn(mode.humidityDemand)) {
    return { type: 'cool', label: 'Humidity cooling', detail: 'Cooling with RH bias' };
  }
  if (mode.coolDemand && isOn(mode.coolDemand)) {
    return { type: 'cool', label: 'Cooling', detail: 'Cooling the house' };
  }
  if ((mode.heatingStates || []).includes(operatingState)) {
    return { type: 'heat', label: 'Heating', detail: 'Warming the house' };
  }
  if ((mode.coolingStates || []).includes(operatingState)) {
    return { type: 'cool', label: 'Cooling', detail: 'Cooling the house' };
  }
  if (miniMode === 'fan_only' || ['fan', 'fan_only'].includes(miniAction)) {
    return { type: 'fan', label: 'Circulating', detail: 'Fan only' };
  }
  return { type: 'hold', label: 'Comfort OK', detail: 'Inside comfort band' };
}

function comfortSummary() {
  const config = PANEL.comfort || {};
  const heat = config.heatTarget ? round(numberState(config.heatTarget), 0) : null;
  const cool = config.coolTarget ? round(numberState(config.coolTarget), 0) : null;
  const holdActive = config.holdActive ? isOn(config.holdActive) : false;
  const scheduleActive = config.scheduleEnabled ? isOn(config.scheduleEnabled) : false;
  const period = config.schedulePeriod ? state(config.schedulePeriod, 'off') : 'off';
  const profile = config.scheduleProfile ? state(config.scheduleProfile, '') : '';

  let status = 'Thermostat range';
  if (holdActive) {
    status = 'Temporary hold';
  } else if (scheduleActive && ['day', 'night'].includes(period)) {
    status = `${titleCase(profile)} schedule`;
  }

  return {
    heat,
    cool,
    center: heat !== null && cool !== null ? round((heat + cool) / 2, 1) : null,
    holdActive,
    scheduleActive,
    period,
    profile,
    status
  };
}

function dashboardState() {
  const metrics = PANEL.metrics || {};
  const thermostats = PANEL.thermostats || {};
  const primary = thermostats.primary || {};
  const mini = thermostats.mini || {};

  const comfort = comfortSummary();
  const status = statusSummary();

  const primaryTemp = specNumber(
    [primary.tempEntity, primary.entity && { entity: primary.entity, attribute: 'current_temperature' }]
      .filter(Boolean),
    1
  );
  const miniSplitTemp = mini.entity
    ? specNumber({ entity: mini.entity, attribute: 'current_temperature' }, 1)
    : null;
  const miniAction = metrics.action ? state(metrics.action, 'unknown') : 'unknown';
  const avgTemp = specNumber([metrics.averageTemp, metrics.roomTemp].filter(Boolean), 1);

  const rooms = (PANEL.rooms || []).map(room => buildRoom(room, { comfort, status }));

  return {
    ok: !lastError,
    error: lastError,
    updatedAt: new Date(lastPollAt || Date.now()).toISOString(),
    mode: modeSummary(),
    comfort,
    metrics: {
      roomTemp: specNumber(metrics.roomTemp, 1),
      roomHumidity: specNumber(metrics.roomHumidity, 1),
      averageTemp: avgTemp,
      outsideTemp: specNumber(metrics.outsideTemp, 0),
      cpuTemp: specNumber(metrics.cpuTemp, 0),
      ddrTemp: specNumber(metrics.ddrTemp, 0),
      ramUsed: specNumber(metrics.ramUsed, 0),
      cpuLoad: specNumber(metrics.cpuLoad, 2),
      diskUsed: specNumber(metrics.diskUsed, 0),
      greeAction: miniAction,
      ecobeeTemp: primaryTemp,
      miniSplitTemp,
      miniSplitMode: mini.entity ? attr(mini.entity, 'hvac_mode', state(mini.entity, 'unknown')) : 'unknown',
      ecobeeMode: primary.entity ? attr(primary.entity, 'hvac_mode', state(primary.entity, 'unknown')) : 'unknown'
    },
    alarm: {
      entityId: CAMERA_PANEL.alarmEntity || '',
      state: CAMERA_PANEL.alarmEntity ? state(CAMERA_PANEL.alarmEntity, 'unknown') : 'unknown'
    },
    balance: balanceAvailability(),
    alarmPanel: alarmPanelSummary(),
    rooms,
    sock: status,
    settings: settingsSummary()
  };
}

// Backs the optional /hvac-settings page. Every field is null when the
// matching entity is not configured, and the page hides that control.
function settingsSummary() {
  const settings = PANEL.settings || {};
  const humidity = settings.humidityCooling || {};
  const season = settings.seasonalMode || {};
  const options = (Array.isArray(season.options) ? season.options : []).map(option => option.value);
  const current = season.entity ? state(season.entity, '') : '';

  return {
    humidityCoolingEnabled: humidity.entity ? isOn(humidity.entity) : null,
    seasonalMode: options.includes(current) ? current : (options[0] || ''),
    furnaceGuardActive: season.furnaceGuard ? isOn(season.furnaceGuard) : null
  };
}

// The optional side widget. Named `statusPanel` in config; the /state payload
// still exposes it as `sock` so existing clients keep working.
function statusSummary() {
  const config = PANEL.statusPanel || {};
  const heart = specNumber(config.heart, 0);
  const oxygen = specNumber(config.oxygen, 0);
  const oxygenAverage = specNumber(config.oxygenAverage, 0);
  const battery = specNumber(config.battery, 0);
  const remaining = specNumber(config.remaining, 0);
  const signal = specNumber(config.signal, 0);
  const skinTemp = specNumber(config.skinTemp, 1);
  const sleep = config.sleep ? textState(config.sleep, '') : '';
  const charging = config.charging ? isOn(config.charging) : false;
  const sockOff = config.sockOff ? isOn(config.sockOff) : false;
  const disconnected = config.disconnected ? isOn(config.disconnected) : false;
  const alert = (config.alerts || []).some(isOn);

  let status = 'Standing by';
  if (alert) status = 'Alert';
  else if (disconnected) status = 'Disconnected';
  else if (sockOff) status = 'Sock off';
  else if (charging) status = 'Charging';
  else if (isValidState(sleep)) status = titleCase(sleep);
  else if (heart !== null || oxygen !== null) status = 'Monitoring';

  return {
    status,
    alert,
    charging,
    sockOff,
    disconnected,
    heart,
    oxygen,
    oxygenAverage,
    battery,
    remaining,
    signal,
    skinTemp
  };
}

function balanceAvailability() {
  const config = PANEL.balance || {};
  const mode = PANEL.mode || {};
  const operatingState = mode.operatingState ? state(mode.operatingState, 'unknown') : 'unknown';
  const miniMode = mode.miniMode ? state(mode.miniMode, 'unknown') : 'unknown';
  const miniAction = mode.action ? state(mode.action, 'unknown') : 'unknown';
  const manualOverride = config.manualOverrideTimer ? state(config.manualOverrideTimer, 'idle') : 'idle';
  const focusZone = config.focusZone ? state(config.focusZone, 'unknown') : 'unknown';
  const focusRooms = config.focusRooms || [];
  const validFocus = focusRooms.includes(focusZone);
  const activeDemand = (config.activeStates || []).includes(operatingState);
  const dryAssist = miniMode === 'dry' || ['dry', 'drying', 'dehumidify'].includes(miniAction);
  const reasons = [];

  if (!activeDemand && dryAssist) {
    reasons.push('Dry assist is active; Balance Rooms waits for active heating or cooling.');
  } else if (!activeDemand) {
    reasons.push('Balance Rooms only runs while the mini split is actively heating or cooling.');
  }
  if (miniMode === 'fan_only') reasons.push('The mini split is already in fan-only mode.');
  if (manualOverride !== 'idle') reasons.push('A manual airflow override is still active.');
  if (!validFocus) reasons.push('There is not a room that needs an airflow boost right now.');

  return {
    canRun: reasons.length === 0,
    reason: reasons[0] || 'Ready to balance rooms.',
    detail: activeDemand
      ? `Focus room: ${validFocus ? focusZone : 'none'}`
      : dryAssist
        ? `Gree is drying air, not cooling. Focus room: ${validFocus ? focusZone : 'none'}`
      : `Current HVAC state: ${operatingState.replace(/_/g, ' ') || 'idle'}`,
    operatingState,
    focusZone,
    manualOverride
  };
}

// Turns a configured { service: "script.foo", data: {...} } into an HA call.
async function callConfiguredService(action, overrides = {}) {
  if (!action?.service) throw new Error('Action is not configured.');
  const [domain, service] = String(action.service).split('.');
  if (!domain || !service) throw new Error(`Invalid service: ${action.service}`);
  await haFetch(`/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, {
    method: 'POST',
    body: JSON.stringify({ ...(action.data || {}), ...overrides })
  });
}

// Smoke/CO rollup for the safety strip. Room list comes from
// panel.safetyPanel.rooms so this is not tied to one house's sensors.
function alarmPanelSummary() {
  const combine = ids => {
    const values = (ids || []).map(id => state(id, 'unknown'));
    if (!values.length) return 'na';
    if (values.includes('on')) return true;
    return values.every(value => value === 'off') ? false : null;
  };
  const rooms = ((PANEL.safetyPanel || {}).rooms || []).map(room => ({
    id: room.id,
    label: room.label,
    smoke: combine(room.smoke),
    co: room.co ? combine(Array.isArray(room.co) ? room.co : [room.co]) : 'na'
  }));
  return { anyActive: rooms.some(room => room.smoke === true || room.co === true), rooms };
}

async function adjustComfortBand(direction, moveBand) {
  const actions = PANEL.actions || {};
  const action = direction === 'down' ? actions.cooler : actions.warmer;
  if (!action?.service) throw new Error(`No ${direction === 'down' ? 'cooler' : 'warmer'} action is configured.`);

  if (!moveBand) {
    await callConfiguredService(action, { direction });
    return;
  }

  const comfort = PANEL.comfort || {};
  const heat = comfort.heatTarget ? numberState(comfort.heatTarget) : null;
  const cool = comfort.coolTarget ? numberState(comfort.coolTarget) : null;
  if (!Number.isFinite(heat) || !Number.isFinite(cool) || cool <= heat) {
    throw new Error('Comfort band is unavailable.');
  }

  const center = (heat + cool) / 2;
  const nextHeat = direction === 'down' ? (center - 1) - (cool - heat) : center + 1;
  const adjustment = nextHeat - heat;
  await callConfiguredService(action, {
    direction: adjustment >= 0 ? 'up' : 'down',
    step: Math.max(0.5, Math.abs(adjustment))
  });
}

async function callAction(name, options = {}) {
  const actions = PANEL.actions || {};

  if (name === 'blinkToggle') {
    const alarmEntity = CAMERA_PANEL.alarmEntity;
    if (!alarmEntity) throw new Error('No alarm entity is configured.');
    const armed = state(alarmEntity, 'unknown').startsWith('armed');
    await haFetch(`/api/services/alarm_control_panel/${armed ? 'alarm_disarm' : 'alarm_arm_away'}`, {
      method: 'POST',
      body: JSON.stringify({ entity_id: alarmEntity })
    });
    await pollStates(true).catch(() => {});
    return;
  }

  if (name === 'cooler') {
    await adjustComfortBand('down', Boolean(options.moveBand));
    return;
  }

  if (name === 'warmer') {
    await adjustComfortBand('up', Boolean(options.moveBand));
    return;
  }

  if (name === 'humidityCoolingToggle') {
    const entity = (PANEL.settings || {}).humidityCooling?.entity;
    if (!entity) throw new Error('No humidity-biased cooling entity is configured.');
    await haFetch('/api/services/input_boolean/toggle', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entity })
    });
    return;
  }

  if (name === 'seasonModeSet') {
    const season = (PANEL.settings || {}).seasonalMode || {};
    if (!season.entity) throw new Error('No seasonal mode entity is configured.');
    const allowed = (Array.isArray(season.options) ? season.options : []).map(option => option.value);
    const mode = String(options.mode || '');
    if (!allowed.includes(mode)) throw new Error(`Invalid seasonal mode: ${mode}`);
    await haFetch('/api/services/input_select/select_option', {
      method: 'POST',
      body: JSON.stringify({ entity_id: season.entity, option: mode })
    });
    return;
  }

  if (name === 'reset' || name === 'assist' || name === 'silenceAlarm') {
    if (!actions[name]?.service) throw new Error(`No ${name} action is configured.`);
    await callConfiguredService(actions[name]);
    return;
  }

  throw new Error(`Unsupported action: ${name}`);
}

async function refreshCameraSnapshot(slug) {
  const camera = cameraConfig(slug);
  if (!camera) throw new Error(`Unknown camera: ${slug}`);
  const template = CAMERA_PANEL.snapshotRefreshPath
    || '/api/blink_liveview_proxy/cameras/{slug}/snapshot-refresh';
  await haFetch(template.replace('{slug}', encodeURIComponent(slug)), {
    method: 'POST',
    body: JSON.stringify({})
  });
  await pollStates(true).catch(() => {});
  return cameraSummary(camera);
}

async function reloadBlinkIntegration(options = {}) {
  const force = Boolean(options.force);
  await pollStates(true).catch(() => {});
  const before = CAMERAS.map(cameraSummary);
  const needsReload = before.some(cameraNeedsBlinkReload);
  const now = Date.now();
  const cooldownRemainingMs = Math.max(0, BLINK_RELOAD_COOLDOWN_MS - (now - lastBlinkReloadAt));

  if (!force && !needsReload) {
    return {
      ...camerasState(),
      reloaded: false,
      skipped: true,
      reason: 'snapshots_available'
    };
  }

  if (!force && lastBlinkReloadAt && cooldownRemainingMs > 0) {
    return {
      ...camerasState(),
      reloaded: false,
      skipped: true,
      reason: 'cooldown',
      cooldownRemainingMs
    };
  }

  lastBlinkReloadAt = now;
  await haFetch('/api/services/homeassistant/reload_config_entry', {
    method: 'POST',
    body: JSON.stringify({ entity_id: CAMERAS[0].sourceEntity })
  });
  await pollStates(true).catch(() => {});

  return {
    ...camerasState(),
    reloaded: true,
    skipped: false,
    reason: 'reloaded'
  };
}

async function toggleCameraMotion(slug) {
  const camera = cameraConfig(slug);
  if (!camera) throw new Error(`Unknown camera: ${slug}`);
  const enabled = state(camera.motionSwitch, 'off') === 'on';
  await haFetch(`/api/services/switch/turn_${enabled ? 'off' : 'on'}`, {
    method: 'POST',
    body: JSON.stringify({ entity_id: camera.motionSwitch })
  });
  await pollStates(true).catch(() => {});
  return cameraSummary(camera);
}

async function fetchCameraSnapshot(slug) {
  const camera = cameraConfig(slug);
  if (!camera) throw new Error(`Unknown camera: ${slug}`);
  await pollStates();

  let picture = attr(camera.sourceEntity, 'entity_picture', '');
  if (!picture) {
    const statePayload = await haFetch(`/api/states/${encodeURIComponent(camera.sourceEntity)}`);
    picture = statePayload?.attributes?.entity_picture || '';
  }
  if (!picture) throw new Error(`Camera has no snapshot: ${slug}`);

  const response = await haRawFetch(picture, {
    headers: { accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' }
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    contentType: response.headers.get('content-type') || 'image/jpeg'
  };
}

async function clipsForCamera(slug) {
  if (!cameraConfig(slug)) throw new Error(`Unknown camera: ${slug}`);
  return haFetch(`/api/blink_liveview_proxy/clips?camera=${encodeURIComponent(slug)}&hours=24&limit=20`);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const limit = 32 * 1024;
    let body = '';
    let settled = false;

    // Destroying the request on an oversized body used to leave this promise
    // pending forever, because neither `end` nor `error` fires afterwards.
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };

    req.on('data', chunk => {
      if (settled) return;
      body += chunk;
      if (body.length > limit) {
        const error = new Error('Request body too large.');
        error.statusCode = 413;
        // Stop reading but leave the socket alive long enough for the handler
        // to write a real 413 instead of hanging the connection up.
        req.pause();
        finish(error);
      }
    });
    req.on('end', () => {
      try {
        finish(null, body ? JSON.parse(body) : {});
      } catch (error) {
        finish(error);
      }
    });
    req.on('error', error => finish(error));
    req.on('aborted', () => finish(new Error('Request aborted.')));
  });
}

function send(res, status, headers, body = '') {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }, JSON.stringify(body));
}

// When the panel is reached through a reverse proxy that mounts it under a
// path prefix -- the bundled `ha_light_panel` Home Assistant integration does
// this so Nabu Casa can tunnel the panel -- the proxy forwards an
// `X-Ingress-Path` header naming the prefix the browser sees (e.g.
// `/api/ha_light_panel`). This script makes every client-side `fetch`/XHR
// absolute under that prefix, so one relative dashboard link works both on the
// LAN and remotely. Paths under `/api/blink_liveview_proxy/` are left at the
// origin root, because Home Assistant core serves those views itself. Reached
// directly on the LAN there is no header, the base is empty, and behaviour is
// unchanged.
function ingressHeadScript(ib) {
  return `<script>
(function () {
  window.IB = ${JSON.stringify(ib || '')};
  var IB = window.IB;
  if (!IB) return;
  function abs(u) {
    if (typeof u !== 'string' || !u) return u;
    if (u.charAt(0) !== '/' || u.charAt(1) === '/') return u;
    if (u.indexOf('/api/blink_liveview_proxy/') === 0) return u;
    if (u === IB || u.indexOf(IB + '/') === 0) return u;
    return IB + u;
  }
  var nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function (input, init) {
      return typeof input === 'string'
        ? nativeFetch.call(this, abs(input), init)
        : nativeFetch.call(this, input, init);
    };
  }
  var nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (typeof url === 'string') arguments[1] = abs(url);
    return nativeOpen.apply(this, arguments);
  };
})();
</script>`;
}

// The bottom-left nav row. With the settings page configured this splits into
// Cameras + Settings; without it, Cameras keeps the full width it had before
// the settings page existed.
function navButtonsMarkup() {
  const cameraIcon = `        <g transform="translate(${'${iconX}'} 17)">
          <rect width="44" height="36" fill="transparent"/>
          <g transform="translate(7 5)">
          <rect x="0" y="4" width="30" height="22" rx="5" fill="none" stroke="#fff" stroke-width="3"/>
          <path d="M9 4 L13 0 H22 L26 4" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
          <circle cx="15" cy="15" r="5" fill="none" stroke="#fff" stroke-width="3"/>
          </g>
        </g>`;

  if (!settingsPageEnabled()) {
    return `      <g class="button" id="camerasButton" transform="translate(28 532)">
        <rect width="376" height="70" rx="8" fill="#0f766e"/>
${cameraIcon.replace('${iconX}', '112')}
        <rect x="166" y="16" width="108" height="42" fill="transparent"/>
        <text x="220" y="43" text-anchor="middle" fill="#fff" font-size="25" font-weight="850">Cameras</text>
      </g>`;
  }

  return `      <g class="button" id="camerasButton" transform="translate(28 532)">
        <rect width="180" height="70" rx="8" fill="#0f766e"/>
${cameraIcon.replace('${iconX}', '18')}
        <rect x="62" y="16" width="106" height="42" fill="transparent"/>
        <text x="112" y="43" text-anchor="middle" fill="#fff" font-size="20" font-weight="850">Cameras</text>
      </g>

      <g class="button" id="settingsButton" transform="translate(224 532)">
        <rect width="180" height="70" rx="8" fill="#334155"/>
        <g transform="translate(18 17)">
          <rect width="36" height="36" fill="transparent"/>
          <circle cx="18" cy="18" r="7" fill="none" stroke="#fff" stroke-width="3"/>
          <path fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"
            d="M18 4 L18 8 M18 28 L18 32 M4 18 L8 18 M28 18 L32 18
               M7.8 7.8 L10.6 10.6 M25.4 25.4 L28.2 28.2 M7.8 28.2 L10.6 25.4 M25.4 10.6 L28.2 7.8"/>
        </g>
        <rect x="62" y="16" width="106" height="42" fill="transparent"/>
        <text x="112" y="43" text-anchor="middle" fill="#fff" font-size="20" font-weight="850">Settings</text>
      </g>`;
}

function clientHtml(ib = '') {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <title>${escapeHtml(PANEL.title || 'Frameo Climate')}</title>
  ${ingressHeadScript(ib)}
  <style>
    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: #071017;
      color: #f8fafc;
      font-family: Inter, Roboto, Arial, sans-serif;
      user-select: none;
      touch-action: none;
    }

    svg {
      display: block;
      width: 100vw;
      height: 100vh;
      background: #071017;
    }

    text {
      dominant-baseline: auto;
      letter-spacing: 0;
      pointer-events: none;
    }

    .card {
      fill: #0f1d29;
      stroke: rgba(255,255,255,0.08);
      stroke-width: 1;
    }

    .button {
      cursor: pointer;
      touch-action: manipulation;
    }

    .button rect,
    .button path {
      transition: opacity 0.05s linear;
    }

    .button:active rect,
    .button:active path {
      opacity: 0.78;
    }

    .label {
      fill: rgba(248,250,252,0.7);
      font-size: 18px;
      font-weight: 650;
    }

    .value {
      fill: #fff;
      font-size: 34px;
      font-weight: 850;
    }

    .small {
      fill: rgba(248,250,252,0.75);
      font-size: 15px;
      font-weight: 650;
    }

    .tiny {
      fill: rgba(248,250,252,0.68);
      font-size: 13px;
      font-weight: 650;
    }

    .metric-icon {
      fill: none;
      stroke: rgba(248,250,252,0.72);
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .map-line {
      stroke: rgba(255,255,255,0.22);
      stroke-width: 3;
      fill: none;
    }

    .room {
      stroke: rgba(255,255,255,0.18);
      stroke-width: 2;
    }

    .heat-spot {
      mix-blend-mode: screen;
      pointer-events: none;
    }

    .pill {
      fill: rgba(5,8,12,0.68);
      stroke: rgba(255,255,255,0.28);
      stroke-width: 1;
    }

    .pending .pending-dim {
      opacity: 0.68;
    }

    .action-spinner {
      display: none;
      pointer-events: none;
    }

    .pending .action-spinner {
      display: block;
    }

    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(2,6,10,0.58);
      z-index: 100;
    }

    .modal-backdrop.hidden {
      display: none;
    }

    .modal {
      width: min(480px, calc(100vw - 48px));
      border-radius: 8px;
      padding: 24px;
      background: #0f1d29;
      border: 1px solid rgba(255,255,255,0.14);
      box-shadow: 0 24px 72px rgba(0,0,0,0.45);
    }

    .modal-title {
      margin: 0 0 10px;
      font-size: 24px;
      font-weight: 850;
    }

    .modal-body {
      margin: 0 0 20px;
      color: rgba(248,250,252,0.76);
      font-size: 17px;
      line-height: 1.38;
    }

    .modal-button {
      border: 0;
      border-radius: 8px;
      padding: 13px 20px;
      background: #38bdf8;
      color: #03111c;
      font: inherit;
      font-size: 17px;
      font-weight: 850;
    }
    @keyframes alarmPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.55; }
    }
    .alarm-pulse { animation: alarmPulse 1.1s ease-in-out infinite; }

    /* Portrait phones (e.g. the dashboard embedded in the HA app): let the
       panel fill the width and scroll vertically. applyLayout() switches the
       SVG to a tall viewBox and stacks the panels. Landscape (the frame,
       tablets, desktop) is unaffected. */
    @media (max-aspect-ratio: 1 / 1) {
      html,
      body {
        height: auto;
        min-height: 100%;
        overflow-x: hidden;
        overflow-y: auto;
        touch-action: pan-y;
      }
      svg#dash {
        width: 100vw;
        height: auto;
      }
    }

  </style>
</head>
<body>
  <svg id="dash" viewBox="0 0 1280 800" role="img" aria-label="Frameo climate dashboard">
    <defs>
      <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#0b1f28"/>
        <stop offset="0.55" stop-color="#08151f"/>
        <stop offset="1" stop-color="#05080c"/>
      </linearGradient>
      <linearGradient id="modeGrad" x1="0" x2="1" y1="0" y2="1">
        <stop id="modeGradA" offset="0" stop-color="#22c55e"/>
        <stop id="modeGradB" offset="1" stop-color="#047857"/>
      </linearGradient>
      <linearGradient id="coolGrad" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#38bdf8"/>
        <stop offset="1" stop-color="#1d4ed8"/>
      </linearGradient>
      <linearGradient id="heatGrad" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#fb923c"/>
        <stop offset="1" stop-color="#b91c1c"/>
      </linearGradient>
      <linearGradient id="resetGrad" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#14b8a6"/>
        <stop offset="1" stop-color="#0f766e"/>
      </linearGradient>
    </defs>

    <rect width="1280" height="800" fill="url(#bg)"/>

    <g id="topCards">
      <g id="topCard0" class="button" data-action="blinkToggle" transform="translate(24 20)">
        <rect id="blinkCard" class="pending-dim" width="230" height="112" rx="8" fill="#334155"/>
        <text id="hdrBlink" x="18" y="38" class="label">Blink system</text>
        <text id="blinkState" x="18" y="78" class="value">--</text>
        <text id="blinkHint" x="18" y="99" class="tiny">Tap to arm</text>
        <g class="action-spinner" data-spinner="blinkToggle" transform="translate(204 34)">
          <circle r="12" fill="none" stroke="rgba(255,255,255,0.86)" stroke-width="4" stroke-linecap="round" stroke-dasharray="20 56">
            <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.8s" repeatCount="indefinite"/>
          </circle>
        </g>
      </g>
      <g id="topCard1" transform="translate(270 20)">
        <rect id="modeCard" width="230" height="112" rx="8" fill="url(#modeGrad)"/>
        <text id="hdrMode" x="18" y="38" class="label">${escapeHtml(LABELS.mode || 'Current mode')}</text>
        <text id="modeLabel" x="18" y="78" class="value">--</text>
        <g id="modeTimerGroup" transform="translate(18 91)" style="display:none">
          <rect width="146" height="6" rx="3" fill="rgba(255,255,255,0.24)"/>
          <rect id="modeTimerBar" width="0" height="6" rx="3" fill="rgba(255,255,255,0.88)"/>
          <text id="modeTimerText" x="158" y="8" class="tiny">--</text>
        </g>
      </g>
      <g id="topCard2" transform="translate(516 20)">
        <rect class="card" width="230" height="112" rx="8"/>
        <text id="hdrComfort" x="18" y="38" class="label">${escapeHtml(LABELS.comfortBand || 'Comfort band')}</text>
        <text id="band" x="18" y="78" class="value">--</text>
      </g>
      <g id="topCard3" transform="translate(762 20)">
        <rect class="card" width="230" height="112" rx="8"/>
        <text id="hdrOutside" x="18" y="38" class="label">${escapeHtml(LABELS.outside || 'Outside')}</text>
        <text id="outside" x="18" y="78" class="value">--</text>
      </g>
      <g id="topCard4" transform="translate(1008 20)">
        <rect id="systemCard" class="card" width="248" height="112" rx="8"/>
        <text id="hdrHaBox" x="18" y="38" class="label">HA box</text>
        <text id="systemTemps" x="18" y="72" fill="#fff" font-size="28" font-weight="900">--</text>
        <text id="systemLoad" x="18" y="99" class="tiny">--</text>
      </g>
    </g>

    <g id="roomsPanel" transform="translate(24 156)">
      <rect id="roomsBg" width="776" height="620" rx="8" fill="#071017" stroke="rgba(255,255,255,0.08)"/>
      <text id="roomsTitle" x="24" y="42"><tspan id="roomsTitleLabel" class="label">${escapeHtml(LABELS.rooms || 'Rooms & thermostats')}</tspan><tspan id="roomsSubtitle" fill="rgba(248,250,252,0.4)" font-size="14" font-weight="600"> • Live comfort readings</tspan></text>

      <g id="roomCard0" transform="translate(24 94)">
        <rect id="roomFill0" width="226" height="208" rx="8" fill="#102131" stroke="rgba(255,255,255,0.08)"/>
        <circle id="roomDot0" cx="190" cy="34" r="12" fill="#22c55e"/>
        <text id="roomName0" x="18" y="42" class="label">--</text>
        <text id="roomTemp0" x="18" y="105" fill="#fff" font-size="52" font-weight="900">--</text>
        <g id="roomHumGroup0" transform="translate(20 128)">
          <path id="roomHumIcon0" class="metric-icon" d="M10 2 C6 7 3 10.8 3 14.2 C3 18.3 6.1 21 10 21 C13.9 21 17 18.3 17 14.2 C17 10.8 14 7 10 2 Z"/>
          <text id="roomHum0" x="26" y="18" class="small">--</text>
        </g>
        <g id="roomBatteryGroup0" transform="translate(120 130)">
          <rect class="metric-icon" x="0" y="4" width="22" height="13" rx="3"/>
          <path class="metric-icon" d="M25 8 L25 13"/>
          <text id="roomBattery0" x="36" y="17" class="small">--</text>
        </g>
        <text id="roomExtra0" x="20" y="178" class="tiny">--</text>
      </g>

      <g id="roomCard1" transform="translate(275 94)">
        <rect id="roomFill1" width="226" height="208" rx="8" fill="#102131" stroke="rgba(255,255,255,0.08)"/>
        <circle id="roomDot1" cx="190" cy="34" r="12" fill="#22c55e"/>
        <text id="roomName1" x="18" y="42" class="label">--</text>
        <text id="roomTemp1" x="18" y="105" fill="#fff" font-size="52" font-weight="900">--</text>
        <g id="roomHumGroup1" transform="translate(20 128)">
          <path id="roomHumIcon1" class="metric-icon" d="M10 2 C6 7 3 10.8 3 14.2 C3 18.3 6.1 21 10 21 C13.9 21 17 18.3 17 14.2 C17 10.8 14 7 10 2 Z"/>
          <text id="roomHum1" x="26" y="18" class="small">--</text>
        </g>
        <g id="roomBatteryGroup1" transform="translate(120 130)">
          <rect class="metric-icon" x="0" y="4" width="22" height="13" rx="3"/>
          <path class="metric-icon" d="M25 8 L25 13"/>
          <text id="roomBattery1" x="36" y="17" class="small">--</text>
        </g>
        <text id="roomExtra1" x="20" y="178" class="tiny">--</text>
      </g>

      <g id="roomCard2" transform="translate(526 94)">
        <rect id="roomFill2" width="226" height="208" rx="8" fill="#102131" stroke="rgba(255,255,255,0.08)"/>
        <circle id="roomDot2" cx="190" cy="34" r="12" fill="#22c55e"/>
        <text id="roomName2" x="18" y="42" class="label">--</text>
        <text id="roomTemp2" x="18" y="105" fill="#fff" font-size="52" font-weight="900">--</text>
        <g id="roomHumGroup2" transform="translate(20 128)">
          <path id="roomHumIcon2" class="metric-icon" d="M10 2 C6 7 3 10.8 3 14.2 C3 18.3 6.1 21 10 21 C13.9 21 17 18.3 17 14.2 C17 10.8 14 7 10 2 Z"/>
          <text id="roomHum2" x="26" y="18" class="small">--</text>
        </g>
        <g id="roomBatteryGroup2" transform="translate(120 130)">
          <rect class="metric-icon" x="0" y="4" width="22" height="13" rx="3"/>
          <path class="metric-icon" d="M25 8 L25 13"/>
          <text id="roomBattery2" x="36" y="17" class="small">--</text>
        </g>
        <text id="roomExtra2" x="20" y="178" class="tiny">--</text>
      </g>

      <g id="roomCard3" transform="translate(24 313)">
        <rect id="roomFill3" width="226" height="208" rx="8" fill="#102131" stroke="rgba(255,255,255,0.08)"/>
        <circle id="roomDot3" cx="190" cy="34" r="12" fill="#22c55e"/>
        <text id="roomName3" x="18" y="42" class="label">--</text>
        <text id="roomTemp3" x="18" y="105" fill="#fff" font-size="52" font-weight="900">--</text>
        <g id="roomHumGroup3" transform="translate(20 128)">
          <path id="roomHumIcon3" class="metric-icon" d="M10 2 C6 7 3 10.8 3 14.2 C3 18.3 6.1 21 10 21 C13.9 21 17 18.3 17 14.2 C17 10.8 14 7 10 2 Z"/>
          <text id="roomHum3" x="26" y="18" class="small">--</text>
        </g>
        <g id="roomBatteryGroup3" transform="translate(120 130)">
          <rect class="metric-icon" x="0" y="4" width="22" height="13" rx="3"/>
          <path class="metric-icon" d="M25 8 L25 13"/>
          <text id="roomBattery3" x="36" y="17" class="small">--</text>
        </g>
        <text id="roomExtra3" x="20" y="178" class="tiny">--</text>
      </g>

      <g id="roomCard4" transform="translate(275 313)">
        <rect id="roomFill4" width="226" height="208" rx="8" fill="#102131" stroke="rgba(255,255,255,0.08)"/>
        <circle id="roomDot4" cx="190" cy="34" r="12" fill="#22c55e"/>
        <text id="roomName4" x="18" y="42" class="label">--</text>
        <text id="roomTemp4" x="18" y="105" fill="#fff" font-size="52" font-weight="900">--</text>
        <g id="roomHumGroup4" transform="translate(20 128)">
          <path id="roomHumIcon4" class="metric-icon" d="M10 2 C6 7 3 10.8 3 14.2 C3 18.3 6.1 21 10 21 C13.9 21 17 18.3 17 14.2 C17 10.8 14 7 10 2 Z"/>
          <text id="roomHum4" x="26" y="18" class="small">--</text>
        </g>
        <g id="roomBatteryGroup4" transform="translate(120 130)">
          <rect class="metric-icon" x="0" y="4" width="22" height="13" rx="3"/>
          <path class="metric-icon" d="M25 8 L25 13"/>
          <text id="roomBattery4" x="36" y="17" class="small">--</text>
        </g>
        <text id="roomExtra4" x="20" y="178" class="tiny">--</text>
        <g id="roomMiniFanGroup4" transform="translate(20 160)">
          <circle class="metric-icon" cx="11" cy="11" r="2.2"/>
          <path class="metric-icon" d="M11 8 C8 3 13 1 16 5 C14 6 12.5 7 11 8"/>
          <path class="metric-icon" d="M13 12 C19 11 19 17 14 18 C14 15 13.7 13.5 13 12"/>
          <path class="metric-icon" d="M9 12 C6 17 1 14 3 9 C5 11 7 11.7 9 12"/>
          <text id="roomMiniFan4" x="30" y="17" class="tiny">--</text>
        </g>
        <g id="roomMiniCompressorGroup4" transform="translate(118 160)">
          <rect class="metric-icon" x="0" y="5" width="24" height="14" rx="3"/>
          <path class="metric-icon" d="M5 10 H19"/>
          <path class="metric-icon" d="M5 14 H15"/>
          <text id="roomMiniCompressor4" x="32" y="17" class="tiny">--</text>
        </g>
      </g>

      <g id="roomCard5" transform="translate(526 313)">
        <rect id="roomFill5" width="226" height="208" rx="8" fill="#102131" stroke="rgba(255,255,255,0.08)"/>
        <circle id="roomDot5" cx="190" cy="34" r="12" fill="#22c55e"/>
        <text id="roomName5" x="18" y="42" class="label">--</text>
        <text id="roomTemp5" x="18" y="105" fill="#fff" font-size="52" font-weight="900">--</text>
        <g id="roomHumGroup5" transform="translate(20 128)">
          <path id="roomHumIcon5" class="metric-icon" d="M10 2 C6 7 3 10.8 3 14.2 C3 18.3 6.1 21 10 21 C13.9 21 17 18.3 17 14.2 C17 10.8 14 7 10 2 Z"/>
          <text id="roomHum5" x="26" y="18" class="small">--</text>
        </g>
        <g id="roomBatteryGroup5" transform="translate(120 130)">
          <rect class="metric-icon" x="0" y="4" width="22" height="13" rx="3"/>
          <path class="metric-icon" d="M25 8 L25 13"/>
          <text id="roomBattery5" x="36" y="17" class="small">--</text>
        </g>
        <text id="roomExtra5" x="20" y="178" class="tiny">--</text>
      </g>

      <g id="btnBalance" class="button" data-action="assist" transform="translate(24 532)">
        <rect id="balanceBg" class="pending-dim" width="226" height="70" rx="8" fill="#4f46e5"/>
        <g transform="translate(20 27)">
          <path d="M2 23 C13 23 15 7 27 7" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
          <path d="M2 10 C11 10 14 15 22 15" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
          <path d="M23 3 L30 7 L23 12" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M17 11 L24 15 L17 20" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
        <text id="btnBalanceText" x="130" y="47" text-anchor="middle" fill="#fff" font-size="18" font-weight="850">Balance Rooms</text>
        <g class="action-spinner" data-spinner="assist" transform="translate(216 40)">
          <circle r="9" fill="none" stroke="rgba(255,255,255,0.86)" stroke-width="3" stroke-linecap="round" stroke-dasharray="15 42">
            <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.8s" repeatCount="indefinite"/>
          </circle>
        </g>
      </g>

      <g id="btnAlarms" class="button" data-action="showAlarms" transform="translate(275 532)">
        <rect id="alarmCardFill" width="226" height="70" rx="8" fill="#0f1d29" stroke="rgba(255,255,255,0.12)"/>
        <g id="alarmInner">
        <circle id="alarmSmoke0" cx="23" cy="20" r="10" fill="rgba(255,255,255,0.18)"/>
        <text x="23" y="23" text-anchor="middle" font-size="5" font-weight="800" fill="rgba(255,255,255,0.65)">CO</text>
        <text x="23" y="41" text-anchor="middle" fill="rgba(248,250,252,0.55)" font-size="8.5" font-weight="700">Kit</text>
        <text id="alarmStatus0" x="23" y="55" text-anchor="middle" fill="rgba(255,255,255,0.35)" font-size="7.5">--</text>
        <circle id="alarmSmoke1" cx="68" cy="20" r="10" fill="rgba(255,255,255,0.18)"/>
        <circle cx="68" cy="20" r="3" fill="rgba(0,0,0,0.2)"/>
        <text x="68" y="41" text-anchor="middle" fill="rgba(248,250,252,0.55)" font-size="8.5" font-weight="700">Off</text>
        <text id="alarmStatus1" x="68" y="55" text-anchor="middle" fill="rgba(255,255,255,0.35)" font-size="7.5">--</text>
        <circle id="alarmSmoke2" cx="113" cy="20" r="10" fill="rgba(255,255,255,0.18)"/>
        <circle cx="113" cy="20" r="3" fill="rgba(0,0,0,0.2)"/>
        <text x="113" y="41" text-anchor="middle" fill="rgba(248,250,252,0.55)" font-size="8.5" font-weight="700">Mas</text>
        <text id="alarmStatus2" x="113" y="55" text-anchor="middle" fill="rgba(255,255,255,0.35)" font-size="7.5">--</text>
        <circle id="alarmSmoke3" cx="158" cy="20" r="10" fill="rgba(255,255,255,0.18)"/>
        <circle cx="158" cy="20" r="3" fill="rgba(0,0,0,0.2)"/>
        <text x="158" y="41" text-anchor="middle" fill="rgba(248,250,252,0.55)" font-size="8.5" font-weight="700">Ren</text>
        <text id="alarmStatus3" x="158" y="55" text-anchor="middle" fill="rgba(255,255,255,0.35)" font-size="7.5">--</text>
        <circle id="alarmSmoke4" cx="203" cy="20" r="10" fill="rgba(255,255,255,0.18)"/>
        <circle cx="203" cy="20" r="3" fill="rgba(0,0,0,0.2)"/>
        <text x="203" y="41" text-anchor="middle" fill="rgba(248,250,252,0.55)" font-size="8.5" font-weight="700">Liv</text>
        <text id="alarmStatus4" x="203" y="55" text-anchor="middle" fill="rgba(255,255,255,0.35)" font-size="7.5">--</text>
        </g>
      </g>

      <g id="btnSilence" class="button" data-action="silenceAlarm" transform="translate(526 532)">
        <rect id="silenceBtnFill" class="pending-dim" width="226" height="70" rx="8" fill="#166534"/>
        <text id="silenceBtnText" x="90" y="47" text-anchor="middle" fill="#fff" font-size="15" font-weight="850">No Smoke Detected</text>
        <g id="silenceCheckIcon" transform="translate(200 40)">
          <circle r="13" fill="rgba(255,255,255,0.15)"/>
          <path d="M-5 0 L-1 5 L7 -5" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
        <g id="silenceFireIcon" transform="translate(200 40)" style="display:none">
          <path d="M0 11 C-6 11 -10 6 -10 1 C-10 -4 -5 -8 0 -13 C0 -8 2 -5 3 -4 C4 -7 3 -10 4 -13 C4 -8 9 -4 9 1 C9 6 5 11 0 11Z" fill="#f97316"/>
          <path d="M0 7 C-3 7 -5 4 -5 1 C-5 -1 -3 -4 0 -7 C0 -4 2 -2 2 0 C3 -2 2 -4 2 -7 C5 -4 5 1 5 1 C5 4 3 7 0 7Z" fill="#fbbf24"/>
        </g>
        <g class="action-spinner" data-spinner="silenceAlarm" transform="translate(213 40)">
          <circle r="9" fill="none" stroke="rgba(255,255,255,0.86)" stroke-width="3" stroke-linecap="round" stroke-dasharray="15 42">
            <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.8s" repeatCount="indefinite"/>
          </circle>
        </g>
      </g>
    </g>

    <g id="controls" transform="translate(824 156)">
      <rect width="432" height="620" rx="8" fill="#0f1d29" stroke="rgba(255,255,255,0.08)"/>
      <text id="hdrFamily" x="28" y="42" class="label">${escapeHtml(LABELS.target || 'Family target')}</text>
      <text id="targetMain" x="28" y="108" fill="#fff" font-size="64" font-weight="900">--</text>
      <text id="targetDetail" x="30" y="138" class="small">--</text>

      <g class="button" data-action="cooler" transform="translate(28 160)">
        <rect width="176" height="88" rx="8" fill="url(#coolGrad)"/>
        <text x="88" y="50" text-anchor="middle" fill="#fff" font-size="46" font-weight="900">-</text>
        <text x="88" y="74" text-anchor="middle" class="tiny">Cooler</text>
      </g>

      <g class="button" data-action="warmer" transform="translate(228 160)">
        <rect width="176" height="88" rx="8" fill="url(#heatGrad)"/>
        <text x="88" y="50" text-anchor="middle" fill="#fff" font-size="46" font-weight="900">+</text>
        <text x="88" y="74" text-anchor="middle" class="tiny">Warmer</text>
      </g>

      <g class="button" data-toggle="moveBand" transform="translate(30 260)">
        <rect id="moveBandBox" width="28" height="28" rx="6" fill="#071017" stroke="rgba(255,255,255,0.36)" stroke-width="2"/>
        <path id="moveBandCheck" d="M7 15 L12 20 L22 8" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" style="display:none"/>
        <text x="42" y="21" class="small">Move comfort band</text>
      </g>

      <g class="button" data-action="reset" transform="translate(28 302)">
        <rect width="376" height="64" rx="8" fill="url(#resetGrad)"/>
        <text x="188" y="42" text-anchor="middle" fill="#fff" font-size="27" font-weight="850">Reset Target</text>
      </g>

      <g id="sockPanel" transform="translate(28 376)">
        <rect id="sockFill" width="376" height="142" rx="8" fill="#0a1620" stroke="rgba(255,255,255,0.08)"/>
        <text id="hdrSock" x="18" y="32" class="small">${escapeHtml((PANEL.statusPanel || {}).label || 'Status')}</text>
        <text id="sockStatus" x="18" y="62" fill="#fff" font-size="28" font-weight="850">--</text>
        <g id="sockHeartMetric" transform="translate(24 96)">
          <rect width="126" height="32" fill="transparent"/>
          <path class="metric-icon" d="M11 21 C5 16 2 13 2 8.8 C2 5.8 4.2 3.8 7 3.8 C8.8 3.8 10.2 4.7 11 6 C11.8 4.7 13.2 3.8 15 3.8 C17.8 3.8 20 5.8 20 8.8 C20 13 17 16 11 21 Z"/>
          <text id="sockHeart" x="42" y="20" fill="#fff" font-size="22" font-weight="850">--</text>
        </g>
        <g id="sockOxygenMetric" transform="translate(172 96)">
          <rect width="82" height="32" fill="transparent"/>
          <circle class="metric-icon" cx="11" cy="12" r="9"/>
          <text x="11" y="16" text-anchor="middle" fill="rgba(248,250,252,0.72)" font-size="9" font-weight="900">O2</text>
          <text id="sockOxygen" x="38" y="20" fill="#fff" font-size="22" font-weight="850">--</text>
        </g>
        <g id="sockBatteryMetric" transform="translate(278 99)">
          <rect width="76" height="29" fill="transparent"/>
          <rect class="metric-icon" x="0" y="4" width="22" height="13" rx="3"/>
          <path class="metric-icon" d="M25 8 L25 13"/>
          <text id="sockBattery" x="38" y="17" fill="#fff" font-size="22" font-weight="850">--</text>
        </g>
        <text id="sockSignal" x="300" y="32" text-anchor="start" class="tiny">--</text>
      </g>

${navButtonsMarkup()}
    </g>

    <text id="connection" x="1254" y="792" text-anchor="end" class="tiny">connecting</text>
  </svg>

  <div id="infoModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="infoModalTitle">
    <div class="modal">
      <h2 id="infoModalTitle" class="modal-title">Balance Rooms</h2>
      <div id="infoModalBody" class="modal-body">Balance Rooms runs during active heating or cooling; dry assist waits for the next heat/cool run.</div>
      <button id="infoModalClose" class="modal-button" type="button">Got it</button>
    </div>
  </div>

  <script>
    const els = {
      modeLabel: document.getElementById('modeLabel'),
      modeGradA: document.getElementById('modeGradA'),
      modeGradB: document.getElementById('modeGradB'),
      modeTimerGroup: document.getElementById('modeTimerGroup'),
      modeTimerBar: document.getElementById('modeTimerBar'),
      modeTimerText: document.getElementById('modeTimerText'),
      blinkCard: document.getElementById('blinkCard'),
      blinkState: document.getElementById('blinkState'),
      blinkHint: document.getElementById('blinkHint'),
      band: document.getElementById('band'),
      outside: document.getElementById('outside'),
      systemCard: document.getElementById('systemCard'),
      systemTemps: document.getElementById('systemTemps'),
      systemLoad: document.getElementById('systemLoad'),
      moveBandBox: document.getElementById('moveBandBox'),
      moveBandCheck: document.getElementById('moveBandCheck'),
      targetMain: document.getElementById('targetMain'),
      targetDetail: document.getElementById('targetDetail'),
      roomsSubtitle: document.getElementById('roomsSubtitle'),
      sockFill: document.getElementById('sockFill'),
      sockStatus: document.getElementById('sockStatus'),
      sockHeart: document.getElementById('sockHeart'),
      sockOxygen: document.getElementById('sockOxygen'),
      sockBattery: document.getElementById('sockBattery'),
      sockSignal: document.getElementById('sockSignal'),
      camerasButton: document.getElementById('camerasButton'),
      connection: document.getElementById('connection'),
      infoModal: document.getElementById('infoModal'),
      infoModalTitle: document.getElementById('infoModalTitle'),
      infoModalBody: document.getElementById('infoModalBody'),
      infoModalClose: document.getElementById('infoModalClose'),
      alarmCardFill: document.getElementById('alarmCardFill'),
      silenceBtnFill: document.getElementById('silenceBtnFill'),
      silenceBtnText: document.getElementById('silenceBtnText'),
      silenceCheckIcon: document.getElementById('silenceCheckIcon'),
      silenceFireIcon: document.getElementById('silenceFireIcon')
    };

    const alarmDots = {
      smoke: Array.from({ length: 5 }, (_, i) => document.getElementById('alarmSmoke' + i))
    };
    const alarmStatusEls = Array.from({ length: 5 }, (_, i) => document.getElementById('alarmStatus' + i));

    const appState = {
      latest: null,
      moveBand: localStorage.getItem('frameoMoveBand') !== 'false'
    };

    const roomNodes = Array.from({ length: 6 }, (_, index) => ({
      fill: document.getElementById('roomFill' + index),
      dot: document.getElementById('roomDot' + index),
      name: document.getElementById('roomName' + index),
      temp: document.getElementById('roomTemp' + index),
      humGroup: document.getElementById('roomHumGroup' + index),
      humIcon: document.getElementById('roomHumIcon' + index),
      hum: document.getElementById('roomHum' + index),
      batteryGroup: document.getElementById('roomBatteryGroup' + index),
      battery: document.getElementById('roomBattery' + index),
      miniFanGroup: document.getElementById('roomMiniFanGroup' + index),
      miniFan: document.getElementById('roomMiniFan' + index),
      miniCompressorGroup: document.getElementById('roomMiniCompressorGroup' + index),
      miniCompressor: document.getElementById('roomMiniCompressor' + index),
      extra: document.getElementById('roomExtra' + index)
    }));

    const modeColors = {
      heat: ['#fb923c', '#b91c1c'],
      cool: ['#38bdf8', '#1d4ed8'],
      dry: ['#38bdf8', '#b45309'],
      balance: ['#a78bfa', '#4f46e5'],
      fan: ['#2dd4bf', '#0f766e'],
      paused: ['#ef4444', '#581c87'],
      offline: ['#f59e0b', '#7c2d12'],
      hold: ['#22c55e', '#047857']
    };

    function setText(id, value) {
      if (!id) return;
      id.textContent = value;
    }

    function setFittedText(id, value, maxWidth, baseSize = 22, minSize = 18) {
      if (!id) return;
      id.textContent = value;
      id.style.fontSize = baseSize + 'px';
      id.removeAttribute('textLength');
      id.removeAttribute('lengthAdjust');
      if (!maxWidth || typeof id.getComputedTextLength !== 'function') return;
      try {
        let size = baseSize;
        while (size > minSize && id.getComputedTextLength() > maxWidth) {
          size -= 1;
          id.style.fontSize = size + 'px';
        }
      } catch (error) {}
    }

    function setModeText(value) {
      if (!els.modeLabel) return;
      setFittedText(els.modeLabel, value, 198, 31, 10);
    }

    function timerClock(seconds) {
      const value = Number(seconds);
      if (!Number.isFinite(value) || value <= 0) return '';
      const total = Math.max(0, Math.ceil(value));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const remainingSeconds = total % 60;
      if (hours > 0) return hours + ':' + String(minutes).padStart(2, '0');
      return minutes + ':' + String(remainingSeconds).padStart(2, '0');
    }

    function setModeTimer(timer) {
      const visible = Boolean(timer && timer.remaining);
      setVisible(els.modeTimerGroup, visible);
      if (!visible) return;
      const progress = Number.isFinite(timer.progress) ? Math.max(0, Math.min(1, timer.progress)) : 1;
      els.modeTimerBar.setAttribute('width', String(Math.max(6, Math.round(146 * progress))));
      setText(els.modeTimerText, timerClock(timer.remainingSeconds) || timer.remaining);
    }

    function temp(value, places = 0) {
      return Number.isFinite(value) ? value.toFixed(places) + ' F' : '--';
    }

    function pct(value) {
      return Number.isFinite(value) ? value.toFixed(value % 1 ? 1 : 0) + '%' : '--';
    }

    function setVisible(node, visible) {
      if (!node) return;
      node.style.display = visible ? '' : 'none';
    }

    function setPending(name, pending) {
      document.querySelectorAll('[data-action="' + name + '"]').forEach(node => {
        node.classList.toggle('pending', pending);
      });
    }

    function setMoveBand(enabled) {
      appState.moveBand = Boolean(enabled);
      localStorage.setItem('frameoMoveBand', String(appState.moveBand));
      if (els.moveBandCheck) els.moveBandCheck.style.display = appState.moveBand ? '' : 'none';
      if (els.moveBandBox) {
        els.moveBandBox.setAttribute('fill', appState.moveBand ? '#0f766e' : '#071017');
        els.moveBandBox.setAttribute('stroke', appState.moveBand ? 'rgba(45,212,191,0.78)' : 'rgba(255,255,255,0.36)');
      }
    }

    function showModal(title, body, isHtml = false) {
      setText(els.infoModalTitle, title);
      if (isHtml) {
        els.infoModalBody.innerHTML = body;
      } else {
        setText(els.infoModalBody, body);
      }
      if (els.infoModal) els.infoModal.classList.remove('hidden');
    }

    function showAlarmModal(alarmPanel) {
      if (!alarmPanel) { showModal('Smoke & CO Alarms', 'Status unavailable.'); return; }
      var rows = alarmPanel.rooms.map(function(room) {
        var s = room.smoke === true ? 'ALARM' : room.smoke === false ? 'OK' : '—';
        var c = room.co === 'na' ? 'N/A' : room.co === true ? 'ALARM' : room.co === false ? 'OK' : '—';
        var sc = room.smoke === true ? '#f87171' : room.smoke === false ? '#4ade80' : '#94a3b8';
        var cc = room.co === 'na' ? '#475569' : room.co === true ? '#f87171' : room.co === false ? '#4ade80' : '#94a3b8';
        return '<tr>' +
          '<td style="padding:5px 14px 5px 0;font-weight:700">' + room.label + '</td>' +
          '<td style="padding:5px 14px 5px 0">Smoke: <b style="color:' + sc + '">' + s + '</b></td>' +
          '<td style="padding:5px 0">CO: <b style="color:' + cc + '">' + c + '</b></td>' +
          '</tr>';
      }).join('');
      showModal('Smoke & CO Alarms', '<table style="border-collapse:collapse;width:100%">' + rows + '</table>', true);
    }

    function applyAlarmPanel(alarmPanel) {
      if (!alarmPanel) return;
      const { anyActive, rooms } = alarmPanel;
      if (els.alarmCardFill) {
        els.alarmCardFill.setAttribute('fill', anyActive ? '#3b0a0a' : '#0f1d29');
        els.alarmCardFill.setAttribute('stroke', anyActive ? 'rgba(248,113,113,0.55)' : 'rgba(255,255,255,0.12)');
      }
      if (els.silenceBtnFill) {
        els.silenceBtnFill.setAttribute('fill', anyActive ? '#991b1b' : '#166534');
        if (anyActive) els.silenceBtnFill.classList.add('alarm-pulse');
        else els.silenceBtnFill.classList.remove('alarm-pulse');
      }
      if (els.silenceBtnText) {
        els.silenceBtnText.textContent = anyActive ? 'Silence Alarm' : 'No Smoke Detected';
        els.silenceBtnText.setAttribute('font-size', anyActive ? '18' : '15');
      }
      if (els.silenceCheckIcon) els.silenceCheckIcon.style.display = anyActive ? 'none' : '';
      if (els.silenceFireIcon) els.silenceFireIcon.style.display = anyActive ? '' : 'none';
      rooms.forEach((room, i) => {
        const anyAlarm = room.smoke === true || room.co === true;
        const allClear = room.smoke === false && (room.co === false || room.co === 'na');
        const sc = anyAlarm ? '#f87171' : allClear ? '#22c55e' : 'rgba(255,255,255,0.18)';
        if (alarmDots.smoke[i]) alarmDots.smoke[i].setAttribute('fill', sc);
        if (alarmStatusEls[i]) {
          const smokeAlarm = room.smoke === true;
          const coAlarm = room.co === true;
          const allClear = room.smoke === false && (room.co === false || room.co === 'na');
          const txt = smokeAlarm ? 'Smoke!' : coAlarm ? 'CO!' : allClear ? 'Clear' : '--';
          const clr = (smokeAlarm || coAlarm) ? '#f87171' : allClear ? '#22c55e' : 'rgba(255,255,255,0.35)';
          alarmStatusEls[i].textContent = txt;
          alarmStatusEls[i].setAttribute('fill', clr);
        }
      });
    }

    function hideModal() {
      if (els.infoModal) els.infoModal.classList.add('hidden');
    }

    function setRoomMetrics(node, room) {
      const hasHumidity = Number.isFinite(room.humidity);
      const hasBattery = Number.isFinite(room.battery);
      const fallback = !hasHumidity && !hasBattery && room.id === 'mini' ? 'Thermostat' : '';

      setVisible(node.humGroup, hasHumidity || Boolean(fallback));
      setVisible(node.humIcon, hasHumidity);
      if (node.hum) node.hum.setAttribute('x', hasHumidity ? '26' : '0');
      setText(node.hum, hasHumidity ? pct(room.humidity) : fallback);

      setVisible(node.batteryGroup, hasBattery);
      setText(node.battery, hasBattery ? room.battery + '%' : '');
    }

    function setRoomExtra(node, room) {
      const miniStatus = room.miniStatus || null;
      setVisible(node.extra, !miniStatus);
      setText(node.extra, miniStatus ? '' : room.extra || '');

      setVisible(node.miniFanGroup, Boolean(miniStatus));
      setVisible(node.miniCompressorGroup, Boolean(miniStatus));
      setFittedText(node.miniFan, miniStatus ? miniStatus.fan || '--' : '', 62, 13, 11);
      setFittedText(node.miniCompressor, miniStatus ? miniStatus.compressor || '--' : '', 54, 13, 11);
    }

    function compactTime(iso) {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '--';
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    function heatColor(tempValue, comfort) {
      const heat = comfort.heat;
      const cool = comfort.cool;
      const center = Number.isFinite(heat) && Number.isFinite(cool) ? (heat + cool) / 2 : comfort.center;
      const halfBand = Number.isFinite(heat) && Number.isFinite(cool) ? Math.max((cool - heat) / 2, 1) : 2;

      if (!Number.isFinite(tempValue) || !Number.isFinite(center)) {
        return { fill: '#1f2937', room: '#14212d', opacity: '0.05' };
      }

      const delta = tempValue - center;
      const strength = Math.min(Math.abs(delta) / halfBand, 1);
      if (delta > 0.4) {
        return {
          fill: '#f87171',
          room: mix('#14212d', '#7f1d1d', 0.3 + strength * 0.42),
          opacity: String(0.18 + strength * 0.28)
        };
      }
      if (delta < -0.4) {
        return {
          fill: '#38bdf8',
          room: mix('#14212d', '#075985', 0.3 + strength * 0.42),
          opacity: String(0.18 + strength * 0.28)
        };
      }
      return {
        fill: '#22c55e',
        room: mix('#14212d', '#166534', 0.34),
        opacity: '0.18'
      };
    }

    function mix(a, b, amount) {
      const left = hex(a);
      const right = hex(b);
      const out = left.map((value, index) => Math.round(value + (right[index] - value) * amount));
      return '#' + out.map(value => value.toString(16).padStart(2, '0')).join('');
    }

    function hex(value) {
      const clean = value.replace('#', '');
      return [0, 2, 4].map(index => parseInt(clean.slice(index, index + 2), 16));
    }

    function applyAlarm(alarm) {
      const raw = String(alarm && alarm.state || 'unknown');
      const armed = raw.startsWith('armed');
      const pending = raw === 'arming' || raw === 'pending';
      const label = armed ? 'Armed' : raw === 'disarmed' ? 'Disarmed' : titleCase(raw);
      setText(els.blinkState, label);
      setText(els.blinkHint, armed ? 'Tap to disarm' : pending ? 'Changing state' : 'Tap to arm');
      if (els.blinkCard) {
        els.blinkCard.setAttribute('fill', armed ? '#7f1d1d' : pending ? '#854d0e' : '#065f46');
      }
    }

    function applySystem(metrics) {
      const cpuTemp = Number.isFinite(metrics.cpuTemp) ? metrics.cpuTemp + '\u00b0C' : '--';
      const ddrTemp = Number.isFinite(metrics.ddrTemp) ? metrics.ddrTemp + '\u00b0C' : '--';
      const ram = Number.isFinite(metrics.ramUsed) ? metrics.ramUsed + '% RAM' : 'RAM --';
      const disk = Number.isFinite(metrics.diskUsed) ? metrics.diskUsed + '% disk' : 'disk --';
      const load = Number.isFinite(metrics.cpuLoad) ? 'load ' + metrics.cpuLoad.toFixed(2) : 'load --';
      setFittedText(els.systemTemps, 'CPU ' + cpuTemp + ' / DDR ' + ddrTemp, 212, 28, 22);
      setText(els.systemLoad, ram + ' | ' + disk + ' | ' + load);
      if (els.systemCard) {
        const hot = Number.isFinite(metrics.cpuTemp) && metrics.cpuTemp >= 65 || Number.isFinite(metrics.ddrTemp) && metrics.ddrTemp >= 65;
        const warm = Number.isFinite(metrics.cpuTemp) && metrics.cpuTemp >= 55 || Number.isFinite(metrics.ddrTemp) && metrics.ddrTemp >= 55;
        els.systemCard.setAttribute('stroke', hot ? 'rgba(248,113,113,0.68)' : warm ? 'rgba(251,191,36,0.56)' : 'rgba(255,255,255,0.08)');
      }
    }

    function applyState(data) {
      appState.latest = data;
      const colors = modeColors[data.mode.type] || modeColors.hold;
      els.modeGradA.setAttribute('stop-color', colors[0]);
      els.modeGradB.setAttribute('stop-color', colors[1]);

      setModeText(data.mode.label);
      setModeTimer(data.mode.timer);
      applyAlarm(data.alarm);
      applyAlarmPanel(data.alarmPanel);
      applySystem(data.metrics);
      setText(els.band, Number.isFinite(data.comfort.heat) && Number.isFinite(data.comfort.cool) ? data.comfort.heat + ' - ' + data.comfort.cool + ' F' : '--');
      setText(els.outside, temp(data.metrics.outsideTemp, 0));

      const target = Number.isFinite(data.comfort.center) ? data.comfort.center.toFixed(data.comfort.center % 1 ? 1 : 0) + ' F' : '--';
      setText(els.targetMain, target);
      setText(els.targetDetail, data.comfort.status + ' | ' + data.mode.detail);
      setText(els.roomsSubtitle, ' • Average ' + temp(data.metrics.averageTemp, 1) + ' | updated ' + compactTime(data.updatedAt));
      setText(els.connection, data.ok ? 'live ' + compactTime(data.updatedAt) : 'error');

      for (const [index, room] of (data.rooms || []).entries()) {
        const node = roomNodes[index];
        if (!node) continue;
        const color = heatColor(room.temp, data.comfort);
        node.fill.setAttribute('fill', color.room);
        node.dot.setAttribute('fill', color.fill);
        setText(node.name, room.label || '--');
        setText(node.temp, temp(room.temp, 1));
        setRoomMetrics(node, room);
        setRoomExtra(node, room);
      }

      const sock = data.sock || {};
      setText(els.sockStatus, sock.status || '--');
      const oxygenValue = Number.isFinite(sock.oxygen) ? sock.oxygen + '%' : Number.isFinite(sock.oxygenAverage) ? sock.oxygenAverage + '%' : '--';
      setFittedText(els.sockHeart, Number.isFinite(sock.heart) ? sock.heart + ' bpm' : '--', 80);
      setFittedText(els.sockOxygen, oxygenValue, 54);
      setFittedText(els.sockBattery, Number.isFinite(sock.battery) ? sock.battery + '%' : '--', 58);
      setText(els.sockSignal, Number.isFinite(sock.signal) ? sock.signal + ' dBm' : '');
      if (els.sockFill) {
        els.sockFill.setAttribute('fill', sock.alert || sock.disconnected ? '#3b111d' : sock.charging ? '#1f2937' : '#0a1620');
        els.sockFill.setAttribute('stroke', sock.alert || sock.disconnected ? 'rgba(248,113,113,0.55)' : 'rgba(255,255,255,0.08)');
      }
    }

    async function refresh() {
      try {
        const response = await fetch('/state', { cache: 'no-store' });
        const data = await response.json();
        applyState(data);
      } catch (error) {
        els.connection.textContent = 'reconnecting';
      }
    }

    async function action(name, options = {}) {
      if (name === 'showAlarms') {
        showAlarmModal(appState.latest && appState.latest.alarmPanel);
        return;
      }

      if (name === 'assist' && appState.latest?.balance && !appState.latest.balance.canRun) {
        const balance = appState.latest.balance;
        showModal('Balance Rooms', balance.reason + ' ' + balance.detail + '.');
        return;
      }

      els.connection.textContent = 'sending';
      setPending(name, true);
      try {
        const response = await fetch('/action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, ...options })
        });
        if (!response.ok) throw new Error('Action failed');
        await refresh();
      } catch (error) {
        els.connection.textContent = 'action failed';
      } finally {
        setPending(name, false);
      }
    }

    document.querySelectorAll('[data-action]').forEach(node => {
      node.addEventListener('pointerup', event => {
        action(node.dataset.action, {
          moveBand: appState.moveBand && (node.dataset.action === 'cooler' || node.dataset.action === 'warmer')
        });
        event.preventDefault();
      });
    });

    document.querySelectorAll('[data-toggle="moveBand"]').forEach(node => {
      node.addEventListener('pointerup', event => {
        setMoveBand(!appState.moveBand);
        event.preventDefault();
      });
    });

    els.infoModalClose.addEventListener('click', hideModal);
    els.infoModal.addEventListener('pointerup', event => {
      if (event.target === els.infoModal) hideModal();
    });

    els.camerasButton.addEventListener('pointerup', event => {
      window.location.href = (window.IB || '') + '/cameras';
      event.preventDefault();
    });

    const settingsButton = document.getElementById('settingsButton');
    if (settingsButton) {
      settingsButton.addEventListener('pointerup', event => {
        window.location.href = (window.IB || '') + '/hvac-settings';
        event.preventDefault();
      });
    }

    // Responsive layout: landscape (the frame/desktop/tablet) keeps the native
    // 1280x800 design untouched; portrait phones get a tall, single-column
    // stack. Both layouts reuse the same element ids, so the render code above
    // is unaffected — applyLayout only repositions/resizes existing nodes.
    // Original attribute values are cached the first time we change them so
    // landscape can be restored exactly.
    const dashSvg = document.getElementById('dash');
    const portraitMedia = window.matchMedia('(max-aspect-ratio: 1 / 1)');
    const attrCache = new Map();
    function byId(id) { return document.getElementById(id); }
    function setA(node, attr, value) {
      if (!node) return;
      let store = attrCache.get(node);
      if (!store) { store = {}; attrCache.set(node, store); }
      if (!(attr in store)) store[attr] = node.getAttribute(attr);
      node.setAttribute(attr, value);
    }
    function restoreLayout() {
      attrCache.forEach((store, node) => {
        for (const attr in store) {
          const original = store[attr];
          if (original === null) node.removeAttribute(attr);
          else node.setAttribute(attr, original);
        }
      });
    }
    // Headers grouped by the scale of the group they sit in, so they all end
    // up the same on-screen size in portrait. 24px for un-scaled groups; the
    // Family-target group is rendered at scale 1.1481, so its headers use
    // 24 / 1.1481 ~= 21px to match.
    const headersScale1 = ['hdrBlink', 'hdrMode', 'hdrComfort', 'hdrOutside', 'hdrHaBox', 'roomsTitleLabel'];
    const headersScaled = ['hdrFamily', 'hdrSock'];
    function applyPortrait() {
      // Top status cards -> 2x2 grid (HA box drops to the very bottom).
      setA(byId('topCard0'), 'transform', 'translate(12 12)');
      setA(byId('topCard1'), 'transform', 'translate(266 12)');
      setA(byId('topCard2'), 'transform', 'translate(12 134)');
      setA(byId('topCard3'), 'transform', 'translate(266 134)');
      // Family target -> full width via a uniform scale to 496, directly below.
      setA(byId('controls'), 'transform', 'translate(12 270) scale(1.1481)');
      // Rooms & thermostats -> single column, full width, same 32px side
      // padding as the Family-target buttons.
      setA(byId('roomsPanel'), 'transform', 'translate(12 1000)');
      setA(byId('roomsBg'), 'width', '496');
      setA(byId('roomsBg'), 'height', '904');
      setA(byId('roomsTitle'), 'y', '52');
      const cardY = [78, 174, 270, 366, 462, 558];
      for (let i = 0; i < 6; i += 1) {
        setA(byId('roomCard' + i), 'transform', 'translate(32 ' + cardY[i] + ')');
        setA(byId('roomFill' + i), 'width', '432');
        setA(byId('roomFill' + i), 'height', '88');
        setA(byId('roomName' + i), 'x', '16');
        setA(byId('roomName' + i), 'y', '28');
        setA(byId('roomDot' + i), 'cx', '408');
        setA(byId('roomDot' + i), 'cy', '22');
        setA(byId('roomDot' + i), 'r', '10');
        setA(byId('roomTemp' + i), 'x', '16');
        setA(byId('roomTemp' + i), 'y', '74');
        setA(byId('roomTemp' + i), 'font-size', '38');
        // Bigger humidity/battery metrics (icon + value scaled up).
        setA(byId('roomHumGroup' + i), 'transform', 'translate(150 14) scale(1.3)');
        setA(byId('roomBatteryGroup' + i), 'transform', 'translate(290 14) scale(1.3)');
        setA(byId('roomExtra' + i), 'x', '150');
        setA(byId('roomExtra' + i), 'y', '74');
      }
      setA(byId('roomMiniFanGroup4'), 'transform', 'translate(150 58) scale(1.15)');
      setA(byId('roomMiniCompressorGroup4'), 'transform', 'translate(300 58) scale(1.15)');
      // Action buttons -> full width, stacked, 32px side padding.
      setA(byId('btnBalance'), 'transform', 'translate(32 662)');
      setA(byId('balanceBg'), 'width', '432');
      setA(byId('btnBalanceText'), 'x', '216');
      setA(byId('btnAlarms'), 'transform', 'translate(32 740)');
      setA(byId('alarmCardFill'), 'width', '432');
      setA(byId('alarmInner'), 'transform', 'translate(108 0)');
      setA(byId('btnSilence'), 'transform', 'translate(32 818)');
      setA(byId('silenceBtnFill'), 'width', '432');
      setA(byId('silenceBtnText'), 'x', '200');
      setA(byId('silenceCheckIcon'), 'transform', 'translate(400 35)');
      setA(byId('silenceFireIcon'), 'transform', 'translate(400 35)');
      // Appliance (HA box) temps -> very bottom, full width.
      setA(byId('topCard4'), 'transform', 'translate(12 1920)');
      setA(byId('systemCard'), 'width', '496');
      // Canvas + connection label.
      setA(dashSvg, 'viewBox', '0 0 520 2050');
      if (els.connection) {
        setA(els.connection, 'x', '508');
        setA(els.connection, 'y', '2030');
      }
    }
    function applyLayout() {
      const portrait = portraitMedia.matches;
      // Uniform header sizes + hidden rooms subtitle go through .style because
      // a CSS class beats a presentation attribute (and the attr cache can't
      // track style). Empty string restores the stylesheet default.
      headersScale1.forEach(id => { const n = byId(id); if (n) n.style.fontSize = portrait ? '24px' : ''; });
      headersScaled.forEach(id => { const n = byId(id); if (n) n.style.fontSize = portrait ? '21px' : ''; });
      const subtitle = byId('roomsSubtitle');
      if (subtitle) subtitle.style.display = portrait ? 'none' : '';
      if (portrait) applyPortrait();
      else restoreLayout();
    }
    if (portraitMedia.addEventListener) portraitMedia.addEventListener('change', applyLayout);
    else if (portraitMedia.addListener) portraitMedia.addListener(applyLayout);
    applyLayout();

    setMoveBand(appState.moveBand);
    refresh();
    setInterval(refresh, 1000);
  </script>
${frameoDeviceBootstrapScript()}
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function jsValue(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function frameoDeviceBootstrapScript() {
  return `<script>
    // Fully Kiosk exposes runCommand to the Android shell. On the Frameo this
    // flips the USB OTG PHY into host mode so the USB microphone enumerates
    // after boot or reconnect. The tiny ALSA mixer reset keeps the USB mic from
    // coming back as a silent input after Android audio restarts, and wakes the
    // tablet speaker path for live camera audio. SimpleSSHD is only started on
    // the mic-test/debug path so the frame is not left serving SSH just because
    // the dashboard is open.
    (function bootstrapFrameoDevice() {
      if (typeof fully === 'undefined' || typeof fully.runCommand !== 'function') return;
      const run = command => {
        try {
          fully.runCommand(command);
        } catch (error) {}
      };
      const refreshAudio = () => {
        run("/system/xbin/su 0 sh -c 'echo host > /sys/devices/platform/ff2c0000.syscon/ff2c0000.syscon:usb2-phy@100/otg_mode; tinymix -D 0 0 SPK; tinymix -D 1 1 1; tinymix -D 1 2 16; tinymix -D 1 3 1; tinymix -D 1 4 1'");
      };
      window.refreshFrameoAudioHardware = refreshAudio;
      const params = new URLSearchParams(window.location.search);
      const startSsh = window.location.pathname === '/mic-test'
        || params.get('ssh') === '1'
        || localStorage.getItem('frameoSshAutostart') === 'true';
      if (startSsh) {
        run('am broadcast -a org.galexander.sshd.START -n org.galexander.sshd/.StartReceiver');
        if (localStorage.getItem('frameoSshKeepAlive') !== 'true') {
          setTimeout(() => run('/system/xbin/su 0 am force-stop org.galexander.sshd'), 10 * 60 * 1000);
        }
      }
      refreshAudio();
      setTimeout(refreshAudio, 1500);
      setTimeout(refreshAudio, 5000);
      run("/system/xbin/su 0 sh -c 'pgrep -f screen-dim.sh >/dev/null 2>&1 || nohup sh /data/local/screen-dim.sh >/data/local/tmp/screen-dim.log 2>&1 </dev/null &'");
      if (!sessionStorage.getItem('frameoHandedOff')) {
        sessionStorage.setItem('frameoHandedOff', '1');
        setTimeout(function() {
          try { fully.startApplication('net.frameo.frame'); } catch(e) {}
        }, 15000);
      }
      const autoSwitch = localStorage.getItem('panelAutoSwitch') === 'true';
      if (autoSwitch) {
        const switchApp = localStorage.getItem('panelAutoSwitchApp') || 'net.frameo.frame';
        const switchMs = Math.max(1, parseFloat(localStorage.getItem('panelAutoSwitchMinutes')) || 5) * 60 * 1000;
        let switchTimer = null;
        const resetSwitch = function() {
          if (switchTimer) clearTimeout(switchTimer);
          switchTimer = setTimeout(function() {
            try { fully.startApplication(switchApp); } catch(e) {}
          }, switchMs);
        };
        document.addEventListener('pointerdown', resetSwitch, { passive: true });
        resetSwitch();
      }
    })();
  </script>`;
}

function cameraDashboardHtml(ib = '') {
  const cards = CAMERAS.map((camera, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 24 + col * 419;
    const y = 88 + row * 330;
    return `
      <g id="card-${camera.slug}" transform="translate(${x} ${y})">
        <rect id="cardFill-${camera.slug}" width="392" height="306" rx="8" fill="#0f1d29" stroke="rgba(255,255,255,0.1)"/>
        <text x="18" y="36" class="label">${escapeHtml(camera.label)}</text>
        <text id="temp-${camera.slug}" x="198" y="36" text-anchor="middle" class="tiny">--</text>
        <text id="battery-${camera.slug}" x="374" y="36" text-anchor="end" class="tiny">Battery --</text>
        <a href="/live/${camera.slug}">
          <image id="image-${camera.slug}" href="/camera/${camera.slug}/snapshot.jpg" x="14" y="58" width="364" height="178" preserveAspectRatio="xMidYMid slice"/>
          <rect x="14" y="58" width="364" height="178" rx="8" fill="transparent"/>
        </a>
        <rect x="14" y="58" width="364" height="178" rx="8" fill="none" stroke="rgba(255,255,255,0.12)"/>
        <g id="reload-${camera.slug}" visibility="hidden" pointer-events="none">
          <rect x="14" y="58" width="364" height="178" rx="8" fill="rgba(15,23,42,0.76)"/>
          <circle cx="196" cy="124" r="17" fill="none" stroke="rgba(255,255,255,0.24)" stroke-width="4"/>
          <path d="M196 107 A17 17 0 0 1 213 124" fill="none" stroke="#38bdf8" stroke-width="4" stroke-linecap="round">
            <animateTransform attributeName="transform" type="rotate" from="0 196 124" to="360 196 124" dur="0.9s" repeatCount="indefinite"/>
          </path>
          <text x="196" y="160" text-anchor="middle" fill="#fff" font-size="15" font-weight="850">Reloading camera</text>
        </g>
        <rect id="motionPill-${camera.slug}" x="18" y="202" width="112" height="25" rx="6" fill="rgba(15,23,42,0.78)"/>
        <text id="motion-${camera.slug}" x="74" y="220" text-anchor="middle" class="tiny">Motion --</text>
        <g class="button camera-button" data-camera-action="snapshot" data-slug="${camera.slug}" transform="translate(14 252)">
          <rect width="112" height="38" rx="7" fill="#0ea5e9"/>
          <text x="56" y="25" text-anchor="middle" fill="#fff" font-size="14" font-weight="850">Snapshot</text>
        </g>
        <g class="button camera-button" data-camera-action="motion" data-slug="${camera.slug}" transform="translate(140 252)">
          <rect id="motionButton-${camera.slug}" width="112" height="38" rx="7" fill="#16a34a"/>
          <text x="56" y="25" text-anchor="middle" fill="#fff" font-size="14" font-weight="850">Motion</text>
        </g>
        <g class="button camera-button" data-camera-action="clips" data-slug="${camera.slug}" transform="translate(266 252)">
          <rect width="112" height="38" rx="7" fill="#4f46e5"/>
          <text x="56" y="25" text-anchor="middle" fill="#fff" font-size="14" font-weight="850">Clips</text>
        </g>
      </g>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <title>${escapeHtml(CAMERA_PANEL.title || 'Frameo Cameras')}</title>
  ${ingressHeadScript(ib)}
  <style>
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: #071017;
      color: #f8fafc;
      font-family: Inter, Roboto, Arial, sans-serif;
      user-select: none;
      touch-action: manipulation;
    }
    svg {
      display: block;
      width: 100vw;
      height: 100vh;
      background: #071017;
    }
    text {
      letter-spacing: 0;
      pointer-events: none;
    }
    .label {
      fill: rgba(248,250,252,0.78);
      font-size: 20px;
      font-weight: 850;
    }
    .small {
      fill: rgba(248,250,252,0.76);
      font-size: 15px;
      font-weight: 700;
    }
    .tiny {
      fill: rgba(248,250,252,0.72);
      font-size: 13px;
      font-weight: 760;
    }
    .button {
      cursor: pointer;
    }
    .button:active rect {
      opacity: 0.76;
    }

    /* Portrait phones: let the grid fill the width and scroll vertically
       instead of letterboxing. The reflow below stacks the cards. */
    @media (max-aspect-ratio: 1 / 1) {
      html, body {
        height: auto;
        min-height: 100%;
        overflow-x: hidden;
        overflow-y: auto;
        touch-action: pan-y;
      }
      svg#cameras {
        width: 100vw;
        height: auto;
      }
    }
  </style>
</head>
<body>
  <svg id="cameras" viewBox="0 0 1280 800" role="img" aria-label="Frameo camera snapshots">
    <defs>
      <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#0b1f28"/>
        <stop offset="0.58" stop-color="#071017"/>
        <stop offset="1" stop-color="#05080c"/>
      </linearGradient>
    </defs>
    <rect width="1280" height="800" fill="url(#bg)"/>
    <text x="24" y="44" fill="#fff" font-size="30" font-weight="900">Cameras</text>
    <text id="cameraStatus" x="24" y="70" class="small">Static HA snapshots</text>
    <g class="button" id="blinkReloadButton" transform="translate(776 20)">
      <rect width="144" height="52" rx="8" fill="#4f46e5"/>
      <text x="72" y="34" text-anchor="middle" fill="#fff" font-size="17" font-weight="850">Reload Blink</text>
    </g>
    <g class="button" id="micTestButton" transform="translate(944 20)">
      <rect width="144" height="52" rx="8" fill="#0f766e"/>
      <text x="72" y="34" text-anchor="middle" fill="#fff" font-size="18" font-weight="850">Panel Admin</text>
    </g>
    <g class="button" id="backButton" transform="translate(1112 20)">
      <rect width="144" height="52" rx="8" fill="#334155"/>
      <text x="72" y="34" text-anchor="middle" fill="#fff" font-size="18" font-weight="850">Climate</text>
    </g>
    ${cards}
  </svg>

  <script>
    const slugs = ${JSON.stringify(CAMERAS.map(camera => camera.slug))};
    let autoBlinkReloadAttempted = false;
    let refreshInFlight = false;
    const reloadingSlugs = new Set();
    const reloadTimers = new Map();
    const snapshotObjectUrls = new Map();
    const SNAPSHOT_FETCH_TIMEOUT_MS = 12000;

    function setText(id, value) {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    }

    function setAttr(id, name, value) {
      const node = document.getElementById(id);
      if (node) node.setAttribute(name, value);
    }

    function compactTime(iso) {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '--';
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    function applyCamera(camera) {
      setText('temp-' + camera.slug, camera.temp || '');
      setText('battery-' + camera.slug, camera.powerLabel || (camera.battery ? 'Battery ' + camera.battery : ''));
      const motionOn = camera.motion === 'on';
      const motionEnabled = camera.motionEnabled === 'on';
      setText('motion-' + camera.slug, motionOn ? 'Motion now' : motionEnabled ? 'Motion on' : 'Motion off');
      setAttr('motionPill-' + camera.slug, 'fill', motionOn ? '#dc2626' : motionEnabled ? '#166534' : '#334155');
      setAttr('motionButton-' + camera.slug, 'fill', motionEnabled ? '#16a34a' : '#475569');
      setAttr('cardFill-' + camera.slug, 'stroke', camera.batteryLow ? 'rgba(248,113,113,0.62)' : motionOn ? 'rgba(248,113,113,0.72)' : 'rgba(255,255,255,0.1)');
      setAttr('reload-' + camera.slug, 'visibility', reloadingSlugs.has(camera.slug) ? 'visible' : 'hidden');
    }

    function cameraNeedsBlinkReload(camera) {
      return camera.state === 'unavailable' || camera.state === 'unknown' || camera.snapshotAvailable === false;
    }

    function setReloading(slug, loading) {
      const existingTimer = reloadTimers.get(slug);
      if (existingTimer) {
        clearTimeout(existingTimer);
        reloadTimers.delete(slug);
      }

      if (loading) {
        reloadingSlugs.add(slug);
        reloadTimers.set(slug, setTimeout(() => {
          reloadingSlugs.delete(slug);
          reloadTimers.delete(slug);
          setAttr('reload-' + slug, 'visibility', 'hidden');
        }, 15000));
      } else {
        reloadingSlugs.delete(slug);
      }

      setAttr('reload-' + slug, 'visibility', loading ? 'visible' : 'hidden');
    }

    async function loadAndSwapSnapshot(slug) {
      const image = document.getElementById('image-' + slug);
      if (!image) return false;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SNAPSHOT_FETCH_TIMEOUT_MS);
      try {
        const response = await fetch('/camera/' + encodeURIComponent(slug) + '/snapshot.jpg?ts=' + Date.now(), {
          cache: 'no-store',
          signal: controller.signal
        });
        if (!response.ok) throw new Error('snapshot fetch failed');

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const previousObjectUrl = snapshotObjectUrls.get(slug);
        snapshotObjectUrls.set(slug, objectUrl);
        image.setAttribute('href', objectUrl);
        if (previousObjectUrl) setTimeout(() => URL.revokeObjectURL(previousObjectUrl), 1000);
        return true;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    async function refreshCameraImages() {
      await Promise.allSettled(slugs.map(async slug => {
        setReloading(slug, true);
        try {
          await loadAndSwapSnapshot(slug);
        } finally {
          setReloading(slug, false);
        }
      }));
    }

    async function reloadBlink(force) {
      setText('cameraStatus', force ? 'Reloading Blink' : 'Restoring Blink snapshots');
      const response = await fetch('/cameras/reload-blink', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: Boolean(force) })
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || 'Blink reload failed');
      for (const camera of data.cameras || []) applyCamera(camera);
      await refreshCameraImages();
      setText('cameraStatus', data.reloaded ? 'Blink reloaded | updated ' + compactTime(data.updatedAt) : 'Blink ready | updated ' + compactTime(data.updatedAt));
      return data;
    }

    async function maybeAutoReloadBlink(data) {
      if (autoBlinkReloadAttempted || !(data.cameras || []).some(cameraNeedsBlinkReload)) return;
      autoBlinkReloadAttempted = true;
      await reloadBlink(false).catch(() => setText('cameraStatus', 'Blink reload failed'));
      await refreshState();
    }

    async function refreshState() {
      if (refreshInFlight) return;
      refreshInFlight = true;
      try {
        const response = await fetch('/cameras/state', { cache: 'no-store' });
        const data = await response.json();
        const cameras = data.cameras || [];
        const needsReload = cameras.some(cameraNeedsBlinkReload);
        setText('cameraStatus', needsReload ? 'Blink snapshots unavailable' : 'Alarm ' + data.alarm.state + ' | live proxy ' + data.liveProxy + ' | updated ' + compactTime(data.updatedAt));
        for (const camera of cameras) applyCamera(camera);
        await maybeAutoReloadBlink(data);
      } catch (error) {
        setText('cameraStatus', 'reconnecting');
      } finally {
        refreshInFlight = false;
      }
    }

    async function refreshSnapshot(slug) {
      setText('cameraStatus', 'Refreshing ' + slug.replaceAll('_', ' '));
      setReloading(slug, true);
      try {
        const response = await fetch('/camera/' + encodeURIComponent(slug) + '/snapshot-refresh', { method: 'POST' });
        if (!response.ok) throw new Error('snapshot refresh failed');
        await loadAndSwapSnapshot(slug);
      } finally {
        setReloading(slug, false);
        await refreshState();
      }
    }

    async function toggleMotion(slug) {
      setText('cameraStatus', 'Toggling motion');
      const response = await fetch('/camera/' + encodeURIComponent(slug) + '/motion-toggle', { method: 'POST' });
      const camera = await response.json();
      applyCamera(camera);
      await refreshState();
    }

    document.querySelectorAll('[data-camera-action]').forEach(node => {
      node.addEventListener('pointerup', event => {
        const slug = node.dataset.slug;
        const action = node.dataset.cameraAction;
        if (action === 'snapshot') refreshSnapshot(slug).catch(() => setText('cameraStatus', 'snapshot failed'));
        if (action === 'motion') toggleMotion(slug).catch(() => setText('cameraStatus', 'motion failed'));
        if (action === 'clips') window.location.href = (window.IB || '') + '/clips/' + slug;
        event.preventDefault();
      });
    });

    document.getElementById('backButton').addEventListener('pointerup', event => {
      window.location.href = (window.IB || '') + '/';
      event.preventDefault();
    });

    document.getElementById('micTestButton').addEventListener('pointerup', event => {
      window.location.href = (window.IB || '') + '/mic-test';
      event.preventDefault();
    });

    document.getElementById('blinkReloadButton').addEventListener('pointerup', event => {
      reloadBlink(true).then(refreshState).catch(() => setText('cameraStatus', 'Blink reload failed'));
      event.preventDefault();
    });

    // Portrait: single full-width column of cameras; landscape unchanged.
    (function () {
      const camerasSvg = document.getElementById('cameras');
      const portraitMedia = window.matchMedia('(max-aspect-ratio: 1 / 1)');
      const cache = new Map();
      function setA(node, attr, value) {
        if (!node) return;
        let store = cache.get(node);
        if (!store) { store = {}; cache.set(node, store); }
        if (!(attr in store)) store[attr] = node.getAttribute(attr);
        node.setAttribute(attr, value);
      }
      function restore() {
        cache.forEach((store, node) => {
          for (const attr in store) {
            const original = store[attr];
            if (original === null) node.removeAttribute(attr);
            else node.setAttribute(attr, original);
          }
        });
      }
      function applyLayout() {
        if (!portraitMedia.matches) { restore(); return; }
        setA(document.getElementById('blinkStatusButton'), 'transform', 'translate(16 84)');
        setA(document.getElementById('micTestButton'), 'transform', 'translate(188 84)');
        setA(document.getElementById('backButton'), 'transform', 'translate(360 84)');
        const top = 150;
        const step = 403;
        slugs.forEach((slug, i) => {
          setA(document.getElementById('card-' + slug), 'transform', 'translate(12 ' + (top + i * step) + ') scale(1.2653)');
        });
        setA(camerasSvg, 'viewBox', '0 0 520 ' + (top + slugs.length * step + 16));
      }
      if (portraitMedia.addEventListener) portraitMedia.addEventListener('change', applyLayout);
      else if (portraitMedia.addListener) portraitMedia.addListener(applyLayout);
      applyLayout();
    })();

    refreshState();
    setInterval(refreshState, 5000);
  </script>
${frameoDeviceBootstrapScript()}
</body>
</html>`;
}

function liveHtml(slug, ib = '') {
  const camera = cameraConfig(slug);
  if (!camera) return null;
  const token = String(attr(camera.liveEntity, 'access_token', ''));
  const snapshotUrl = `/camera/${camera.slug}/snapshot.jpg`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <title>${escapeHtml(camera.label)} Live</title>
  ${ingressHeadScript(ib)}
  <style>
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: #030712;
      color: #fff;
      font-family: Inter, Roboto, Arial, sans-serif;
      user-select: none;
      touch-action: manipulation;
    }
    .stage {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      inset: 0;
      display: grid;
      place-items: center;
      overflow: hidden;
      background: #030712;
    }
    .backdrop-fill {
      position: absolute;
      top: -24px;
      right: -24px;
      bottom: -24px;
      left: -24px;
      z-index: 0;
      width: calc(100% + 48px);
      height: calc(100% + 48px);
      object-fit: cover;
      filter: blur(16px) saturate(0.9);
      opacity: 0.62;
    }
    .snapshot {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      inset: 0;
      z-index: 1;
      width: 100%;
      height: 100%;
      object-fit: contain;
      opacity: 0.68;
    }
    video {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      inset: 0;
      z-index: 2;
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: transparent;
      opacity: 0;
      transition: opacity 0.16s linear;
    }
    video.ready {
      opacity: 1;
      background: #030712;
    }
    .shade {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      inset: 0;
      z-index: 3;
      background:
        linear-gradient(rgba(3,7,18,0.16), rgba(3,7,18,0.02) 42%, rgba(3,7,18,0.74)),
        radial-gradient(circle at center, rgba(15,23,42,0), rgba(3,7,18,0.36));
      pointer-events: none;
    }
    .overlay {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      inset: 0;
      z-index: 4;
      display: grid;
      place-items: center;
      padding: 28px 28px 126px;
      text-align: center;
      background: rgba(3,7,18,0.22);
      transition: opacity 0.16s linear;
    }
    .overlay.hidden {
      opacity: 0;
      pointer-events: none;
    }
    .panel {
      display: grid;
      gap: 14px;
      justify-items: center;
      max-width: min(620px, calc(100vw - 48px));
      padding: 18px 22px;
      border-radius: 8px;
      background: rgba(3,7,18,0.56);
      box-shadow: 0 18px 46px rgba(0,0,0,0.3);
    }
    .spinner {
      width: 58px;
      height: 58px;
      border: 7px solid rgba(226,232,240,0.24);
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    .spinner[hidden] {
      display: none;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .title {
      font-size: 34px;
      line-height: 1.1;
      font-weight: 900;
      letter-spacing: 0;
    }
    .status {
      color: rgba(248,250,252,0.82);
      font-size: 18px;
      font-weight: 750;
      line-height: 1.35;
    }
    .bottom {
      position: fixed;
      left: 18px;
      right: 18px;
      bottom: 16px;
      z-index: 6;
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 10px;
      pointer-events: auto;
    }
    button {
      min-height: 60px;
      border: 0;
      border-radius: 8px;
      color: #fff;
      font: 850 17px Inter, Roboto, Arial, sans-serif;
      background: rgba(51,65,85,0.92);
      box-shadow: 0 10px 24px rgba(0,0,0,0.3);
    }
    button.primary {
      background: rgba(14,165,233,0.94);
    }
    button.save {
      background: rgba(79,70,229,0.94);
    }
    button.audio {
      background: rgba(22,163,74,0.94);
    }
    button.audio.off {
      background: rgba(71,85,105,0.92);
    }
    button.talk {
      background: rgba(15,118,110,0.94);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    button.talk.pending {
      background: rgba(161,98,7,0.94);
    }
    button.talk.active {
      background: rgba(22,163,74,0.94);
    }
    .talk-ring {
      display: none;
      width: 18px;
      height: 18px;
      border-radius: 999px;
      border: 3px solid rgba(255,255,255,0.38);
      border-top-color: rgba(255,255,255,0.95);
      animation: talkSpin 0.75s linear infinite;
      flex: 0 0 auto;
    }
    .talk.pending .talk-ring {
      display: inline-block;
    }
    .talk-copy {
      display: grid;
      gap: 1px;
      line-height: 1.04;
    }
    .talk-main {
      font-size: 16px;
      font-weight: 900;
    }
    .talk-sub {
      font-size: 11px;
      font-weight: 800;
      opacity: 0.82;
    }
    @keyframes talkSpin {
      to { transform: rotate(360deg); }
    }
    button:disabled {
      opacity: 0.62;
    }
    button:active {
      opacity: 0.78;
    }
    .caption {
      position: fixed;
      left: 20px;
      top: 16px;
      z-index: 5;
      max-width: calc(100vw - 40px);
      padding: 10px 13px;
      border-radius: 8px;
      background: rgba(3,7,18,0.64);
      color: rgba(248,250,252,0.92);
      font-size: 17px;
      font-weight: 850;
      box-shadow: 0 8px 18px rgba(0,0,0,0.28);
    }
    .empty .spinner {
      display: none;
    }
    /* Portrait phones: the 6 controls don't fit one row, so wrap to 3x2 and
       give the overlay room to clear the taller control bar. */
    @media (max-aspect-ratio: 1 / 1) {
      .bottom {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .overlay {
        padding-bottom: 168px;
      }
    }
  </style>
</head>
<body>
  <main id="stage" class="stage">
    <img class="backdrop-fill" src="${escapeHtml(snapshotUrl)}" width="1280" height="800" alt="">
    <img class="snapshot" src="${escapeHtml(snapshotUrl)}" width="1280" height="800" alt="">
    <video id="video" playsinline autoplay></video>
    <div class="shade"></div>
    <div class="caption">${escapeHtml(camera.label)} Live</div>
    <section id="overlay" class="overlay">
      <div id="panel" class="panel">
        <div id="spinner" class="spinner"></div>
        <div class="title">${escapeHtml(camera.label)}</div>
        <div id="status" class="status">${token ? 'Waking camera and waiting for video' : 'Live token unavailable'}</div>
      </div>
    </section>
    <nav class="bottom" aria-label="Live camera controls">
      <button id="back" type="button">Cameras</button>
      <button id="restart" class="primary" type="button" ${token ? '' : 'disabled'}>Restart</button>
      <button id="snapshot" type="button">Snapshot</button>
      <button id="clips" class="save" type="button">Clips</button>
      <button id="audio" class="audio" type="button">Audio On</button>
      <button id="talk" class="talk" type="button" disabled>
        <span class="talk-ring" aria-hidden="true"></span>
        <span class="talk-copy"><span class="talk-main">Talk On</span></span>
      </button>
    </nav>
  </main>
  <script src="/api/blink_liveview_proxy/static/mpegts.min.js?v=20260524-1539"></script>
  <script>
    if (window.mpegts && mpegts.LoggingControl) {
      mpegts.LoggingControl.applyConfig({
        enableAll: false,
        enableVerbose: false,
        enableDebug: false,
        enableInfo: false,
        enableWarn: true,
        enableError: true
      });
    }

    const slug = ${jsValue(camera.slug)};
    const accessToken = ${jsValue(token)};
    const pttSupported = ${camera.pttSupported === false ? 'false' : 'true'};
    const streamSeconds = 60;
    const video = document.getElementById('video');
    const overlay = document.getElementById('overlay');
    const panel = document.getElementById('panel');
    const spinner = document.getElementById('spinner');
    const statusText = document.getElementById('status');
    const restart = document.getElementById('restart');
    const snapshot = document.getElementById('snapshot');
    const back = document.getElementById('back');
    const clips = document.getElementById('clips');
    const audio = document.getElementById('audio');
    const talk = document.getElementById('talk');
    const sessionId = window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now() + '-' + Math.random().toString(36).slice(2);
    let player = null;
    let endTimer = null;
    let hasVisibleFrame = false;
    let audioOn = true;
    let talkWs = null;
    let talkStream = null;
    let talkContext = null;
    let talkSource = null;
    let talkProcessor = null;
    let talkMute = null;
    let talkActive = false;
    let talkStarting = false;
    let talkRecoveryTimer = null;

    function refreshFrameoAudioHardware() {
      if (typeof fully === 'undefined' || typeof fully.runCommand !== 'function') return;
      try {
        fully.runCommand("/system/xbin/su 0 sh -c 'echo host > /sys/devices/platform/ff2c0000.syscon/ff2c0000.syscon:usb2-phy@100/otg_mode; tinymix -D 0 0 SPK; tinymix -D 1 1 1; tinymix -D 1 2 16; tinymix -D 1 3 1; tinymix -D 1 4 1'");
      } catch (error) {}
    }

    function syncAudioButton() {
      refreshFrameoAudioHardware();
      video.muted = !audioOn;
      video.volume = audioOn ? 1 : 0;
      audio.textContent = audioOn ? 'Audio On' : 'Audio Off';
      audio.classList.toggle('off', !audioOn);
    }

    function streamUrl() {
      const token = encodeURIComponent(accessToken || '');
      const session = encodeURIComponent(sessionId);
      return '/api/blink_liveview_proxy/cameras/' + encodeURIComponent(slug) +
        '/mpegts?token=' + token +
        '&seconds=' + streamSeconds +
        '&force=1&session=' + session +
        '&cache=' + Date.now();
    }

    function pttUrl() {
      const token = encodeURIComponent(accessToken || '');
      const session = encodeURIComponent(sessionId);
      const path = '/api/blink_liveview_proxy/cameras/' + encodeURIComponent(slug) +
        '/ptt?token=' + token + '&session=' + session;
      const url = new URL(path, window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      return url.href;
    }

    function pcm16Buffer(floatData) {
      const pcm = new Int16Array(floatData.length);
      for (let index = 0; index < floatData.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, floatData[index]));
        pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      return pcm.buffer;
    }

    function escapeButtonText(value) {
      return String(value || '').replace(/[&<>"]/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;'
      }[character]));
    }

    function setTalkButton(state, label, subLabel = '') {
      talk.classList.toggle('pending', state === 'pending');
      talk.classList.toggle('active', state === 'listening');
      talk.innerHTML = '<span class="talk-ring" aria-hidden="true"></span>' +
        '<span class="talk-copy"><span class="talk-main">' + escapeButtonText(label) + '</span>' +
        (subLabel ? '<span class="talk-sub">' + escapeButtonText(subLabel) + '</span>' : '') +
        '</span>';
    }

    function handleTalkStatus(data) {
      if (!data || typeof data !== 'object') return;
      if (data.type === 'started') {
        if (talkActive) setTalkButton('pending', 'Warming up');
      } else if (data.type === 'listening') {
        if (talkActive) setTalkButton('listening', 'Listening', 'press to stop');
      } else if (data.type === 'stopped') {
        if (!talkActive) setTalkButton('idle', 'Talk On');
      } else if (data.type === 'error' && data.message) {
        statusText.textContent = data.message;
        setTalkButton('idle', 'Talk On');
      }
    }

    function connectTalkSocket() {
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(pttUrl());
        socket.binaryType = 'arraybuffer';
        const timeout = setTimeout(() => {
          socket.close();
          reject(new Error('Push-to-talk connection timed out'));
        }, 5000);
        socket.addEventListener('open', () => {
          clearTimeout(timeout);
          resolve(socket);
        }, { once: true });
        socket.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('Push-to-talk connection failed'));
        }, { once: true });
        socket.addEventListener('message', event => {
          try {
            handleTalkStatus(JSON.parse(event.data));
          } catch (error) {}
        });
      });
    }

    async function startTalk(event) {
      if (event) event.preventDefault();
      if (!pttSupported || talkActive || talkStarting || !video.classList.contains('ready')) return;

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!window.isSecureContext) {
        statusText.textContent = 'Talk needs HTTPS or a trusted browser origin.';
        overlay.classList.remove('hidden');
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !AudioContextClass) {
        statusText.textContent = 'Microphone is not available in this browser.';
        overlay.classList.remove('hidden');
        return;
      }

      talkStarting = true;
      talkActive = true;
      setTalkButton('pending', 'Connecting');
      refreshFrameoAudioHardware();
      let talkStep = 'microphone permission';

      try {
        talkStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: false
        });
        talkStep = 'audio context';
        talkContext = new AudioContextClass();
        await talkContext.resume();
        talkStep = 'talk bridge';
        talkWs = await connectTalkSocket();
        talkWs.send(JSON.stringify({
          type: 'start',
          sampleRate: Math.round(talkContext.sampleRate)
        }));

        talkStep = 'audio graph';
        talkSource = talkContext.createMediaStreamSource(talkStream);
        talkProcessor = talkContext.createScriptProcessor(4096, 1, 1);
        talkMute = talkContext.createGain();
        talkMute.gain.value = 0;
        talkProcessor.onaudioprocess = audioEvent => {
          if (!talkWs || talkWs.readyState !== WebSocket.OPEN || !talkActive) return;
          if (talkWs.bufferedAmount > 256 * 1024) return;
          talkWs.send(pcm16Buffer(audioEvent.inputBuffer.getChannelData(0)));
        };
        talkSource.connect(talkProcessor);
        talkProcessor.connect(talkMute);
        talkMute.connect(talkContext.destination);
        talkStarting = false;
      } catch (error) {
        talkStarting = false;
        const detail = error && (error.name || error.message) ? ' (' + (error.name || error.message) + ')' : '';
        statusText.textContent = 'Could not start ' + talkStep + detail + '.';
        overlay.classList.remove('hidden');
        await stopTalk();
      }
    }

    function scheduleTalkPlaybackRecovery() {
      if (talkRecoveryTimer) clearTimeout(talkRecoveryTimer);
      const startTime = video.currentTime || 0;
      talkRecoveryTimer = setTimeout(() => {
        talkRecoveryTimer = null;
        if (!player || !video.classList.contains('ready')) return;
        const laterTime = video.currentTime || 0;
        if (video.paused) {
          video.play().catch(() => {});
          return;
        }
        if (Math.abs(laterTime - startTime) < 0.05) {
          statusText.textContent = 'Recovering live view after talk';
          startPlayer();
        }
      }, 1800);
    }

    async function stopTalk(event, options = {}) {
      if (event) event.preventDefault();
      const wasActive = talkActive;
      talkStarting = false;
      talkActive = false;
      setTalkButton('idle', 'Talk On');

      if (talkProcessor) {
        talkProcessor.onaudioprocess = null;
        try { talkProcessor.disconnect(); } catch (error) {}
        talkProcessor = null;
      }
      if (talkSource) {
        try { talkSource.disconnect(); } catch (error) {}
        talkSource = null;
      }
      if (talkMute) {
        try { talkMute.disconnect(); } catch (error) {}
        talkMute = null;
      }
      if (talkStream) {
        for (const track of talkStream.getTracks()) track.stop();
        talkStream = null;
      }
      if (talkWs) {
        if (talkWs.readyState === WebSocket.OPEN && wasActive) {
          try { talkWs.send(JSON.stringify({ type: 'stop' })); } catch (error) {}
        }
        talkWs.close();
        talkWs = null;
      }
      if (talkContext) {
        try { await talkContext.close(); } catch (error) {}
        talkContext = null;
      }
      if (wasActive && options.recover !== false) {
        scheduleTalkPlaybackRecovery();
      }
    }

    function setLoading(message) {
      overlay.classList.remove('hidden');
      panel.classList.remove('empty');
      spinner.hidden = false;
      video.classList.remove('ready');
      hasVisibleFrame = false;
      statusText.textContent = message;
    }

    function setEnded(message) {
      overlay.classList.remove('hidden');
      panel.classList.add('empty');
      spinner.hidden = true;
      video.classList.remove('ready');
      hasVisibleFrame = false;
      statusText.textContent = message;
    }

    function revealVideoIfReady() {
      if (hasVisibleFrame || !video.videoWidth || !video.videoHeight) return;
      hasVisibleFrame = true;
      video.classList.add('ready');
      overlay.classList.add('hidden');
      talk.disabled = !pttSupported;
      setTalkButton('idle', 'Talk On');
    }

    function stopPlayer() {
      stopTalk(null, { recover: false });
      if (talkRecoveryTimer) {
        clearTimeout(talkRecoveryTimer);
        talkRecoveryTimer = null;
      }
      if (endTimer) {
        clearTimeout(endTimer);
        endTimer = null;
      }
      video.onplaying = null;
      video.onended = null;
      video.onloadeddata = null;
      video.oncanplay = null;
      video.ontimeupdate = null;
      video.classList.remove('ready');
      hasVisibleFrame = false;
      if (player) {
        try { player.pause(); } catch (error) {}
        try { player.unload(); } catch (error) {}
        try { player.detachMediaElement(); } catch (error) {}
        try { player.destroy(); } catch (error) {}
        player = null;
      }
      video.removeAttribute('src');
      try { video.load(); } catch (error) {}
    }

    async function startPlayer() {
      stopPlayer();
      if (!accessToken) {
        setEnded('Live token unavailable');
        return;
      }
      refreshFrameoAudioHardware();
      setLoading('Waking camera and waiting for video');

      if (!window.mpegts) {
        setEnded('Live player library did not load. E-WP-001');
        return;
      }

      const features = mpegts.getFeatureList();
      if (!features.mseLivePlayback) {
        setEnded('This browser cannot play the direct MPEG-TS stream. E-WP-002 MSE: ' +
          (features.msePlayback ? 'yes' : 'no') + ', stream: ' +
          (features.networkStreamIO ? 'yes' : 'no') + '.');
        return;
      }

      player = mpegts.createPlayer({
        type: 'mpegts',
        isLive: true,
        url: streamUrl()
      }, {
        enableWorker: false,
        enableStashBuffer: false,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 8,
        autoCleanupMinBackwardDuration: 3,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 3,
        liveBufferLatencyMinRemain: 1,
        stashInitialSize: 96 * 1024
      });

      player.on(mpegts.Events.ERROR, () => {
        stopPlayer();
        setEnded('Live view ended or the camera stopped sending video.');
      });

      video.onplaying = () => {
        refreshFrameoAudioHardware();
        setTimeout(refreshFrameoAudioHardware, 1500);
        statusText.textContent = 'Receiving video';
        setTimeout(revealVideoIfReady, 250);
      };

      video.onloadeddata = revealVideoIfReady;
      video.oncanplay = revealVideoIfReady;
      video.ontimeupdate = revealVideoIfReady;

      video.onended = () => {
        stopPlayer();
        setEnded('Live view ended.');
      };

      player.attachMediaElement(video);
      player.load();
      syncAudioButton();
      setTimeout(refreshFrameoAudioHardware, 3000);

      try {
        await video.play();
      } catch (error) {
        statusText.textContent = 'Tap Restart to start live view. Browser may require a tap for audio.';
      }

      endTimer = setTimeout(() => {
        stopPlayer();
        setEnded(streamSeconds + ' second live view finished.');
      }, (streamSeconds + 5) * 1000);
    }

    back.addEventListener('pointerup', event => {
      event.preventDefault();
      window.location.href = (window.IB || '') + '/cameras';
    });

    restart.addEventListener('pointerup', event => {
      event.preventDefault();
      startPlayer();
    });

    snapshot.addEventListener('pointerup', async event => {
      event.preventDefault();
      statusText.textContent = 'Refreshing snapshot';
      overlay.classList.remove('hidden');
      try {
        await fetch('/camera/' + encodeURIComponent(slug) + '/snapshot-refresh', { method: 'POST' });
        window.location.reload();
      } catch (error) {
        setEnded('Snapshot refresh failed.');
      }
    });

    clips.addEventListener('pointerup', event => {
      event.preventDefault();
      window.location.href = (window.IB || '') + '/clips/' + encodeURIComponent(slug);
    });

    audio.addEventListener('pointerup', async event => {
      event.preventDefault();
      audioOn = !audioOn;
      syncAudioButton();
      try {
        await video.play();
      } catch (error) {}
    });

    talk.addEventListener('pointerup', event => {
      event.preventDefault();
      if (talkActive || talkStarting) {
        stopTalk();
      } else {
        startTalk();
      }
    });
    window.addEventListener('blur', stopTalk);

    window.addEventListener('beforeunload', stopPlayer);
    syncAudioButton();
    startPlayer();
  </script>
${frameoDeviceBootstrapScript()}
</body>
</html>`;
}

function micTestHtml(ib = '') {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <title>Panel Admin</title>
  ${ingressHeadScript(ib)}
  <style>
    html, body {
      margin: 0;
      min-height: 100%;
      background: #071017;
      color: #f8fafc;
      font-family: Inter, Roboto, Arial, sans-serif;
    }
    main {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 20px 16px 40px;
    }
    .page-header {
      display: flex;
      align-items: center;
      margin-bottom: 20px;
    }
    .page-header button {
      margin-right: 16px;
      margin-bottom: 0;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(360px, 0.95fr);
      align-items: start;
    }
    .layout > * + * {
      margin-left: 16px;
    }
    .settings-layout {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: start;
    }
    .settings-layout > * + * {
      margin-left: 16px;
    }
    .panel {
      min-width: 0;
    }
    .panel > * {
      margin-bottom: 12px;
    }
    h1 {
      margin: 0;
      font-size: 30px;
      letter-spacing: 0;
    }
    h2 {
      font-size: 15px;
      font-weight: 800;
      color: rgba(248,250,252,0.55);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: 0 0 8px;
    }
    .row {
      padding: 16px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      background: #0f1d29;
      margin-bottom: 12px;
    }
    .label {
      color: rgba(248,250,252,0.66);
      font-size: 13px;
      font-weight: 800;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .value {
      overflow-wrap: anywhere;
      font-size: 17px;
      font-weight: 800;
    }
    .mini-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .mini-grid > * + * {
      margin-left: 12px;
    }
    .field-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      align-items: end;
      margin-top: 10px;
    }
    .field-row > * + * {
      margin-left: 10px;
    }
    .field-row.three {
      grid-template-columns: 1fr 1fr 1fr;
    }
    .field {
      margin-bottom: 2px;
    }
    .field-label {
      font-size: 12px;
      font-weight: 800;
      color: rgba(248,250,252,0.5);
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .checkbox-row {
      display: flex;
      align-items: center;
      padding: 8px 0;
    }
    .checkbox-row input[type=checkbox] {
      width: 22px;
      height: 22px;
      margin: 0;
      margin-right: 10px;
      accent-color: #0284c7;
      flex-shrink: 0;
    }
    .checkbox-label {
      font-size: 15px;
      font-weight: 700;
    }
    .status-line {
      font-size: 13px;
      color: rgba(248,250,252,0.5);
      min-height: 18px;
    }
    button {
      display: inline-block;
      border: 0;
      border-radius: 8px;
      background: #0284c7;
      color: #fff;
      font-size: 15px;
      font-weight: 900;
      padding: 13px 20px;
      margin: 0;
      cursor: pointer;
    }
    button.back {
      background: rgba(255,255,255,0.08);
    }
    button.save {
      background: #0f766e;
    }
    button.apply {
      background: #7c3aed;
    }
    .button-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      margin-top: 12px;
      margin-bottom: 4px;
    }
    .button-row button {
      margin-right: 10px;
      margin-bottom: 10px;
    }
    #start {
      background: #16a34a;
    }
    #stop {
      background: #475569;
    }
    select, input[type=number], input[type=text] {
      display: block;
      width: 100%;
      box-sizing: border-box;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 8px;
      background: #0f1d29;
      color: #f8fafc;
      font-size: 16px;
      font-weight: 700;
      padding: 12px 12px;
      margin: 0;
    }
    .meter-shell {
      padding: 14px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      background: #0f1d29;
      margin-bottom: 12px;
    }
    .meter-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      color: rgba(248,250,252,0.72);
      font-size: 13px;
      font-weight: 850;
      text-transform: uppercase;
    }
    .meter {
      position: relative;
      height: 34px;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.14);
      background:
        repeating-linear-gradient(90deg, rgba(255,255,255,0.16) 0 1px, transparent 1px 10%),
        linear-gradient(90deg, rgba(34,197,94,0.16), rgba(234,179,8,0.16) 62%, rgba(239,68,68,0.18));
    }
    #bar {
      width: 0%;
      height: 100%;
      background: linear-gradient(90deg, #22c55e, #eab308 68%, #ef4444);
      transition: width 0.08s linear;
    }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      margin: 0;
      font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: rgba(248,250,252,0.78);
    }
    details {
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      background: #0f1d29;
      overflow: hidden;
    }
    summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      min-height: 48px;
      padding: 0 14px;
      cursor: pointer;
      list-style: none;
      color: rgba(248,250,252,0.66);
      font-size: 13px;
      font-weight: 850;
      text-transform: uppercase;
    }
    summary::-webkit-details-marker {
      display: none;
    }
    summary::after {
      content: '+';
      color: rgba(248,250,252,0.88);
      font-size: 20px;
      line-height: 1;
    }
    details[open] summary::after {
      content: '-';
    }
    .summary-meta {
      margin-left: auto;
      color: rgba(248,250,252,0.48);
      font-size: 12px;
      text-transform: none;
    }
    details pre {
      padding: 0 14px 14px;
      max-height: 280px;
      overflow: auto;
    }
    @media (max-width: 860px) {
      .layout,
      .settings-layout,
      .mini-grid,
      .field-row,
      .field-row.three {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main>
    <div class="page-header">
      <button class="back" type="button" onclick="history.length > 1 ? history.back() : (window.location.href = (window.IB || '') + '/')">&#8592; Back</button>
      <h1>Panel Admin</h1>
    </div>

    <div>
      <h2>Microphone Test</h2>
    </div>
    <div class="button-row">
      <button id="start" type="button">Start Mic Test</button>
      <button id="stop" type="button">Stop</button>
      <button id="readOsDevices" type="button">Read OS Devices</button>
      <button id="resetAudio" type="button">Reset USB Audio</button>
      <button id="unlockLabels" type="button">Unlock Names</button>
      <button id="refreshDevices" type="button">Refresh</button>
    </div>
    <div class="layout">
      <section class="panel">
        <div class="row"><div class="label">Status</div><div id="status" class="value">Ready</div></div>
        <div class="row"><div class="label">Microphone</div><select id="micSelect"><option value="">Browser default (Android default input)</option></select></div>
        <div class="meter-shell">
          <div class="meter-label"><span>Input level</span><span id="meterValue">0%</span></div>
          <div class="meter"><div id="bar"></div></div>
        </div>
      </section>
      <section class="panel">
        <div class="mini-grid">
          <div class="row"><div class="label">Secure context</div><div id="secure" class="value"></div></div>
          <div class="row"><div class="label">Media APIs</div><div id="apis" class="value"></div></div>
        </div>
        <div class="row"><div class="label">Active input</div><pre id="activeInput">None yet</pre></div>
        <details id="osDetails">
          <summary><span>OS audio devices</span><span id="osUpdated" class="summary-meta">Not checked yet</span></summary>
          <pre id="osDevices">Not checked yet</pre>
        </details>
      </section>
    </div>

    <div>
      <h2>Panel Settings</h2>
    </div>
    <div class="settings-layout">
      <section class="panel">
        <div class="row">
          <div class="label">Screen Dim</div>
          <div class="field-row three">
            <div class="field">
              <div class="field-label">Idle (seconds)</div>
              <input type="number" id="dimIdle" min="10" max="3600" step="5" value="30">
            </div>
            <div class="field">
              <div class="field-label">Dim level (0–255)</div>
              <input type="number" id="dimLevel" min="0" max="255" step="1" value="2">
            </div>
            <div class="field">
              <div class="field-label">Normal level (0–255)</div>
              <input type="number" id="brightLevel" min="0" max="255" step="1" value="26">
            </div>
          </div>
          <div class="button-row">
            <button class="apply" type="button" id="applyDim">Apply &amp; Restart Daemon</button>
          </div>
          <div class="status-line" id="dimStatus"></div>
        </div>
      </section>

      <section class="panel">
        <div class="row">
          <div class="label">Auto App Switch</div>
          <div class="checkbox-row">
            <input type="checkbox" id="autoSwitchEnabled">
            <label class="checkbox-label" for="autoSwitchEnabled">Switch app after idle</label>
          </div>
          <div class="field-row">
            <div class="field">
              <div class="field-label">App</div>
              <select id="autoSwitchApp">
                <option value="net.frameo.frame">Frameo</option>
                <option value="com.android.launcher3">Launcher</option>
                <option value="__custom__">Custom package…</option>
              </select>
            </div>
            <div class="field">
              <div class="field-label">After (minutes)</div>
              <input type="number" id="autoSwitchMinutes" min="1" max="120" step="1" value="5">
            </div>
          </div>
          <div class="field" id="customAppField" style="display:none">
            <div class="field-label">Package name</div>
            <input type="text" id="autoSwitchCustomApp" placeholder="com.example.app">
          </div>
          <div class="button-row">
            <button class="save" type="button" id="saveSwitch">Save</button>
          </div>
          <div class="status-line" id="switchStatus"></div>
        </div>
      </section>
    </div>
  </main>
  <script>
    const secure = document.getElementById('secure');
    const apis = document.getElementById('apis');
    const statusText = document.getElementById('status');
    const activeInput = document.getElementById('activeInput');
    const osDevices = document.getElementById('osDevices');
    const osUpdated = document.getElementById('osUpdated');
    const micSelect = document.getElementById('micSelect');
    const bar = document.getElementById('bar');
    const meterValue = document.getElementById('meterValue');
    let stream = null;
    let context = null;
    let analyser = null;
    let raf = null;
    let lastLevel = 0;
    let osInputNames = [];
    let micRestartTimer = null;
    let audioWatchdogTimer = null;

    function setStatus(text) {
      statusText.textContent = text;
    }

    function wait(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function refreshFrameoAudioHardware() {
      if (typeof window.refreshFrameoAudioHardware === 'function') {
        window.refreshFrameoAudioHardware();
        return true;
      }
      if (typeof fully === 'undefined' || typeof fully.runCommand !== 'function') return false;
      try {
        fully.runCommand("/system/xbin/su 0 sh -c 'echo host > /sys/devices/platform/ff2c0000.syscon/ff2c0000.syscon:usb2-phy@100/otg_mode; tinymix -D 0 0 SPK; tinymix -D 1 1 1; tinymix -D 1 2 16; tinymix -D 1 3 1; tinymix -D 1 4 1'");
        return true;
      } catch (error) {
        return false;
      }
    }

    function scheduleMicRecycle() {
      if (micRestartTimer) clearTimeout(micRestartTimer);
      if (!stream) return;
      micRestartTimer = setTimeout(async () => {
        if (!stream) return;
        setStatus('Refreshing long-running microphone session');
        await start({ quiet: true });
      }, 20 * 60 * 1000);
    }

    function updateOsTimestamp(prefix = 'Updated') {
      osUpdated.textContent = prefix + ' ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    }

    function apiSummary() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      return [
        'mediaDevices: ' + Boolean(navigator.mediaDevices),
        'getUserMedia: ' + Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
        'AudioContext: ' + Boolean(AudioContextClass)
      ].join(' | ');
    }

    function shortId(value) {
      if (!value) return '(empty)';
      if (value === 'default' || value === 'communications') return value;
      return value.length > 18 ? value.slice(0, 8) + '...' + value.slice(-6) : value;
    }

    function deviceName(device, index) {
      if (device.label) return device.label;
      if (device.deviceId === 'default') return 'Browser default input';
      if (device.deviceId === 'communications') return 'Browser communications input';
      return osInputNames[index] || ('Browser input ' + (index + 1));
    }

    function shellQuote(value) {
      return "'" + String(value).replace(/'/g, "'\\\\''") + "'";
    }

    function fullyScratchPath(filename) {
      try {
        if (typeof fully !== 'undefined' && typeof fully.getInternalAppSpecificStoragePath === 'function') {
          const base = fully.getInternalAppSpecificStoragePath();
          if (base) return base.replace(/\\/+$/, '') + '/' + filename;
        }
      } catch (error) {}
      return '/sdcard/Download/' + filename;
    }

    function parseOsInputNames(cardsText) {
      const lines = String(cardsText || '').split('\\n');
      const names = [];
      for (let index = 0; index < lines.length; index++) {
        const match = lines[index].match(/^\\s*(\\d+)\\s+\\[([^\\]]+)\\]:\\s*([^\\n]+)$/);
        if (!match) continue;
        const card = match[1];
        const shortName = match[2].trim();
        const typeAndName = match[3].trim().replace(/\\s+-\\s+/, ' - ');
        const detail = (lines[index + 1] || '').trim();
        const friendly = detail || typeAndName || shortName;
        names.push('OS card ' + card + ': ' + friendly);
      }
      return names;
    }

    async function readOsAudioDevices() {
      if (typeof fully === 'undefined' || typeof fully.runSuCommand !== 'function' || typeof fully.readFile !== 'function') {
        osDevices.textContent = 'Fully runSuCommand/readFile bridge is unavailable in this browser.';
        return;
      }
      refreshFrameoAudioHardware();
      const cardsPath = fullyScratchPath('frameo-asound-cards.txt');
      const devicesPath = fullyScratchPath('frameo-asound-devices.txt');
      const mixerPath = fullyScratchPath('frameo-audio-mixer.txt');
      const flingerPath = fullyScratchPath('frameo-audio-flinger.txt');
      const command = [
        'cat /proc/asound/cards > ' + shellQuote(cardsPath) + ' 2>&1',
        'cat /proc/asound/devices > ' + shellQuote(devicesPath) + ' 2>&1',
        '(tinymix -D 0; echo; tinymix -D 1) > ' + shellQuote(mixerPath) + ' 2>&1',
        'dumpsys media.audio_flinger | grep -Ei "Input thread|Frames read|Signal power|Input device|Standby:" | head -80 > ' + shellQuote(flingerPath) + ' 2>&1'
      ].join('; ');
      try {
        osDevices.textContent = 'Reading Android audio devices...';
        updateOsTimestamp('Reading');
        fully.runSuCommand('sh -c ' + shellQuote(command));
        await new Promise(resolve => setTimeout(resolve, 900));
        const cards = fully.readFile(cardsPath) || '';
        const devices = fully.readFile(devicesPath) || '';
        const mixer = fully.readFile(mixerPath) || '';
        const flinger = fully.readFile(flingerPath) || '';
        osInputNames = parseOsInputNames(cards);
        osDevices.textContent = [
          '/proc/asound/cards',
          cards.trim() || '(empty)',
          '',
          '/proc/asound/devices',
          devices.trim() || '(empty)',
          '',
          'tinymix',
          mixer.trim() || '(empty)',
          '',
          'audio_flinger',
          flinger.trim() || '(empty)'
        ].join('\\n');
        updateOsTimestamp();
        await listDevices();
      } catch (error) {
        osDevices.textContent = 'OS audio poll failed: ' + (error.message || String(error));
        updateOsTimestamp('Failed');
      }
    }

    async function listDevices() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        setStatus('enumerateDevices unavailable');
        return;
      }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();

        const inputs = devices.filter(device => device.kind === 'audioinput');
        const previousId = micSelect.value;
        while (micSelect.options.length > 1) micSelect.remove(1);
        let physicalIndex = 0;
        inputs.forEach((input, index) => {
          const option = document.createElement('option');
          const alias = input.deviceId === 'default' || input.deviceId === 'communications';
          option.value = input.deviceId;
          option.textContent = deviceName(input, alias ? index : physicalIndex) + ' [' + shortId(input.deviceId) + ']';
          micSelect.appendChild(option);
          if (!alias) physicalIndex += 1;
        });
        if ([...micSelect.options].some(option => option.value === previousId)) {
          micSelect.value = previousId;
        }
      } catch (error) {
        setStatus('Device refresh failed: ' + (error.name || 'Error') + (error.message ? ' - ' + error.message : ''));
      }
    }

    async function unlockLabels() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('Required microphone APIs are unavailable.');
        return;
      }
      let probe = null;
      try {
        refreshFrameoAudioHardware();
        setStatus('Opening mic briefly so the browser can expose device names');
        await wait(350);
        probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        await listDevices();
        const labelsVisible = [...micSelect.options].some(option => option.value && !option.textContent.includes('name not exposed'));
        setStatus(labelsVisible
          ? 'Device names refreshed'
          : 'Mic permission works, but this browser is still hiding device names');
      } catch (error) {
        setStatus('Could not unlock device names: ' + (error.name || 'Error') + (error.message ? ' - ' + error.message : ''));
      } finally {
        if (probe) {
          for (const track of probe.getTracks()) track.stop();
        }
      }
    }

    function tick() {
      if (!analyser) return;
      const data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const value of data) {
        peak = Math.max(peak, Math.abs(value - 128));
      }
      lastLevel = Math.min(100, Math.round((peak / 128) * 100));
      bar.style.width = lastLevel + '%';
      meterValue.textContent = lastLevel + '%';
      raf = requestAnimationFrame(tick);
    }

    async function start(options = {}) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!window.isSecureContext) {
        setStatus('Not a secure context. Open this page over trusted HTTPS.');
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !AudioContextClass) {
        setStatus('Required microphone APIs are unavailable.');
        return;
      }
      try {
        if (stream || context || analyser) await stop({ quiet: true });
        refreshFrameoAudioHardware();
        await wait(500);
        setStatus('Opening selected microphone');
        const audio = {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        };
        if (micSelect.value) audio.deviceId = { exact: micSelect.value };
        stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
        await listDevices();
        const [track] = stream.getAudioTracks();
        const settings = track && track.getSettings ? track.getSettings() : {};
        activeInput.textContent = [
          'track label: ' + ((track && track.label) || '(no label)'),
          'settings deviceId: ' + shortId(settings.deviceId),
          'sampleRate: ' + (settings.sampleRate || '(unknown)'),
          'channelCount: ' + (settings.channelCount || '(unknown)')
        ].join('\\n');
        setStatus('Microphone active. Speak and watch the meter.');
        context = new AudioContextClass();
        await context.resume();
        const source = context.createMediaStreamSource(stream);
        analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        tick();
        scheduleMicRecycle();
        if (options.autoReport) {
          const testLabel = micSelect.options[micSelect.selectedIndex]?.textContent || 'selected input';
          setTimeout(() => {
            setStatus(testLabel + ' level: ' + lastLevel + '%');
          }, 1500);
        }
      } catch (error) {
        setStatus('Mic failed: ' + (error.name || 'Error') + (error.message ? ' - ' + error.message : ''));
      }
    }

    async function stop(options = {}) {
      if (micRestartTimer) {
        clearTimeout(micRestartTimer);
        micRestartTimer = null;
      }
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      analyser = null;
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
        stream = null;
      }
      if (context) {
        try { await context.close(); } catch (error) {}
        context = null;
      }
      bar.style.width = '0%';
      meterValue.textContent = '0%';
      activeInput.textContent = 'None yet';
      if (!options.quiet) setStatus('Stopped');
      await listDevices();
    }

    async function resetUsbAudio() {
      setStatus('Resetting USB audio path');
      await stop({ quiet: true });
      refreshFrameoAudioHardware();
      await wait(900);
      await readOsAudioDevices();
      setStatus('USB audio reset. Start mic test again.');
    }

    async function testSelectedInput() {
      await start({ autoReport: true });
    }

    secure.textContent = window.isSecureContext ? 'yes' : 'no';
    apis.textContent = apiSummary();
    listDevices();
    readOsAudioDevices();
    audioWatchdogTimer = setInterval(refreshFrameoAudioHardware, 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshFrameoAudioHardware();
    });
    window.addEventListener('focus', refreshFrameoAudioHardware);
    document.getElementById('refreshDevices').addEventListener('click', listDevices);
    document.getElementById('readOsDevices').addEventListener('click', readOsAudioDevices);
    document.getElementById('resetAudio').addEventListener('click', resetUsbAudio);
    document.getElementById('unlockLabels').addEventListener('click', unlockLabels);
    document.getElementById('start').addEventListener('click', testSelectedInput);
    document.getElementById('stop').addEventListener('click', stop);
    window.addEventListener('beforeunload', () => {
      if (audioWatchdogTimer) clearInterval(audioWatchdogTimer);
      stop();
    });

    // ── Screen Dim settings ──────────────────────────────────────────────────
    const dimIdle = document.getElementById('dimIdle');
    const dimLevel = document.getElementById('dimLevel');
    const brightLevel = document.getElementById('brightLevel');
    const dimStatus = document.getElementById('dimStatus');

    function loadDimSettings() {
      dimIdle.value = localStorage.getItem('panelDimIdle') || '30';
      dimLevel.value = localStorage.getItem('panelDimLevel') || '2';
      brightLevel.value = localStorage.getItem('panelBrightLevel') || '26';
    }

    function applyDimSettings() {
      const idle = Math.max(10, parseInt(dimIdle.value) || 30);
      const dim = Math.min(255, Math.max(0, parseInt(dimLevel.value) || 2));
      const bright = Math.min(255, Math.max(0, parseInt(brightLevel.value) || 26));
      dimIdle.value = idle; dimLevel.value = dim; brightLevel.value = bright;
      localStorage.setItem('panelDimIdle', idle);
      localStorage.setItem('panelDimLevel', dim);
      localStorage.setItem('panelBrightLevel', bright);
      const hasFullyRun = typeof fully !== 'undefined' && typeof fully.runCommand === 'function';
      if (!hasFullyRun) {
        dimStatus.textContent = 'Saved locally. Fully Kiosk bridge unavailable — apply on device.';
        return;
      }
      try {
        fully.runCommand(
          '/system/xbin/su 0 sh -c ' +
          "'echo IDLE=" + idle + " > /data/local/screen-dim.conf && " +
          "echo DIM=" + dim + " >> /data/local/screen-dim.conf && " +
          "echo BRIGHT=" + bright + " >> /data/local/screen-dim.conf'"
        );
        fully.runCommand(
          "/system/xbin/su 0 sh -c 'pkill -f screen-dim.sh 2>/dev/null; sleep 1; " +
          "rm -f /data/local/tmp/.sdim.lock /data/local/tmp/.sdim.watcher; " +
          "nohup sh /data/local/screen-dim.sh >/data/local/tmp/screen-dim.log 2>&1 </dev/null &'"
        );
        dimStatus.textContent = 'Applied. Daemon restarting…';
      } catch (e) {
        dimStatus.textContent = 'Error: ' + (e.message || String(e));
      }
    }

    loadDimSettings();
    document.getElementById('applyDim').addEventListener('click', applyDimSettings);

    // ── Auto App Switch settings ─────────────────────────────────────────────
    const autoSwitchEnabled = document.getElementById('autoSwitchEnabled');
    const autoSwitchApp = document.getElementById('autoSwitchApp');
    const autoSwitchMinutes = document.getElementById('autoSwitchMinutes');
    const autoSwitchCustomApp = document.getElementById('autoSwitchCustomApp');
    const customAppField = document.getElementById('customAppField');
    const switchStatus = document.getElementById('switchStatus');

    const KNOWN_APPS = ['net.frameo.frame', 'com.android.launcher3'];

    function loadSwitchSettings() {
      autoSwitchEnabled.checked = localStorage.getItem('panelAutoSwitch') === 'true';
      const pkg = localStorage.getItem('panelAutoSwitchApp') || 'net.frameo.frame';
      autoSwitchMinutes.value = localStorage.getItem('panelAutoSwitchMinutes') || '5';
      if (KNOWN_APPS.includes(pkg)) {
        autoSwitchApp.value = pkg;
      } else {
        autoSwitchApp.value = '__custom__';
        autoSwitchCustomApp.value = pkg;
        customAppField.style.display = '';
      }
    }

    function saveSwitchSettings() {
      let pkg = autoSwitchApp.value === '__custom__'
        ? (autoSwitchCustomApp.value.trim() || 'net.frameo.frame')
        : autoSwitchApp.value;
      const minutes = Math.max(1, parseInt(autoSwitchMinutes.value) || 5);
      autoSwitchMinutes.value = minutes;
      localStorage.setItem('panelAutoSwitch', autoSwitchEnabled.checked ? 'true' : 'false');
      localStorage.setItem('panelAutoSwitchApp', pkg);
      localStorage.setItem('panelAutoSwitchMinutes', minutes);
      switchStatus.textContent = autoSwitchEnabled.checked
        ? 'Enabled — switches to ' + pkg + ' after ' + minutes + ' min idle. Reload dashboard to activate.'
        : 'Disabled. Reload dashboard to deactivate.';
    }

    autoSwitchApp.addEventListener('change', () => {
      customAppField.style.display = autoSwitchApp.value === '__custom__' ? '' : 'none';
    });

    loadSwitchSettings();
    document.getElementById('saveSwitch').addEventListener('click', saveSwitchSettings);
  </script>
${frameoDeviceBootstrapScript()}
</body>
</html>`;
}

function plainTestHtml(ib = '') {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Panel Plain Test</title>
  ${ingressHeadScript(ib)}
</head>
<body style="margin:0;background:#102030;color:white;font:24px Arial;padding:28px">
  <h1 style="margin-top:0">Panel Plain Test</h1>
  <p>If you can read this in Fully Kiosk over HTTPS, TLS and basic rendering work.</p>
  <p><a style="color:#7dd3fc" href="/cameras">Open cameras</a></p>
  <p id="js">JavaScript not checked yet.</p>
  <script>
    document.getElementById('js').textContent = 'JavaScript works. Secure context: ' + window.isSecureContext;
  </script>
${frameoDeviceBootstrapScript()}
</body>
</html>`;
}

// Optional settings page, mounted at /hvac-settings and reached from the
// Settings button on the main panel. Everything on it is driven by
// `panel.settings` in the config: leave that block out (or leave its entities
// blank) and the button disappears, the route 404s, and nothing else changes.
// True when at least one control on the settings page has an entity behind it.
function settingsPageEnabled() {
  const settings = PANEL.settings || {};
  const humidity = (settings.humidityCooling || {}).entity;
  const season = settings.seasonalMode || {};
  const seasonReady = Boolean(season.entity) && Array.isArray(season.options) && season.options.length > 0;
  return Boolean(humidity) || seasonReady;
}

function hvacSettingsHtml(ib = '') {
  const settings = PANEL.settings || {};
  const title = settings.title || 'HVAC Settings';

  const humidity = settings.humidityCooling || {};
  const humidityRow = humidity.entity
    ? `
    <div class="row">
      <div class="label">${escapeHtml(humidity.label || 'Humidity-Biased Cooling')}</div>
      <p class="hint">${escapeHtml(humidity.hint || '')}</p>
      <div class="toggle-row">
        <button id="humidityToggle" class="toggle-switch" type="button" role="switch" aria-checked="false">
          <span class="toggle-knob"></span>
        </button>
        <span id="humidityStatus" class="toggle-status">--</span>
      </div>
    </div>
`
    : '';

  const season = settings.seasonalMode || {};
  const seasonOptions = Array.isArray(season.options) ? season.options : [];
  const seasonRow = season.entity && seasonOptions.length
    ? `
    <div class="row">
      <div class="label">${escapeHtml(season.label || 'Seasonal Mode')}</div>
      <p class="hint">${escapeHtml(season.hint || '')}</p>
      <div id="seasonStatus" class="season-status">Current mode: --</div>
      <div id="furnaceGuardStatus" class="season-status" style="margin-top:-8px"></div>
      <div class="season-grid">
${seasonOptions.map(option => `        <button class="season-card" type="button" data-mode="${escapeHtml(option.value)}">
          <span class="season-icon">${escapeHtml(option.icon || '')}</span>
          <span class="season-name">${escapeHtml(option.label || option.value)}</span>
          <span class="season-tag" style="visibility:hidden">Active</span>
        </button>`).join('\n')}
      </div>
    </div>
`
    : '';

  const checklists = {};
  for (const option of seasonOptions) {
    checklists[option.value] = {
      title: option.title || `Switch to ${option.label || option.value}?`,
      intro: option.intro || 'Before switching, go around the house and:',
      confirmLabel: option.confirmLabel || 'I Understand',
      steps: Array.isArray(option.steps) ? option.steps : []
    };
  }
  const fallbackSeason = seasonOptions.length ? seasonOptions[0].value : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <title>${escapeHtml(title)}</title>
  ${ingressHeadScript(ib)}
  <style>
    html, body {
      margin: 0;
      min-height: 100%;
      background: #071017;
      color: #f8fafc;
      font-family: Inter, Roboto, Arial, sans-serif;
    }
    main {
      width: min(900px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 20px 16px 40px;
    }
    .page-header {
      display: flex;
      align-items: center;
      margin-bottom: 24px;
    }
    .page-header button {
      margin-right: 16px;
    }
    h1 {
      margin: 0;
      font-size: 30px;
    }
    button.back {
      display: inline-block;
      border: 0;
      border-radius: 8px;
      background: rgba(255,255,255,0.08);
      color: #fff;
      font-size: 15px;
      font-weight: 900;
      padding: 13px 20px;
      cursor: pointer;
    }
    .row {
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      background: #0f1d29;
      margin-bottom: 20px;
    }
    .label {
      font-size: 18px;
      font-weight: 850;
      margin-bottom: 6px;
    }
    .hint {
      color: rgba(248,250,252,0.62);
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 16px;
    }
    .toggle-row {
      display: flex;
      align-items: center;
    }
    .toggle-switch {
      width: 64px;
      height: 36px;
      border-radius: 18px;
      border: 0;
      padding: 3px;
      background: #334155;
      cursor: pointer;
      display: flex;
      align-items: center;
      transition: background 0.15s ease;
      flex-shrink: 0;
    }
    .toggle-switch.on {
      background: #0f766e;
      justify-content: flex-end;
    }
    .toggle-knob {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: #fff;
      display: block;
    }
    .toggle-status {
      margin-left: 14px;
      font-size: 16px;
      font-weight: 800;
    }
    .season-status {
      font-size: 15px;
      font-weight: 800;
      color: rgba(248,250,252,0.72);
      margin-bottom: 14px;
    }
    .season-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    .season-card {
      border-radius: 10px;
      border: 2px solid rgba(255,255,255,0.12);
      background: #102131;
      color: #fff;
      padding: 22px 14px;
      text-align: center;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .season-card.active {
      border-color: #38bdf8;
      background: #0c2a3c;
    }
    .season-icon {
      font-size: 36px;
      line-height: 1;
    }
    .season-name {
      font-size: 18px;
      font-weight: 850;
    }
    .season-tag {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      color: #38bdf8;
      letter-spacing: 0.04em;
    }
    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.62);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      z-index: 20;
    }
    .modal-backdrop.hidden { display: none; }
    .modal {
      width: min(520px, 100%);
      background: #0f1d29;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 14px;
      padding: 26px;
    }
    .modal h2 {
      margin: 0 0 14px;
      font-size: 22px;
    }
    .modal-body {
      font-size: 15px;
      line-height: 1.7;
      color: rgba(248,250,252,0.86);
      margin-bottom: 22px;
    }
    .modal-body ol {
      margin: 10px 0 0;
      padding-left: 22px;
    }
    .modal-actions {
      display: flex;
      gap: 12px;
    }
    .modal-btn {
      flex: 1;
      border: 0;
      border-radius: 8px;
      padding: 15px 12px;
      font-size: 15px;
      font-weight: 900;
      cursor: pointer;
    }
    .modal-btn.cancel {
      background: rgba(255,255,255,0.1);
      color: #fff;
    }
    .modal-btn.confirm {
      background: #38bdf8;
      color: #03111c;
    }
  </style>
</head>
<body>
  <main>
    <div class="page-header">
      <button class="back" type="button" onclick="history.length > 1 ? history.back() : (window.location.href = (window.IB || '') + '/')">&#8592; Back</button>
      <h1>${escapeHtml(title)}</h1>
    </div>
${humidityRow}${seasonRow}
  </main>

  <div id="seasonModal" class="modal-backdrop hidden">
    <div class="modal">
      <h2 id="seasonModalTitle">Switch mode?</h2>
      <div id="seasonModalBody" class="modal-body"></div>
      <div class="modal-actions">
        <button id="seasonModalCancel" class="modal-btn cancel" type="button">Cancel</button>
        <button id="seasonModalConfirm" class="modal-btn confirm" type="button">I Understand</button>
      </div>
    </div>
  </div>

  <script>
    const CHECKLISTS = ${JSON.stringify(checklists)};
    const SEASON_FALLBACK = ${JSON.stringify(fallbackSeason)};

    const humidityToggle = document.getElementById('humidityToggle');
    const humidityStatus = document.getElementById('humidityStatus');
    const seasonStatus = document.getElementById('seasonStatus');
    const furnaceGuardStatus = document.getElementById('furnaceGuardStatus');
    const seasonButtons = Array.from(document.querySelectorAll('.season-card'));
    const seasonModal = document.getElementById('seasonModal');
    const seasonModalTitle = document.getElementById('seasonModalTitle');
    const seasonModalBody = document.getElementById('seasonModalBody');
    const seasonModalCancel = document.getElementById('seasonModalCancel');
    const seasonModalConfirm = document.getElementById('seasonModalConfirm');

    let pendingMode = null;
    let latestSettings = null;

    async function refresh() {
      try {
        const response = await fetch('/state', { cache: 'no-store' });
        const data = await response.json();
        applySettings(data.settings || {});
      } catch (error) {
        // Leave the last known display up; the main dashboard already
        // surfaces connection problems, this page just re-tries silently.
      }
    }

    function applySettings(settings) {
      latestSettings = settings;

      if (humidityToggle) {
        const humidityOn = Boolean(settings.humidityCoolingEnabled);
        humidityToggle.classList.toggle('on', humidityOn);
        humidityToggle.setAttribute('aria-checked', String(humidityOn));
        if (humidityStatus) humidityStatus.textContent = humidityOn ? 'On' : 'Off';
      }

      if (!seasonButtons.length) return;
      const known = seasonButtons.map(btn => btn.dataset.mode);
      const mode = known.includes(settings.seasonalMode) ? settings.seasonalMode : SEASON_FALLBACK;
      if (seasonStatus) seasonStatus.textContent = 'Current mode: ' + mode;
      if (furnaceGuardStatus) {
        if (settings.furnaceGuardActive === null || settings.furnaceGuardActive === undefined) {
          furnaceGuardStatus.textContent = '';
        } else {
          furnaceGuardStatus.textContent = settings.furnaceGuardActive
            ? 'Furnace guard: engaged \u2014 furnace calls are being held back'
            : 'Furnace guard: not engaged \u2014 furnace is available as normal';
          furnaceGuardStatus.style.color = settings.furnaceGuardActive ? '#fbbf24' : 'rgba(248,250,252,0.55)';
        }
      }
      seasonButtons.forEach(btn => {
        const active = btn.dataset.mode === mode;
        btn.classList.toggle('active', active);
        const tag = btn.querySelector('.season-tag');
        if (tag) tag.style.visibility = active ? 'visible' : 'hidden';
      });
    }

    async function postAction(name, options = {}) {
      const response = await fetch('/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, ...options })
      });
      if (!response.ok) throw new Error('Action failed');
      await refresh();
    }

    if (humidityToggle) {
      humidityToggle.addEventListener('click', () => {
        postAction('humidityCoolingToggle').catch(() => {});
      });
    }

    function openSeasonModal(mode) {
      const info = CHECKLISTS[mode];
      if (!info) return;
      pendingMode = mode;
      seasonModalTitle.textContent = info.title;
      seasonModalBody.innerHTML = info.steps && info.steps.length
        ? info.intro + '<ol>' + info.steps.map(step => '<li>' + step + '</li>').join('') + '</ol>'
        : info.intro;
      seasonModalConfirm.textContent = info.confirmLabel;
      seasonModal.classList.remove('hidden');
    }

    function closeSeasonModal() {
      pendingMode = null;
      seasonModal.classList.add('hidden');
    }

    seasonButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (latestSettings && latestSettings.seasonalMode === mode) return;
        openSeasonModal(mode);
      });
    });

    seasonModalCancel.addEventListener('click', closeSeasonModal);
    seasonModal.addEventListener('click', event => {
      if (event.target === seasonModal) closeSeasonModal();
    });
    seasonModalConfirm.addEventListener('click', () => {
      if (!pendingMode) return;
      const mode = pendingMode;
      seasonModalConfirm.disabled = true;
      postAction('seasonModeSet', { mode })
        .catch(() => {})
        .finally(() => {
          seasonModalConfirm.disabled = false;
          closeSeasonModal();
        });
    });

    refresh();
    setInterval(refresh, 3000);
  </script>
${frameoDeviceBootstrapScript()}
</body>
</html>`;
}

function clipsHtml(slug, ib = '') {
  const camera = cameraConfig(slug);
  if (!camera) return null;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <title>${escapeHtml(camera.label)} Clips</title>
  ${ingressHeadScript(ib)}
  <style>
    html, body {
      margin: 0;
      min-height: 100%;
      background: #071017;
      color: #f8fafc;
      font-family: Inter, Roboto, Arial, sans-serif;
    }
    header {
      position: sticky;
      top: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 24px;
      background: rgba(7,16,23,0.96);
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    h1 {
      margin: 0;
      font-size: 28px;
      letter-spacing: 0;
    }
    button {
      border: 0;
      border-radius: 8px;
      padding: 13px 18px;
      background: #334155;
      color: #fff;
      font-size: 17px;
      font-weight: 850;
    }
    main {
      padding: 18px 24px 30px;
    }
    .status {
      margin-bottom: 14px;
      color: rgba(248,250,252,0.74);
      font-weight: 750;
    }
    .clip {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 104px;
      gap: 12px;
      align-items: center;
      margin-bottom: 12px;
      padding: 16px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      background: #0f1d29;
    }
    .name {
      font-size: 20px;
      font-weight: 850;
    }
    .meta {
      margin-top: 6px;
      color: rgba(248,250,252,0.7);
      font-size: 14px;
      font-weight: 700;
    }
    a {
      color: inherit;
      text-decoration: none;
    }
    .watch {
      text-align: center;
      border-radius: 8px;
      padding: 13px 0;
      background: #4f46e5;
      font-weight: 850;
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(camera.label)} Clips</h1>
    <button onclick="location.href=(window.IB || '') + '/cameras'">Cameras</button>
  </header>
  <main>
    <div id="status" class="status">Loading clips</div>
    <div id="clips"></div>
  </main>
  <script>
    function label(clip, index) {
      return clip.created_at || clip.time || clip.id || 'Clip ' + (index + 1);
    }
    function meta(clip) {
      const bits = [];
      if (clip.camera) bits.push(clip.camera);
      if (clip.duration) bits.push(clip.duration + 's');
      if (clip.size) bits.push(clip.size);
      return bits.join(' | ');
    }
    async function loadClips() {
      try {
        const response = await fetch('/clips/${encodeURIComponent(slug)}/state', { cache: 'no-store' });
        const data = await response.json();
        document.getElementById('status').textContent = (data.count || 0) + ' local clips in the last 24 hours';
        const root = document.getElementById('clips');
        root.innerHTML = '';
        if (!data.clips || !data.clips.length) {
          root.innerHTML = '<div class="clip"><div><div class="name">No clips found</div><div class="meta">Local Sync Module has no recent clips for this camera.</div></div></div>';
          return;
        }
        data.clips.forEach((clip, index) => {
          const id = encodeURIComponent(clip.id || clip.clip_id || clip.video_id || index);
          const row = document.createElement('div');
          row.className = 'clip';
          row.innerHTML =
            '<div><div class="name">' + label(clip, index) + '</div><div class="meta">' + meta(clip) + '</div></div>' +
            '<a class="watch" href="/clip/${encodeURIComponent(slug)}/' + id + '.mp4">Watch</a>';
          root.appendChild(row);
        });
      } catch (error) {
        document.getElementById('status').textContent = 'Could not load clips';
      }
    }
    loadClips();
  </script>
${frameoDeviceBootstrapScript()}
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const url = parseRequestUrl(req);
  if (!url) {
    send(res, 400, { 'content-type': 'text/plain; charset=utf-8' }, 'bad request');
    return;
  }

  // Prefix the browser sees when this panel is mounted behind a reverse proxy.
  const ingressBase = String(req.headers['x-ingress-path'] || '').replace(/\/+$/, '');

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      send(res, 200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      }, clientHtml(ingressBase));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/hvac-settings') {
      if (!settingsPageEnabled()) {
        send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'settings page is not configured');
        return;
      }
      send(res, 200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      }, hvacSettingsHtml(ingressBase));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/cameras') {
      send(res, 200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      }, cameraDashboardHtml(ingressBase));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/mic-test') {
      send(res, 200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      }, micTestHtml(ingressBase));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/plain-test') {
      send(res, 200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      }, plainTestHtml(ingressBase));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/cameras/state') {
      await pollStates();
      sendJson(res, 200, camerasState());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/cameras/reload-blink') {
      const payload = await readJson(req).catch(() => ({}));
      const state = await reloadBlinkIntegration({ force: Boolean(payload.force) });
      sendJson(res, 200, state);
      return;
    }

    if (req.method === 'GET' && (
      url.pathname.startsWith('/api/blink_liveview_proxy/') ||
      url.pathname.startsWith('/api/camera_proxy/') ||
      url.pathname.startsWith('/local/blink-liveview-proxy/')
    )) {
      const proxyPath = blinkStaticAliasPath(url.pathname);
      await proxyHaResponse(req, res, `${proxyPath}${url.search}`, {
        cacheControl: proxyPath.startsWith('/api/blink_liveview_proxy/static/') ? 'public, max-age=3600' : 'no-store'
      });
      return;
    }

    const cameraSnapshotMatch = url.pathname.match(/^\/camera\/([^/]+)\/snapshot\.jpg$/);
    if (req.method === 'GET' && cameraSnapshotMatch) {
      const snapshot = await fetchCameraSnapshot(decodeURIComponent(cameraSnapshotMatch[1]));
      send(res, 200, {
        'content-type': snapshot.contentType,
        'cache-control': 'private, max-age=300'
      }, snapshot.buffer);
      return;
    }

    const cameraRefreshMatch = url.pathname.match(/^\/camera\/([^/]+)\/snapshot-refresh$/);
    if (req.method === 'POST' && cameraRefreshMatch) {
      const camera = await refreshCameraSnapshot(decodeURIComponent(cameraRefreshMatch[1]));
      sendJson(res, 200, camera);
      return;
    }

    const cameraMotionMatch = url.pathname.match(/^\/camera\/([^/]+)\/motion-toggle$/);
    if (req.method === 'POST' && cameraMotionMatch) {
      const camera = await toggleCameraMotion(decodeURIComponent(cameraMotionMatch[1]));
      sendJson(res, 200, camera);
      return;
    }

    const liveMatch = url.pathname.match(/^\/live\/([^/]+)$/);
    if (req.method === 'GET' && liveMatch) {
      await pollStates();
      const body = liveHtml(decodeURIComponent(liveMatch[1]), ingressBase);
      if (!body) {
        send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'unknown camera');
        return;
      }
      send(res, 200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      }, body);
      return;
    }

    const livePlayerMatch = url.pathname.match(/^\/live\/([^/]+)\/player$/);
    if (req.method === 'GET' && livePlayerMatch) {
      const slug = decodeURIComponent(livePlayerMatch[1]);
      if (!cameraConfig(slug)) {
        send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'unknown camera');
        return;
      }
      const query = url.search || '';
      await proxyHaResponse(req, res, `/api/blink_liveview_proxy/cameras/${encodeURIComponent(slug)}/player${query}`, {
        rewriteHtml: true,
        cacheControl: 'no-store'
      });
      return;
    }

    const clipsStateMatch = url.pathname.match(/^\/clips\/([^/]+)\/state$/);
    if (req.method === 'GET' && clipsStateMatch) {
      const payload = await clipsForCamera(decodeURIComponent(clipsStateMatch[1]));
      sendJson(res, 200, payload);
      return;
    }

    const clipVideoMatch = url.pathname.match(/^\/clip\/([^/]+)\/(.+)\.mp4$/);
    if (req.method === 'GET' && clipVideoMatch) {
      const slug = decodeURIComponent(clipVideoMatch[1]);
      if (!cameraConfig(slug)) {
        send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'unknown camera');
        return;
      }
      const clipId = decodeURIComponent(clipVideoMatch[2]);
      // Proxied rather than buffered: a clip used to be read fully into memory
      // and served as a flat 200, which broke seeking on every player.
      await proxyHaResponse(
        req,
        res,
        `/api/blink_liveview_proxy/clips/${encodeURIComponent(clipId)}.mp4?camera=${encodeURIComponent(slug)}&hours=24&limit=100`,
        { cacheControl: 'private, max-age=3600' }
      );
      return;
    }

    const clipsPageMatch = url.pathname.match(/^\/clips\/([^/]+)$/);
    if (req.method === 'GET' && clipsPageMatch) {
      const body = clipsHtml(decodeURIComponent(clipsPageMatch[1]), ingressBase);
      if (!body) {
        send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'unknown camera');
        return;
      }
      send(res, 200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      }, body);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/state') {
      await pollStates();
      sendJson(res, 200, dashboardState());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/action') {
      const payload = await readJson(req);
      await callAction(String(payload.name || ''), payload);
      await pollStates(true).catch(() => {});
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, lastError ? 503 : 200, {
        ok: !lastError,
        haUrl: haBaseUrl(),
        lastPollAt,
        lastError,
        pollMs: POLL_MS
      });
      return;
    }

    send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'not found');
  } catch (error) {
    const status = error.statusCode || 500;
    // Only server-side faults belong in /health; a bad client request should
    // not make the panel report itself unhealthy.
    if (status >= 500) lastError = error.message;
    // A proxied stream may already have flushed its head. Writing a second set
    // of headers throws ERR_HTTP_HEADERS_SENT from inside this handler, which
    // would be an uncaught rejection, so drop the connection instead.
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendJson(res, status, { ok: false, error: error.message });
  }
});

server.on('upgrade', (req, socket, head) => {
  const url = parseRequestUrl(req);
  if (!url) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  if (url.pathname.startsWith('/api/blink_liveview_proxy/')) {
    proxyHaWebSocket(req, socket, head, `${url.pathname}${url.search}`);
    return;
  }
  socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  socket.destroy();
});

let shuttingDown = false;
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => process.exit(0));
  if (typeof server.closeIdleConnections === 'function') {
    server.closeIdleConnections();
  }
  setTimeout(() => {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    process.exit(0);
  }, 2500).unref();
}

server.listen(PORT, HOST, () => {
  console.log(`Frameo SVG dashboard listening on http://${HOST}:${PORT}/`);
  console.log(`Home Assistant: ${haBaseUrl()}`);
});

pollStates(true).catch(error => {
  console.error(`Initial HA poll failed: ${error.message}`);
});
