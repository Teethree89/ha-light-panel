const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8890);
const POLL_MS = Math.max(750, Number(process.env.POLL_MS || 2000));
const SECRET_FILE = process.env.HA_SECRET_FILE || path.resolve(__dirname, '../../secrets/home-assistant.md');

const CAMERAS = [
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
];

const ENTITY_IDS = [
  'sensor.hybrid_hvac_operating_state',
  'input_boolean.hybrid_hvac_heat_control_enabled',
  'binary_sensor.hybrid_hvac_active_thermostat_unavailable',
  'binary_sensor.hybrid_hvac_heat_demand',
  'binary_sensor.hybrid_hvac_cool_demand',
  'binary_sensor.hybrid_hvac_dehumidify_recommended',
  'input_boolean.hybrid_hvac_comfort_hold_active',
  'input_boolean.hybrid_hvac_schedule_enabled',
  'sensor.hybrid_hvac_schedule_period',
  'sensor.hybrid_hvac_schedule_comfort_setting',
  'sensor.hybrid_hvac_airflow_focus_zone',
  'timer.hybrid_hvac_airflow_manual_override',
  'timer.hybrid_hvac_airflow_boost',
  'timer.hybrid_hvac_dry_assist',
  'timer.hybrid_hvac_post_dry_fan_purge',
  'sensor.hybrid_hvac_room_temperature',
  'sensor.hybrid_hvac_room_humidity',
  'sensor.hybrid_hvac_average_temperature',
  'sensor.hybrid_hvac_heat_target',
  'sensor.hybrid_hvac_cool_target',
  'sensor.ha_server_cpu_temp',
  'sensor.ha_server_ddr_temp',
  'sensor.ha_server_ram_used',
  'sensor.ha_server_cpu_load',
  'sensor.ha_server_disk_used',
  'sensor.gree_vireo_24k_outside_temperature',
  'sensor.gree_inferred_action',
  'sensor.my_ecobee_current_temperature_2',
  'climate.my_ecobee_3',
  'climate.kitchen_mini_split',
  'sensor.sonoff_snzb_02dr2_temperature',
  'sensor.sonoff_snzb_02dr2_humidity',
  'sensor.sonoff_snzb_02dr2_temperature_2',
  'sensor.sonoff_snzb_02dr2_humidity_2',
  'sensor.sonoff_snzb_02dr2_temperature_3',
  'sensor.sonoff_snzb_02dr2_humidity_3',
  'sensor.sonoff_snzb_02dr2_battery',
  'sensor.sonoff_snzb_02dr2_battery_2',
  'sensor.sonoff_snzb_02dr2_battery_3',
  'sensor.renni_s_smart_sock_heart_rate',
  'sensor.renni_s_smart_sock_o2_saturation',
  'sensor.renni_s_smart_sock_battery_percentage',
  'sensor.renni_s_smart_sock_battery_remaining',
  'sensor.renni_s_smart_sock_signal_strength',
  'sensor.renni_s_smart_sock_skin_temperature',
  'sensor.renni_s_smart_sock_sleep_state',
  'sensor.renni_s_smart_sock_o2_saturation_10_minute_average',
  'binary_sensor.renni_s_smart_sock_charging',
  'binary_sensor.renni_s_smart_sock_sock_off',
  'binary_sensor.renni_s_smart_sock_sock_disconnected_alert',
  'binary_sensor.renni_s_smart_sock_high_heart_rate_alert',
  'binary_sensor.renni_s_smart_sock_low_heart_rate_alert',
  'binary_sensor.renni_s_smart_sock_high_oxygen_alert',
  'binary_sensor.renni_s_smart_sock_low_oxygen_alert',
  'binary_sensor.renni_s_smart_sock_low_battery_alert',
  'binary_sensor.renni_s_smart_sock_lost_power_alert',
  'alarm_control_panel.blink_114_cooper',
  'binary_sensor.blink_liveview_proxy',
  ...CAMERAS.flatMap(camera => [
    camera.sourceEntity,
    camera.liveEntity,
    camera.batteryEntity,
    camera.motionEntity,
    camera.motionSwitch,
    camera.tempEntity
  ].filter(Boolean))
];

let stateById = {};
let lastPollAt = 0;
let pollPromise = null;
let lastError = '';

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
  return trimSlash(process.env.HA_URL || readSecretField('Home Assistant UI', 'URL') || 'http://ha-server.local:8123');
}

function haBrowserUrl() {
  if (process.env.HA_BROWSER_URL) return trimSlash(process.env.HA_BROWSER_URL);
  const fallbackIp = readSecretField('SSH', 'Fallback IP');
  if (fallbackIp) return `http://${fallbackIp}:8123`;
  return haBaseUrl();
}

function haSecureBrowserUrl() {
  if (process.env.HA_SECURE_BROWSER_URL) return trimSlash(process.env.HA_SECURE_BROWSER_URL);
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

async function haRawFetch(apiPath, options = {}) {
  const token = haToken();
  if (!token) throw new Error(`Missing HA token. Set HA_TOKEN or HA_SECRET_FILE.`);

  const response = await fetch(`${haBaseUrl()}${apiPath}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HA ${response.status} ${response.statusText}: ${body.slice(0, 180)}`);
  }

  return response;
}

async function proxyHaResponse(req, res, apiPath, options = {}) {
  const response = await haRawFetch(apiPath, {
    method: req.method,
    headers: pickForwardHeaders(req.headers)
  });

  const headers = {
    'content-type': response.headers.get('content-type') || 'application/octet-stream',
    'cache-control': options.cacheControl || response.headers.get('cache-control') || 'no-store'
  };

  if (options.rewriteHtml) {
    const text = await response.text();
    send(res, 200, headers, text);
    return;
  }

  res.writeHead(200, headers);
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
      if (ENTITY_IDS.includes(item.entity_id)) next[item.entity_id] = item;
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

function roomCard(id, label, tempEntity, humidityEntity, batteryEntity, extra = '') {
  return {
    id,
    label,
    temp: round(numberState(tempEntity), 1),
    humidity: round(numberState(humidityEntity), 1),
    battery: batteryEntity ? round(numberState(batteryEntity), 0) : null,
    extra
  };
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

function remainingLabel(value) {
  const seconds = durationSeconds(value);
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

function timerInfo(label, entityId) {
  const remainingSeconds = durationSeconds(attr(entityId, 'remaining', ''));
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) return null;
  const duration = durationSeconds(attr(entityId, 'duration', ''));
  const totalSeconds = Number.isFinite(duration) && duration > 0 ? duration : remainingSeconds;
  return {
    label,
    remainingSeconds,
    totalSeconds,
    remaining: remainingLabel(attr(entityId, 'remaining', '')),
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
    battery,
    powerLabel: camera.powerLabel || '',
    batteryLow,
    motion,
    motionEnabled,
    temp: camera.tempEntity && temp !== null ? `${temp} F` : '',
    state: state(camera.sourceEntity, 'unknown')
  };
}

function camerasState() {
  return {
    ok: !lastError,
    error: lastError,
    updatedAt: new Date(lastPollAt || Date.now()).toISOString(),
    alarm: {
      entityId: 'alarm_control_panel.blink_114_cooper',
      state: state('alarm_control_panel.blink_114_cooper', 'unknown')
    },
    liveProxy: state('binary_sensor.blink_liveview_proxy', 'unknown'),
    cameras: CAMERAS.map(cameraSummary)
  };
}

function modeSummary() {
  if (state('input_boolean.hybrid_hvac_heat_control_enabled', 'on') === 'off') {
    return { type: 'paused', label: 'Paused', detail: 'Automation disabled' };
  }
  if (isOn('binary_sensor.hybrid_hvac_active_thermostat_unavailable')) {
    return { type: 'offline', label: 'Thermostat offline', detail: 'Active thermostat unavailable' };
  }
  if (state('timer.hybrid_hvac_airflow_boost', 'idle') === 'active') {
    return {
      type: 'balance',
      label: 'Balancing rooms',
      detail: timerDetail('Airflow boost', 'timer.hybrid_hvac_airflow_boost'),
      timer: timerInfo('Airflow', 'timer.hybrid_hvac_airflow_boost')
    };
  }
  if (state('timer.hybrid_hvac_dry_assist', 'idle') === 'active') {
    return {
      type: 'dry',
      label: 'Drying air',
      detail: timerDetail('Dry assist', 'timer.hybrid_hvac_dry_assist'),
      timer: timerInfo('Drying', 'timer.hybrid_hvac_dry_assist')
    };
  }
  if (state('timer.hybrid_hvac_post_dry_fan_purge', 'idle') === 'active') {
    return {
      type: 'fan',
      label: 'Circulating air',
      detail: timerDetail('Coil dry fan', 'timer.hybrid_hvac_post_dry_fan_purge'),
      timer: timerInfo('Fan', 'timer.hybrid_hvac_post_dry_fan_purge')
    };
  }
  const operatingState = state('sensor.hybrid_hvac_operating_state', '');
  const miniMode = state('climate.kitchen_mini_split', '');
  const miniAction = state('sensor.gree_inferred_action', '');
  if (miniMode === 'dry' || ['dry', 'drying', 'dehumidify'].includes(miniAction)) {
    return { type: 'dry', label: 'Drying air', detail: 'Reducing humidity' };
  }
  if (isOn('binary_sensor.hybrid_hvac_heat_demand')) {
    return { type: 'heat', label: 'Heating', detail: 'Warming the house' };
  }
  if (isOn('binary_sensor.hybrid_hvac_cool_demand') && isOn('binary_sensor.hybrid_hvac_dehumidify_recommended')) {
    return { type: 'dry', label: 'Drying air', detail: 'Cooling with humidity pressure' };
  }
  if (isOn('binary_sensor.hybrid_hvac_cool_demand')) {
    return { type: 'cool', label: 'Cooling', detail: 'Cooling the house' };
  }
  if (operatingState === 'gree_heating') {
    return { type: 'heat', label: 'Heating', detail: 'Warming the house' };
  }
  if (operatingState === 'gree_cooling') {
    return { type: 'cool', label: 'Cooling', detail: 'Cooling the house' };
  }
  if (miniMode === 'fan_only' || ['fan', 'fan_only'].includes(miniAction)) {
    return { type: 'fan', label: 'Circulating air', detail: 'Fan only' };
  }
  return { type: 'hold', label: 'Comfort OK', detail: 'Inside comfort band' };
}

function comfortSummary() {
  const heat = round(numberState('sensor.hybrid_hvac_heat_target'), 0);
  const cool = round(numberState('sensor.hybrid_hvac_cool_target'), 0);
  const holdActive = isOn('input_boolean.hybrid_hvac_comfort_hold_active');
  const scheduleActive = isOn('input_boolean.hybrid_hvac_schedule_enabled');
  const period = state('sensor.hybrid_hvac_schedule_period', 'off');
  const profile = state('sensor.hybrid_hvac_schedule_comfort_setting', '');

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
  const comfort = comfortSummary();
  const ecobeeTemp = numberState('sensor.my_ecobee_current_temperature_2', numberAttr('climate.my_ecobee_3', 'current_temperature'));
  const miniSplitTemp = numberAttr('climate.kitchen_mini_split', 'current_temperature');
  const miniSplitMode = state('climate.kitchen_mini_split', 'unknown');
  const miniSplitFanMode = attr('climate.kitchen_mini_split', 'fan_mode', '');
  const greeAction = state('sensor.gree_inferred_action', 'unknown');
  const avgTemp = numberState('sensor.hybrid_hvac_average_temperature', numberState('sensor.hybrid_hvac_room_temperature'));
  const sock = sockSummary();
  const rooms = [
    roomCard(
      'living',
      'Living Room',
      'sensor.sonoff_snzb_02dr2_temperature',
      'sensor.sonoff_snzb_02dr2_humidity',
      'sensor.sonoff_snzb_02dr2_battery'
    ),
    roomCard(
      'master',
      'Master Bedroom',
      'sensor.sonoff_snzb_02dr2_temperature_2',
      'sensor.sonoff_snzb_02dr2_humidity_2',
      'sensor.sonoff_snzb_02dr2_battery_2'
    ),
    roomCard(
      'rennis',
      'Rennis Room',
      'sensor.sonoff_snzb_02dr2_temperature_3',
      'sensor.sonoff_snzb_02dr2_humidity_3',
      'sensor.sonoff_snzb_02dr2_battery_3',
      sock.status
    ),
    {
      id: 'ecobee',
      label: 'Ecobee',
      temp: round(ecobeeTemp, 1),
      humidity: round(numberAttr('climate.my_ecobee_3', 'current_humidity'), 1),
      battery: null,
      extra: hvacModeLabel(state('climate.my_ecobee_3', 'unknown'))
    },
    {
      id: 'mini',
      label: 'Mini Split',
      temp: round(miniSplitTemp, 1),
      humidity: null,
      battery: null,
      extra: '',
      miniStatus: {
        fan: miniFanLabel(miniSplitMode, miniSplitFanMode),
        compressor: miniActionLabel(greeAction)
      }
    },
    {
      id: 'whole',
      label: 'Whole Home',
      temp: round(avgTemp, 1),
      humidity: round(numberState('sensor.hybrid_hvac_room_humidity'), 1),
      battery: null,
      extra: comfort.status
    }
  ];

  return {
    ok: !lastError,
    error: lastError,
    updatedAt: new Date(lastPollAt || Date.now()).toISOString(),
    mode: modeSummary(),
    comfort,
    metrics: {
      roomTemp: round(numberState('sensor.hybrid_hvac_room_temperature'), 1),
      roomHumidity: round(numberState('sensor.hybrid_hvac_room_humidity'), 1),
      averageTemp: round(avgTemp, 1),
      outsideTemp: round(numberState('sensor.gree_vireo_24k_outside_temperature'), 0),
      cpuTemp: round(numberState('sensor.ha_server_cpu_temp'), 0),
      ddrTemp: round(numberState('sensor.ha_server_ddr_temp'), 0),
      ramUsed: round(numberState('sensor.ha_server_ram_used'), 0),
      cpuLoad: round(numberState('sensor.ha_server_cpu_load'), 2),
      diskUsed: round(numberState('sensor.ha_server_disk_used'), 0),
      greeAction,
      ecobeeTemp: round(ecobeeTemp, 1),
      miniSplitTemp: round(miniSplitTemp, 1),
      miniSplitMode: attr('climate.kitchen_mini_split', 'hvac_mode', miniSplitMode),
      ecobeeMode: attr('climate.my_ecobee_3', 'hvac_mode', state('climate.my_ecobee_3', 'unknown'))
    },
    alarm: {
      entityId: 'alarm_control_panel.blink_114_cooper',
      state: state('alarm_control_panel.blink_114_cooper', 'unknown')
    },
    balance: balanceAvailability(),
    rooms,
    sock
  };
}

function sockSummary() {
  const heart = round(numberState('sensor.renni_s_smart_sock_heart_rate'), 0);
  const oxygen = round(numberState('sensor.renni_s_smart_sock_o2_saturation'), 0);
  const oxygenAverage = round(numberState('sensor.renni_s_smart_sock_o2_saturation_10_minute_average'), 0);
  const battery = round(numberState('sensor.renni_s_smart_sock_battery_percentage'), 0);
  const remaining = round(numberState('sensor.renni_s_smart_sock_battery_remaining'), 0);
  const signal = round(numberState('sensor.renni_s_smart_sock_signal_strength'), 0);
  const skinTemp = round(numberState('sensor.renni_s_smart_sock_skin_temperature'), 1);
  const sleep = textState('sensor.renni_s_smart_sock_sleep_state', '');
  const charging = isOn('binary_sensor.renni_s_smart_sock_charging');
  const sockOff = isOn('binary_sensor.renni_s_smart_sock_sock_off');
  const disconnected = isOn('binary_sensor.renni_s_smart_sock_sock_disconnected_alert');
  const alert = [
    'binary_sensor.renni_s_smart_sock_high_heart_rate_alert',
    'binary_sensor.renni_s_smart_sock_low_heart_rate_alert',
    'binary_sensor.renni_s_smart_sock_high_oxygen_alert',
    'binary_sensor.renni_s_smart_sock_low_oxygen_alert',
    'binary_sensor.renni_s_smart_sock_low_battery_alert',
    'binary_sensor.renni_s_smart_sock_lost_power_alert'
  ].some(isOn);

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
  const operatingState = state('sensor.hybrid_hvac_operating_state', 'unknown');
  const miniMode = state('climate.kitchen_mini_split', 'unknown');
  const manualOverride = state('timer.hybrid_hvac_airflow_manual_override', 'idle');
  const focusZone = state('sensor.hybrid_hvac_airflow_focus_zone', 'unknown');
  const validFocus = ['Living Room', 'Master Bedroom', 'Rennis Room'].includes(focusZone);
  const activeDemand = ['gree_cooling', 'gree_heating'].includes(operatingState);
  const reasons = [];

  if (!activeDemand) reasons.push('Balance Rooms only runs while the mini split is actively heating or cooling.');
  if (miniMode === 'fan_only') reasons.push('The mini split is already in fan-only mode.');
  if (manualOverride !== 'idle') reasons.push('A manual airflow override is still active.');
  if (!validFocus) reasons.push('There is not a room that needs an airflow boost right now.');

  return {
    canRun: reasons.length === 0,
    reason: reasons[0] || 'Ready to balance rooms.',
    detail: activeDemand
      ? `Focus room: ${validFocus ? focusZone : 'none'}`
      : `Current HVAC state: ${operatingState.replace(/_/g, ' ') || 'idle'}`,
    operatingState,
    focusZone,
    manualOverride
  };
}

async function adjustComfortBand(direction, moveBand) {
  if (!moveBand) {
    await haFetch('/api/services/script/hybrid_hvac_adjust_comfort_temperature', {
      method: 'POST',
      body: JSON.stringify({ direction, step: 1 })
    });
    return;
  }

  const heat = numberState('sensor.hybrid_hvac_heat_target');
  const cool = numberState('sensor.hybrid_hvac_cool_target');
  if (!Number.isFinite(heat) || !Number.isFinite(cool) || cool <= heat) {
    throw new Error('Comfort band is unavailable.');
  }

  const center = (heat + cool) / 2;
  const nextHeat = direction === 'down' ? (center - 1) - (cool - heat) : center + 1;
  const adjustment = nextHeat - heat;
  await haFetch('/api/services/script/hybrid_hvac_adjust_comfort_temperature', {
    method: 'POST',
    body: JSON.stringify({
      direction: adjustment >= 0 ? 'up' : 'down',
      step: Math.max(0.5, Math.abs(adjustment))
    })
  });
}

async function callAction(name, options = {}) {
  if (name === 'blinkToggle') {
    const alarmEntity = 'alarm_control_panel.blink_114_cooper';
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

  if (name === 'reset') {
    await haFetch('/api/services/script/hybrid_hvac_reset_gree_target', {
      method: 'POST',
      body: JSON.stringify({})
    });
    return;
  }

  if (name === 'assist') {
    await haFetch('/api/services/script/hybrid_hvac_start_airflow_assist_now', {
      method: 'POST',
      body: JSON.stringify({})
    });
    return;
  }

  throw new Error(`Unsupported action: ${name}`);
}

async function refreshCameraSnapshot(slug) {
  const camera = cameraConfig(slug);
  if (!camera) throw new Error(`Unknown camera: ${slug}`);
  await haFetch(`/api/blink_liveview_proxy/cameras/${encodeURIComponent(slug)}/snapshot-refresh`, {
    method: 'POST',
    body: JSON.stringify({})
  });
  await pollStates(true).catch(() => {});
  return cameraSummary(camera);
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
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 32 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
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

function clientHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <title>Frameo Climate</title>
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
      inset: 0;
      display: grid;
      place-items: center;
      background: rgba(2,6,10,0.58);
      z-index: 4;
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
      <g class="button" data-action="blinkToggle" transform="translate(24 20)">
        <rect id="blinkCard" class="pending-dim" width="230" height="112" rx="8" fill="#334155"/>
        <text x="18" y="38" class="label">Blink system</text>
        <text id="blinkState" x="18" y="78" class="value">--</text>
        <text id="blinkHint" x="18" y="99" class="tiny">Tap to arm</text>
        <g class="action-spinner" data-spinner="blinkToggle" transform="translate(204 34)">
          <circle r="12" fill="none" stroke="rgba(255,255,255,0.86)" stroke-width="4" stroke-linecap="round" stroke-dasharray="20 56">
            <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.8s" repeatCount="indefinite"/>
          </circle>
        </g>
      </g>
      <g transform="translate(270 20)">
        <rect id="modeCard" width="230" height="112" rx="8" fill="url(#modeGrad)"/>
        <text x="18" y="38" class="label">Current mode</text>
        <text id="modeLabel" x="18" y="78" class="value">--</text>
        <g id="modeTimerGroup" transform="translate(18 91)" style="display:none">
          <rect width="146" height="6" rx="3" fill="rgba(255,255,255,0.24)"/>
          <rect id="modeTimerBar" width="0" height="6" rx="3" fill="rgba(255,255,255,0.88)"/>
          <text id="modeTimerText" x="158" y="8" class="tiny">--</text>
        </g>
      </g>
      <g transform="translate(516 20)">
        <rect class="card" width="230" height="112" rx="8"/>
        <text x="18" y="38" class="label">Comfort band</text>
        <text id="band" x="18" y="78" class="value">--</text>
      </g>
      <g transform="translate(762 20)">
        <rect class="card" width="230" height="112" rx="8"/>
        <text x="18" y="38" class="label">Outside</text>
        <text id="outside" x="18" y="78" class="value">--</text>
      </g>
      <g transform="translate(1008 20)">
        <rect id="systemCard" class="card" width="248" height="112" rx="8"/>
        <text x="18" y="38" class="label">HA box</text>
        <text id="systemTemps" x="18" y="72" fill="#fff" font-size="28" font-weight="900">--</text>
        <text id="systemLoad" x="18" y="99" class="tiny">--</text>
      </g>
    </g>

    <g id="roomsPanel" transform="translate(24 156)">
      <rect width="776" height="620" rx="8" fill="#071017" stroke="rgba(255,255,255,0.08)"/>
      <text x="24" y="42" class="label">Rooms & thermostats</text>
      <text id="roomsSubtitle" x="24" y="70" class="small">Live comfort readings</text>

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

      <g id="roomCard3" transform="translate(24 330)">
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

      <g id="roomCard4" transform="translate(275 330)">
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

      <g id="roomCard5" transform="translate(526 330)">
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

      <g class="button" data-action="assist" transform="translate(24 558)">
        <rect class="pending-dim" width="728" height="44" rx="8" fill="#4f46e5"/>
        <g transform="translate(224 9)">
          <path d="M2 23 C13 23 15 7 27 7" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
          <path d="M2 10 C11 10 14 15 22 15" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
          <path d="M23 3 L30 7 L23 12" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M17 11 L24 15 L17 20" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
        <text x="364" y="30" text-anchor="middle" fill="#fff" font-size="24" font-weight="850">Balance Rooms</text>
        <g class="action-spinner" data-spinner="assist" transform="translate(690 22)">
          <circle r="10" fill="none" stroke="rgba(255,255,255,0.86)" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="17 48">
            <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.8s" repeatCount="indefinite"/>
          </circle>
        </g>
      </g>
    </g>

    <g id="controls" transform="translate(824 156)">
      <rect width="432" height="620" rx="8" fill="#0f1d29" stroke="rgba(255,255,255,0.08)"/>
      <text x="28" y="42" class="label">Family target</text>
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
        <text x="18" y="32" class="small">Renni's sock</text>
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

      <g class="button" id="camerasButton" transform="translate(28 532)">
        <rect width="376" height="70" rx="8" fill="#0f766e"/>
        <g transform="translate(112 17)">
          <rect width="44" height="36" fill="transparent"/>
          <g transform="translate(7 5)">
          <rect x="0" y="4" width="30" height="22" rx="5" fill="none" stroke="#fff" stroke-width="3"/>
          <path d="M9 4 L13 0 H22 L26 4" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
          <circle cx="15" cy="15" r="5" fill="none" stroke="#fff" stroke-width="3"/>
          </g>
        </g>
        <rect x="166" y="16" width="108" height="42" fill="transparent"/>
        <text x="220" y="43" text-anchor="middle" fill="#fff" font-size="25" font-weight="850">Cameras</text>
      </g>
    </g>

    <text id="connection" x="1254" y="792" text-anchor="end" class="tiny">connecting</text>
  </svg>

  <div id="infoModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="infoModalTitle">
    <div class="modal">
      <h2 id="infoModalTitle" class="modal-title">Balance Rooms</h2>
      <p id="infoModalBody" class="modal-body">Balance Rooms only runs while heating or cooling is already active.</p>
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
      infoModalClose: document.getElementById('infoModalClose')
    };

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
      id.setAttribute('font-size', String(baseSize));
      if (!maxWidth || typeof id.getComputedTextLength !== 'function') return;
      try {
        let size = baseSize;
        while (size > minSize && id.getComputedTextLength() > maxWidth) {
          size -= 1;
          id.setAttribute('font-size', String(size));
        }
      } catch (error) {}
    }

    function setModeText(value) {
      if (!els.modeLabel) return;
      setFittedText(els.modeLabel, value, 198, 31, 18);
    }

    function setModeTimer(timer) {
      const visible = Boolean(timer && timer.remaining);
      setVisible(els.modeTimerGroup, visible);
      if (!visible) return;
      const progress = Number.isFinite(timer.progress) ? Math.max(0, Math.min(1, timer.progress)) : 1;
      els.modeTimerBar.setAttribute('width', String(Math.max(6, Math.round(146 * progress))));
      const minutes = Number.isFinite(timer.remainingSeconds) ? Math.ceil(timer.remainingSeconds / 60) : null;
      setText(els.modeTimerText, Number.isFinite(minutes) ? minutes + 'm' : timer.remaining);
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

    function showModal(title, body) {
      setText(els.infoModalTitle, title);
      setText(els.infoModalBody, body);
      if (els.infoModal) els.infoModal.classList.remove('hidden');
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
      applySystem(data.metrics);
      setText(els.band, Number.isFinite(data.comfort.heat) && Number.isFinite(data.comfort.cool) ? data.comfort.heat + ' - ' + data.comfort.cool + ' F' : '--');
      setText(els.outside, temp(data.metrics.outsideTemp, 0));

      const target = Number.isFinite(data.comfort.center) ? data.comfort.center.toFixed(data.comfort.center % 1 ? 1 : 0) + ' F' : '--';
      setText(els.targetMain, target);
      setText(els.targetDetail, data.comfort.status + ' | ' + data.mode.detail);
      setText(els.roomsSubtitle, 'Average ' + temp(data.metrics.averageTemp, 1) + ' | updated ' + compactTime(data.updatedAt));
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
      window.location.href = '/cameras';
      event.preventDefault();
    });

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
        run("/system/xbin/su 0 sh -c 'echo host > /sys/devices/platform/ff2c0000.syscon/ff2c0000.syscon:usb2-phy@100/otg_mode; tinymix -D 0 0 SPK; tinymix -D 1 1 1; tinymix -D 1 2 16; tinymix -D 1 3 1'");
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
    })();
  </script>`;
}

function cameraDashboardHtml() {
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
  <title>Frameo Cameras</title>
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
    <g class="button" id="micTestButton" transform="translate(944 20)">
      <rect width="144" height="52" rx="8" fill="#0f766e"/>
      <text x="72" y="34" text-anchor="middle" fill="#fff" font-size="18" font-weight="850">Mic Test</text>
    </g>
    <g class="button" id="backButton" transform="translate(1112 20)">
      <rect width="144" height="52" rx="8" fill="#334155"/>
      <text x="72" y="34" text-anchor="middle" fill="#fff" font-size="18" font-weight="850">Climate</text>
    </g>
    ${cards}
  </svg>

  <script>
    const slugs = ${JSON.stringify(CAMERAS.map(camera => camera.slug))};

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
    }

    async function refreshState() {
      try {
        const response = await fetch('/cameras/state', { cache: 'no-store' });
        const data = await response.json();
        setText('cameraStatus', 'Alarm ' + data.alarm.state + ' | live proxy ' + data.liveProxy + ' | updated ' + compactTime(data.updatedAt));
        for (const camera of data.cameras || []) applyCamera(camera);
      } catch (error) {
        setText('cameraStatus', 'reconnecting');
      }
    }

    async function refreshSnapshot(slug) {
      setText('cameraStatus', 'Refreshing ' + slug.replaceAll('_', ' '));
      await fetch('/camera/' + encodeURIComponent(slug) + '/snapshot-refresh', { method: 'POST' });
      const image = document.getElementById('image-' + slug);
      if (image) image.setAttribute('href', '/camera/' + slug + '/snapshot.jpg?ts=' + Date.now());
      await refreshState();
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
        if (action === 'clips') window.location.href = '/clips/' + slug;
        event.preventDefault();
      });
    });

    document.getElementById('backButton').addEventListener('pointerup', event => {
      window.location.href = '/';
      event.preventDefault();
    });

    document.getElementById('micTestButton').addEventListener('pointerup', event => {
      window.location.href = '/mic-test';
      event.preventDefault();
    });

    refreshState();
    setInterval(refreshState, 5000);
  </script>
${frameoDeviceBootstrapScript()}
</body>
</html>`;
}

function liveHtml(slug) {
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
        fully.runCommand("/system/xbin/su 0 sh -c 'echo host > /sys/devices/platform/ff2c0000.syscon/ff2c0000.syscon:usb2-phy@100/otg_mode; tinymix -D 0 0 SPK; tinymix -D 1 1 1; tinymix -D 1 2 16; tinymix -D 1 3 1'");
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
      window.location.href = '/cameras';
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
      window.location.href = '/clips/' + encodeURIComponent(slug);
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

function micTestHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <title>Wallpanel Mic Test</title>
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
      padding: 18px 16px;
      display: grid;
      gap: 12px;
    }
    .page-header {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(360px, 0.95fr);
      gap: 12px;
      align-items: start;
    }
    .panel {
      display: grid;
      gap: 12px;
      min-width: 0;
    }
    h1 {
      margin: 0;
      font-size: 30px;
      letter-spacing: 0;
    }
    .row {
      display: grid;
      gap: 6px;
      padding: 14px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      background: #0f1d29;
    }
    .label {
      color: rgba(248,250,252,0.66);
      font-size: 13px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .value {
      overflow-wrap: anywhere;
      font-size: 17px;
      font-weight: 800;
    }
    .mini-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    button {
      min-height: 46px;
      border: 0;
      border-radius: 8px;
      background: #0284c7;
      color: #fff;
      font-size: 15px;
      font-weight: 900;
      padding: 0 16px;
    }
    button.back {
      background: rgba(255,255,255,0.08);
    }
    .button-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
    }
    .button-row button {
      flex: 0 1 auto;
    }
    #start {
      background: #16a34a;
    }
    #stop {
      background: #475569;
    }
    select {
      width: 100%;
      min-height: 48px;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 8px;
      background: #0f1d29;
      color: #f8fafc;
      font-size: 16px;
      font-weight: 700;
      padding: 0 12px;
    }
    .meter-shell {
      display: grid;
      gap: 8px;
      padding: 14px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      background: #0f1d29;
    }
    .meter-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
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
      .mini-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main>
    <div class="page-header">
      <button class="back" type="button" onclick="history.length > 1 ? history.back() : (window.location.href = '/')">&#8592; Back</button>
      <h1>Wallpanel Mic Test</h1>
    </div>
    <div class="button-row">
      <button id="start" type="button">Start Mic Test</button>
      <button id="stop" type="button">Stop</button>
      <button id="readOsDevices" type="button">Read OS Devices</button>
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

    function setStatus(text) {
      statusText.textContent = text;
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
      const cardsPath = fullyScratchPath('frameo-asound-cards.txt');
      const devicesPath = fullyScratchPath('frameo-asound-devices.txt');
      const command = [
        'cat /proc/asound/cards > ' + shellQuote(cardsPath) + ' 2>&1',
        'cat /proc/asound/devices > ' + shellQuote(devicesPath) + ' 2>&1'
      ].join('; ');
      try {
        osDevices.textContent = 'Reading Android audio devices...';
        updateOsTimestamp('Reading');
        fully.runSuCommand('sh -c ' + shellQuote(command));
        await new Promise(resolve => setTimeout(resolve, 900));
        const cards = fully.readFile(cardsPath) || '';
        const devices = fully.readFile(devicesPath) || '';
        osInputNames = parseOsInputNames(cards);
        osDevices.textContent = [
          '/proc/asound/cards',
          cards.trim() || '(empty)',
          '',
          '/proc/asound/devices',
          devices.trim() || '(empty)'
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
        setStatus('Opening mic briefly so the browser can expose device names');
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

    async function testSelectedInput() {
      await start({ autoReport: true });
    }

    secure.textContent = window.isSecureContext ? 'yes' : 'no';
    apis.textContent = apiSummary();
    listDevices();
    readOsAudioDevices();
    document.getElementById('refreshDevices').addEventListener('click', listDevices);
    document.getElementById('readOsDevices').addEventListener('click', readOsAudioDevices);
    document.getElementById('unlockLabels').addEventListener('click', unlockLabels);
    document.getElementById('start').addEventListener('click', testSelectedInput);
    document.getElementById('stop').addEventListener('click', stop);
    window.addEventListener('beforeunload', stop);
  </script>
${frameoDeviceBootstrapScript()}
</body>
</html>`;
}

function plainTestHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Panel Plain Test</title>
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

function clipsHtml(slug) {
  const camera = cameraConfig(slug);
  if (!camera) return null;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <title>${escapeHtml(camera.label)} Clips</title>
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
    <button onclick="location.href='/cameras'">Cameras</button>
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
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      send(res, 200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      }, clientHtml());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/cameras') {
      send(res, 200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      }, cameraDashboardHtml());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/mic-test') {
      send(res, 200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      }, micTestHtml());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/plain-test') {
      send(res, 200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      }, plainTestHtml());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/cameras/state') {
      await pollStates();
      sendJson(res, 200, camerasState());
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
      const body = liveHtml(decodeURIComponent(liveMatch[1]));
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
      const response = await haRawFetch(`/api/blink_liveview_proxy/clips/${encodeURIComponent(clipId)}.mp4?camera=${encodeURIComponent(slug)}&hours=24&limit=100`);
      const buffer = Buffer.from(await response.arrayBuffer());
      send(res, 200, {
        'content-type': response.headers.get('content-type') || 'video/mp4',
        'cache-control': 'private, max-age=3600'
      }, buffer);
      return;
    }

    const clipsPageMatch = url.pathname.match(/^\/clips\/([^/]+)$/);
    if (req.method === 'GET' && clipsPageMatch) {
      const body = clipsHtml(decodeURIComponent(clipsPageMatch[1]));
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
    lastError = error.message;
    sendJson(res, 500, { ok: false, error: error.message });
  }
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
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
