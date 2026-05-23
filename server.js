const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

loadEnvFile(process.env.ENV_FILE || path.resolve(__dirname, '.env'));

const CONFIG_PATH = process.env.CONFIG_PATH || path.resolve(__dirname, 'config.json');
const FALLBACK_CONFIG_PATH = path.resolve(__dirname, 'examples/frameo-climate.json');
const CONFIG = loadConfig(CONFIG_PATH);
const HOST = process.env.HOST || CONFIG.server?.host || '0.0.0.0';
const PORT = Number(process.env.PORT || CONFIG.server?.port || 8890);
const POLL_MS = Math.max(750, Number(process.env.POLL_MS || CONFIG.server?.pollMs || 2000));
const SECRET_FILE = process.env.HA_SECRET_FILE || CONFIG.homeAssistant?.secretFile || '';
const CAMERAS = CONFIG.cameras || [];
const ENTITY_IDS = buildEntityIds(CONFIG);

function loadEnvFile(envPath) {
  if (!envPath || !fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function loadConfig(configPath) {
  const resolved = path.resolve(configPath);
  const chosen = fs.existsSync(resolved) ? resolved : FALLBACK_CONFIG_PATH;
  if (!fs.existsSync(chosen)) {
    throw new Error(`Config file not found. Create ${resolved} or set CONFIG_PATH.`);
  }
  const text = fs.readFileSync(chosen, 'utf8');
  try {
    return JSON.parse(stripJsonComments(text));
  } catch (error) {
    throw new Error(`Could not parse ${chosen}: ${error.message}`);
  }
}

function stripJsonComments(text) {
  let output = '';
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) inString = false;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
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

function buildEntityIds(config) {
  const ids = new Set(config.entities || []);
  collectEntityIds(config.panel || {}, ids);
  collectEntityIds(config.cameras || [], ids);
  return [...ids];
}

function collectEntityIds(value, ids) {
  if (!value) return;
  if (typeof value === 'string') {
    if (/^[a-z_]+\.[a-zA-Z0-9_]+$/.test(value)) ids.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEntityIds(item, ids);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (['service', 'url', 'path', 'label', 'slug', 'type', 'icon'].includes(key)) continue;
      collectEntityIds(item, ids);
    }
  }
}

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
  return trimSlash(process.env.HA_URL || CONFIG.homeAssistant?.url || readSecretField('Home Assistant UI', 'URL') || 'http://homeassistant.local:8123');
}

function haBrowserUrl() {
  if (process.env.HA_BROWSER_URL) return trimSlash(process.env.HA_BROWSER_URL);
  if (CONFIG.homeAssistant?.browserUrl) return trimSlash(CONFIG.homeAssistant.browserUrl);
  const fallbackIp = readSecretField('SSH', 'Fallback IP');
  if (fallbackIp) return `http://${fallbackIp}:8123`;
  return haBaseUrl();
}

function haToken() {
  return process.env.HA_TOKEN || CONFIG.homeAssistant?.token || readSecretField('Home Assistant API', 'Long-Lived Access Token');
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

function valueRef(ref, fallback = 'unknown') {
  if (!ref) return fallback;
  if (typeof ref === 'string') return state(ref, fallback);
  if (ref.attribute) return attr(ref.entity, ref.attribute, fallback);
  return state(ref.entity, fallback);
}

function numberRef(ref, fallback = null) {
  const value = Number.parseFloat(valueRef(ref, ''));
  return Number.isFinite(value) ? value : fallback;
}

function isOnRef(ref) {
  return valueRef(ref, 'off') === 'on';
}

function mappedLabel(value, map = {}) {
  const key = String(value || '');
  return map[key] || titleCase(key);
}

function roomCard(room) {
  const extra = extraValue(room.extra);
  const miniStatus = room.miniStatus ? {
    fan: miniFanLabel(valueRef(room.miniStatus.mode, ''), valueRef(room.miniStatus.fan, '')),
    compressor: miniActionLabel(valueRef(room.miniStatus.action, ''))
  } : null;

  return {
    id: room.id || slugify(room.label || 'room'),
    label: room.label || 'Room',
    temp: round(numberRef(room.temp), 1),
    humidity: round(numberRef(room.humidity), 1),
    battery: room.battery ? round(numberRef(room.battery), 0) : null,
    extra,
    miniStatus
  };
}

function extraValue(extra) {
  if (!extra) return '';
  if (typeof extra === 'string') return extra;
  if (extra.type === 'comfortStatus') return comfortSummary().status;
  const value = valueRef(extra, '');
  if (!isValidState(value)) return extra.fallback || '';
  if (extra.map) return mappedLabel(value, extra.map);
  if (extra.hvacModeLabel) return hvacModeLabel(value);
  return titleCase(value);
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'item';
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
  return isValidState(fanMode) ? titleCase(fanMode) : hvacModeLabel(mode);
}

function miniActionLabel(value) {
  const text = String(value || '');
  const labels = {
    off: 'Off',
    idle: 'Idle',
    cool: 'Cooling',
    cooling: 'Cooling',
    heat: 'Heating',
    heating: 'Heating',
    dry: 'Dry',
    drying: 'Dry',
    dehumidify: 'Dry',
    fan_only: 'Fan'
  };
  return labels[text] || titleCase(text);
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
  const cameraPanel = CONFIG.cameraPanel || {};
  return {
    ok: !lastError,
    error: lastError,
    updatedAt: new Date(lastPollAt || Date.now()).toISOString(),
    alarm: {
      entityId: cameraPanel.alarmEntity || '',
      state: cameraPanel.alarmEntity ? state(cameraPanel.alarmEntity, 'unknown') : 'unknown'
    },
    liveProxy: cameraPanel.liveProxyEntity ? state(cameraPanel.liveProxyEntity, 'unknown') : 'unknown',
    cameras: CAMERAS.map(cameraSummary)
  };
}

function modeSummary() {
  const mode = CONFIG.panel?.mode || {};
  if (mode.automationEnabled && valueRef(mode.automationEnabled, 'on') === 'off') {
    return { type: 'paused', label: 'Paused', detail: 'Automation disabled' };
  }
  if (mode.thermostatUnavailable && isOnRef(mode.thermostatUnavailable)) {
    return { type: 'offline', label: 'Thermostat offline', detail: 'Active thermostat unavailable' };
  }
  if (mode.heatDemand && isOnRef(mode.heatDemand)) {
    return { type: 'heat', label: 'Heating', detail: 'Heat demand active' };
  }
  if (mode.coolDemand && mode.humidityDemand && isOnRef(mode.coolDemand) && isOnRef(mode.humidityDemand)) {
    return { type: 'dry', label: 'Cooling + dry', detail: 'Cooling with humidity pressure' };
  }
  if (mode.coolDemand && isOnRef(mode.coolDemand)) {
    return { type: 'cool', label: 'Cooling', detail: 'Cool demand active' };
  }
  return { type: 'hold', label: 'Holding', detail: 'Inside comfort band' };
}

function comfortSummary() {
  const comfort = CONFIG.panel?.comfort || {};
  const heat = round(numberRef(comfort.heatTarget), 0);
  const cool = round(numberRef(comfort.coolTarget), 0);
  const holdActive = comfort.holdActive ? isOnRef(comfort.holdActive) : false;
  const scheduleActive = comfort.scheduleEnabled ? isOnRef(comfort.scheduleEnabled) : false;
  const period = valueRef(comfort.schedulePeriod, 'off');
  const profile = valueRef(comfort.scheduleProfile, '');

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
  const panel = CONFIG.panel || {};
  const metrics = panel.metrics || {};
  const comfort = comfortSummary();
  const sock = sockSummary();
  const rooms = (panel.rooms || []).slice(0, 6).map(roomCard);
  while (rooms.length < 6) {
    rooms.push({ id: `empty_${rooms.length}`, label: '', temp: null, humidity: null, battery: null, extra: '' });
  }
  const avgTemp = numberRef(metrics.averageTemp, numberRef(metrics.roomTemp));

  return {
    ok: !lastError,
    error: lastError,
    updatedAt: new Date(lastPollAt || Date.now()).toISOString(),
    mode: modeSummary(),
    comfort,
    metrics: {
      roomTemp: round(numberRef(metrics.roomTemp), 1),
      roomHumidity: round(numberRef(metrics.roomHumidity), 1),
      averageTemp: round(avgTemp, 1),
      outsideTemp: round(numberRef(metrics.outsideTemp), 0),
      greeAction: valueRef(metrics.action, 'unknown')
    },
    rooms,
    sock
  };
}

function sockSummary() {
  const statusPanel = CONFIG.panel?.statusPanel || {};
  const heart = round(numberRef(statusPanel.heart), 0);
  const oxygen = round(numberRef(statusPanel.oxygen), 0);
  const oxygenAverage = round(numberRef(statusPanel.oxygenAverage), 0);
  const battery = round(numberRef(statusPanel.battery), 0);
  const remaining = round(numberRef(statusPanel.remaining), 0);
  const signal = round(numberRef(statusPanel.signal), 0);
  const skinTemp = round(numberRef(statusPanel.skinTemp), 1);
  const sleep = valueRef(statusPanel.sleep, '');
  const charging = statusPanel.charging ? isOnRef(statusPanel.charging) : false;
  const sockOff = statusPanel.sockOff ? isOnRef(statusPanel.sockOff) : false;
  const disconnected = statusPanel.disconnected ? isOnRef(statusPanel.disconnected) : false;
  const alert = (statusPanel.alerts || []).some(isOnRef);

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

async function processAssist(text) {
  const prompt = String(text || '').trim();
  if (!prompt) throw new Error('Assist prompt is empty.');
  const response = await haFetch('/api/conversation/process', {
    method: 'POST',
    body: JSON.stringify({ text: prompt, language: 'en' })
  });
  return {
    ok: true,
    text: response?.response?.speech?.plain?.speech || 'Done.',
    conversationId: response?.conversation_id || null,
    responseType: response?.response?.response_type || null
  };
}

async function callAction(name) {
  const action = CONFIG.panel?.actions?.[name];
  if (!action?.service) throw new Error(`Unsupported action: ${name}`);
  await callHaService(action.service, action.data || {});
}

async function callHaService(service, data = {}) {
  const [domain, serviceName] = String(service || '').split('.');
  if (!domain || !serviceName) throw new Error(`Invalid service: ${service}`);
  await haFetch(`/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(serviceName)}`, {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

async function refreshCameraSnapshot(slug) {
  const camera = cameraConfig(slug);
  if (!camera) throw new Error(`Unknown camera: ${slug}`);
  const pathTemplate = camera.snapshotRefreshPath || CONFIG.cameraPanel?.snapshotRefreshPath || '/api/blink_liveview_proxy/cameras/{slug}/snapshot-refresh';
  await haFetch(pathTemplate.replaceAll('{slug}', encodeURIComponent(slug)), {
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
  const template = CONFIG.cameraPanel?.clipsPath || '/api/blink_liveview_proxy/clips?camera={slug}&hours=24&limit=20';
  return haFetch(template.replaceAll('{slug}', encodeURIComponent(slug)));
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
  const panel = CONFIG.panel || {};
  const labels = panel.labels || {};
  const title = panel.title || CONFIG.name || 'HA Light Panel';
  const statusLabel = panel.statusPanel?.label || 'Status';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <title>${escapeHtml(title)}</title>
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

    #assistPanel {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.56);
      touch-action: manipulation;
    }

    #assistPanel.open {
      display: flex;
    }

    .assist-box {
      width: min(760px, calc(100vw - 44px));
      padding: 18px;
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 8px;
      background: #0f1d29;
      box-shadow: 0 18px 48px rgba(0,0,0,0.34);
    }

    .assist-title {
      margin-bottom: 12px;
      color: rgba(248,250,252,0.76);
      font-size: 18px;
      font-weight: 800;
    }

    .assist-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 96px 96px;
      gap: 10px;
    }

    #assistInput {
      min-width: 0;
      height: 54px;
      padding: 0 14px;
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 8px;
      background: #071017;
      color: #fff;
      font: 700 20px Inter, Roboto, Arial, sans-serif;
      touch-action: manipulation;
    }

    .assist-box button {
      border: 0;
      border-radius: 8px;
      color: #fff;
      font: 800 17px Inter, Roboto, Arial, sans-serif;
      background: #4f46e5;
      touch-action: manipulation;
    }

    #assistClose {
      background: #334155;
    }

    #assistAnswer {
      min-height: 26px;
      margin-top: 14px;
      color: rgba(248,250,252,0.86);
      font-size: 18px;
      font-weight: 700;
      line-height: 1.35;
    }
  </style>
</head>
<body>
  <svg id="dash" viewBox="0 0 1280 800" role="img" aria-label="${escapeHtml(title)}">
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
      <g transform="translate(24 20)">
        <rect id="modeCard" width="230" height="112" rx="8" fill="url(#modeGrad)"/>
        <text x="18" y="38" class="label">${escapeHtml(labels.mode || 'Current mode')}</text>
        <text id="modeLabel" x="18" y="78" class="value">--</text>
      </g>
      <g transform="translate(270 20)">
        <rect class="card" width="230" height="112" rx="8"/>
        <text x="18" y="38" class="label">${escapeHtml(labels.homeTemp || 'Home temp')}</text>
        <text id="roomTemp" x="18" y="78" class="value">--</text>
      </g>
      <g transform="translate(516 20)">
        <rect class="card" width="230" height="112" rx="8"/>
        <text x="18" y="38" class="label">${escapeHtml(labels.humidity || 'Humidity')}</text>
        <text id="humidity" x="18" y="78" class="value">--</text>
      </g>
      <g transform="translate(762 20)">
        <rect class="card" width="230" height="112" rx="8"/>
        <text x="18" y="38" class="label">${escapeHtml(labels.comfortBand || 'Comfort band')}</text>
        <text id="band" x="18" y="78" class="value">--</text>
      </g>
      <g transform="translate(1008 20)">
        <rect class="card" width="248" height="112" rx="8"/>
        <text x="18" y="38" class="label">${escapeHtml(labels.outside || 'Outside')}</text>
        <text id="outside" x="18" y="78" class="value">--</text>
      </g>
    </g>

    <g id="roomsPanel" transform="translate(24 156)">
      <rect width="776" height="620" rx="8" fill="#071017" stroke="rgba(255,255,255,0.08)"/>
      <text x="24" y="42" class="label">${escapeHtml(labels.rooms || 'Rooms & thermostats')}</text>
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
        <g id="roomMiniFanGroup0" transform="translate(20 160)">
          <circle class="metric-icon" cx="11" cy="11" r="2.2"/>
          <path class="metric-icon" d="M11 8 C8 3 13 1 16 5 C14 6 12.5 7 11 8"/>
          <path class="metric-icon" d="M13 12 C19 11 19 17 14 18 C14 15 13.7 13.5 13 12"/>
          <path class="metric-icon" d="M9 12 C6 17 1 14 3 9 C5 11 7 11.7 9 12"/>
          <text id="roomMiniFan0" x="30" y="17" class="tiny">--</text>
        </g>
        <g id="roomMiniCompressorGroup0" transform="translate(118 160)">
          <rect class="metric-icon" x="0" y="5" width="24" height="14" rx="3"/>
          <path class="metric-icon" d="M5 10 H19"/>
          <path class="metric-icon" d="M5 14 H15"/>
          <text id="roomMiniCompressor0" x="32" y="17" class="tiny">--</text>
        </g>
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
        <g id="roomMiniFanGroup1" transform="translate(20 160)">
          <circle class="metric-icon" cx="11" cy="11" r="2.2"/>
          <path class="metric-icon" d="M11 8 C8 3 13 1 16 5 C14 6 12.5 7 11 8"/>
          <path class="metric-icon" d="M13 12 C19 11 19 17 14 18 C14 15 13.7 13.5 13 12"/>
          <path class="metric-icon" d="M9 12 C6 17 1 14 3 9 C5 11 7 11.7 9 12"/>
          <text id="roomMiniFan1" x="30" y="17" class="tiny">--</text>
        </g>
        <g id="roomMiniCompressorGroup1" transform="translate(118 160)">
          <rect class="metric-icon" x="0" y="5" width="24" height="14" rx="3"/>
          <path class="metric-icon" d="M5 10 H19"/>
          <path class="metric-icon" d="M5 14 H15"/>
          <text id="roomMiniCompressor1" x="32" y="17" class="tiny">--</text>
        </g>
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
        <g id="roomMiniFanGroup2" transform="translate(20 160)">
          <circle class="metric-icon" cx="11" cy="11" r="2.2"/>
          <path class="metric-icon" d="M11 8 C8 3 13 1 16 5 C14 6 12.5 7 11 8"/>
          <path class="metric-icon" d="M13 12 C19 11 19 17 14 18 C14 15 13.7 13.5 13 12"/>
          <path class="metric-icon" d="M9 12 C6 17 1 14 3 9 C5 11 7 11.7 9 12"/>
          <text id="roomMiniFan2" x="30" y="17" class="tiny">--</text>
        </g>
        <g id="roomMiniCompressorGroup2" transform="translate(118 160)">
          <rect class="metric-icon" x="0" y="5" width="24" height="14" rx="3"/>
          <path class="metric-icon" d="M5 10 H19"/>
          <path class="metric-icon" d="M5 14 H15"/>
          <text id="roomMiniCompressor2" x="32" y="17" class="tiny">--</text>
        </g>
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
        <g id="roomMiniFanGroup3" transform="translate(20 160)">
          <circle class="metric-icon" cx="11" cy="11" r="2.2"/>
          <path class="metric-icon" d="M11 8 C8 3 13 1 16 5 C14 6 12.5 7 11 8"/>
          <path class="metric-icon" d="M13 12 C19 11 19 17 14 18 C14 15 13.7 13.5 13 12"/>
          <path class="metric-icon" d="M9 12 C6 17 1 14 3 9 C5 11 7 11.7 9 12"/>
          <text id="roomMiniFan3" x="30" y="17" class="tiny">--</text>
        </g>
        <g id="roomMiniCompressorGroup3" transform="translate(118 160)">
          <rect class="metric-icon" x="0" y="5" width="24" height="14" rx="3"/>
          <path class="metric-icon" d="M5 10 H19"/>
          <path class="metric-icon" d="M5 14 H15"/>
          <text id="roomMiniCompressor3" x="32" y="17" class="tiny">--</text>
        </g>
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
        <g id="roomMiniFanGroup5" transform="translate(20 160)">
          <circle class="metric-icon" cx="11" cy="11" r="2.2"/>
          <path class="metric-icon" d="M11 8 C8 3 13 1 16 5 C14 6 12.5 7 11 8"/>
          <path class="metric-icon" d="M13 12 C19 11 19 17 14 18 C14 15 13.7 13.5 13 12"/>
          <path class="metric-icon" d="M9 12 C6 17 1 14 3 9 C5 11 7 11.7 9 12"/>
          <text id="roomMiniFan5" x="30" y="17" class="tiny">--</text>
        </g>
        <g id="roomMiniCompressorGroup5" transform="translate(118 160)">
          <rect class="metric-icon" x="0" y="5" width="24" height="14" rx="3"/>
          <path class="metric-icon" d="M5 10 H19"/>
          <path class="metric-icon" d="M5 14 H15"/>
          <text id="roomMiniCompressor5" x="32" y="17" class="tiny">--</text>
        </g>
      </g>
    </g>

    <g id="controls" transform="translate(824 156)">
      <rect width="432" height="620" rx="8" fill="#0f1d29" stroke="rgba(255,255,255,0.08)"/>
      <text x="28" y="42" class="label">${escapeHtml(labels.target || 'Family target')}</text>
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

      <g class="button" data-action="reset" transform="translate(28 268)">
        <rect width="376" height="64" rx="8" fill="url(#resetGrad)"/>
        <text x="188" y="42" text-anchor="middle" fill="#fff" font-size="27" font-weight="850">Reset Target</text>
      </g>

      <g id="sockPanel" transform="translate(28 354)">
        <rect id="sockFill" width="376" height="142" rx="8" fill="#0a1620" stroke="rgba(255,255,255,0.08)"/>
        <text x="18" y="32" class="small">${escapeHtml(statusLabel)}</text>
        <text id="sockStatus" x="18" y="62" fill="#fff" font-size="28" font-weight="850">--</text>
        <text x="18" y="100" class="tiny">Heart</text>
        <text id="sockHeart" x="18" y="124" fill="#fff" font-size="24" font-weight="850">--</text>
        <text x="122" y="100" class="tiny">O2</text>
        <text id="sockOxygen" x="122" y="124" fill="#fff" font-size="24" font-weight="850">--</text>
        <text x="220" y="100" class="tiny">Battery</text>
        <text id="sockBattery" x="220" y="124" fill="#fff" font-size="24" font-weight="850">--</text>
        <text id="sockSignal" x="300" y="32" text-anchor="start" class="tiny">--</text>
      </g>

      <g class="button" id="camerasButton" transform="translate(28 520)">
        <rect width="178" height="70" rx="8" fill="#0f766e"/>
        <text x="89" y="34" text-anchor="middle" fill="#fff" font-size="25" font-weight="850">Cameras</text>
        <text x="89" y="56" text-anchor="middle" class="tiny">Snapshots</text>
      </g>

      <g class="button" id="assistButton" transform="translate(226 520)">
        <rect width="178" height="70" rx="8" fill="#4f46e5"/>
        <text x="89" y="34" text-anchor="middle" fill="#fff" font-size="25" font-weight="850">Assist</text>
        <text x="89" y="56" text-anchor="middle" class="tiny">Ask HA</text>
      </g>
    </g>

    <text id="connection" x="1254" y="792" text-anchor="end" class="tiny">connecting</text>
  </svg>

  <div id="assistPanel" aria-hidden="true">
    <div class="assist-box">
      <div class="assist-title">Assist</div>
      <div class="assist-row">
        <input id="assistInput" autocomplete="off" placeholder="Ask Home Assistant">
        <button id="assistSend" type="button">Ask</button>
        <button id="assistClose" type="button">Close</button>
      </div>
      <div id="assistAnswer"></div>
    </div>
  </div>

  <script>
    const els = {
      modeLabel: document.getElementById('modeLabel'),
      modeGradA: document.getElementById('modeGradA'),
      modeGradB: document.getElementById('modeGradB'),
      roomTemp: document.getElementById('roomTemp'),
      humidity: document.getElementById('humidity'),
      band: document.getElementById('band'),
      outside: document.getElementById('outside'),
      targetMain: document.getElementById('targetMain'),
      targetDetail: document.getElementById('targetDetail'),
      roomsSubtitle: document.getElementById('roomsSubtitle'),
      sockFill: document.getElementById('sockFill'),
      sockStatus: document.getElementById('sockStatus'),
      sockHeart: document.getElementById('sockHeart'),
      sockOxygen: document.getElementById('sockOxygen'),
      sockBattery: document.getElementById('sockBattery'),
      sockSignal: document.getElementById('sockSignal'),
      assistButton: document.getElementById('assistButton'),
      camerasButton: document.getElementById('camerasButton'),
      assistPanel: document.getElementById('assistPanel'),
      assistInput: document.getElementById('assistInput'),
      assistSend: document.getElementById('assistSend'),
      assistClose: document.getElementById('assistClose'),
      assistAnswer: document.getElementById('assistAnswer'),
      connection: document.getElementById('connection')
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
      paused: ['#ef4444', '#581c87'],
      offline: ['#f59e0b', '#7c2d12'],
      hold: ['#22c55e', '#047857']
    };

    function setText(id, value) {
      if (!id) return;
      id.textContent = value;
    }

    function setModeText(value) {
      if (!els.modeLabel) return;
      els.modeLabel.textContent = value;
      const length = String(value || '').length;
      els.modeLabel.style.fontSize = length > 15 ? '22px' : length > 11 ? '27px' : '34px';
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
      setText(node.miniFan, miniStatus ? miniStatus.fan || '--' : '');
      setText(node.miniCompressor, miniStatus ? miniStatus.compressor || '--' : '');
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

    function applyState(data) {
      const colors = modeColors[data.mode.type] || modeColors.hold;
      els.modeGradA.setAttribute('stop-color', colors[0]);
      els.modeGradB.setAttribute('stop-color', colors[1]);

      setModeText(data.mode.label);
      setText(els.roomTemp, temp(data.metrics.roomTemp, 1));
      setText(els.humidity, pct(data.metrics.roomHumidity));
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
      setText(els.sockHeart, Number.isFinite(sock.heart) ? sock.heart + ' bpm' : '--');
      setText(els.sockOxygen, Number.isFinite(sock.oxygen) ? sock.oxygen + '%' : Number.isFinite(sock.oxygenAverage) ? sock.oxygenAverage + '% avg' : '--');
      setText(els.sockBattery, Number.isFinite(sock.battery) ? sock.battery + '%' : '--');
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

    async function action(name) {
      els.connection.textContent = 'sending';
      try {
        await fetch('/action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name })
        });
        await refresh();
      } catch (error) {
        els.connection.textContent = 'action failed';
      }
    }

    function openAssist() {
      els.assistPanel.classList.add('open');
      els.assistPanel.setAttribute('aria-hidden', 'false');
      els.assistAnswer.textContent = '';
      setTimeout(() => els.assistInput.focus(), 80);
    }

    function closeAssist() {
      els.assistPanel.classList.remove('open');
      els.assistPanel.setAttribute('aria-hidden', 'true');
      els.assistInput.blur();
    }

    async function sendAssist() {
      const text = els.assistInput.value.trim();
      if (!text) return;
      els.assistAnswer.textContent = 'Thinking...';
      try {
        const response = await fetch('/assist', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text })
        });
        const data = await response.json();
        els.assistAnswer.textContent = data.text || data.error || 'Done.';
        await refresh();
      } catch (error) {
        els.assistAnswer.textContent = 'Assist failed.';
      }
    }

    document.querySelectorAll('[data-action]').forEach(node => {
      node.addEventListener('pointerup', event => {
        action(node.dataset.action);
        event.preventDefault();
      });
    });

    els.assistButton.addEventListener('pointerup', event => {
      openAssist();
      event.preventDefault();
    });
    els.camerasButton.addEventListener('pointerup', event => {
      window.location.href = '/cameras';
      event.preventDefault();
    });
    els.assistSend.addEventListener('click', sendAssist);
    els.assistClose.addEventListener('click', closeAssist);
    els.assistInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') sendAssist();
      if (event.key === 'Escape') closeAssist();
    });

    refresh();
    setInterval(refresh, 1000);
  </script>
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

    refreshState();
    setInterval(refreshState, 5000);
  </script>
</body>
</html>`;
}

function liveHtml(slug) {
  const camera = cameraConfig(slug);
  if (!camera) return null;
  const token = String(attr(camera.liveEntity, 'access_token', ''));
  const snapshotUrl = `/camera/${camera.slug}/snapshot.jpg`;
  const streamPath = camera.streamPath || CONFIG.cameraPanel?.streamPath || '/api/blink_liveview_proxy/cameras/{slug}/mpegts';
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
      grid-template-columns: repeat(5, minmax(0, 1fr));
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
    button.talk {
      background: rgba(15,118,110,0.94);
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
    <video id="video" muted playsinline autoplay></video>
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
      <button id="talk" class="talk" type="button" disabled>Talk</button>
    </nav>
  </main>
  <script src="/local/blink-liveview-proxy/mpegts.min.js"></script>
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
    const streamPathTemplate = ${jsValue(streamPath)};
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
    const talk = document.getElementById('talk');
    const sessionId = window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now() + '-' + Math.random().toString(36).slice(2);
    let player = null;
    let endTimer = null;
    let hasVisibleFrame = false;

    function streamUrl() {
      const token = encodeURIComponent(accessToken || '');
      const session = encodeURIComponent(sessionId);
      const path = streamPathTemplate.replaceAll('{slug}', encodeURIComponent(slug));
      return path +
        '?token=' + token +
        '&seconds=' + streamSeconds +
        '&force=1&session=' + session +
        '&cache=' + Date.now();
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
      talk.disabled = true;
    }

    function stopPlayer() {
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
      setLoading('Waking camera and waiting for video');

      if (!window.mpegts || !mpegts.getFeatureList().mseLivePlayback) {
        setEnded('This browser cannot play the direct MPEG-TS stream.');
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

      try {
        await video.play();
      } catch (error) {
        statusText.textContent = 'Tap Restart to start live view';
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

    talk.addEventListener('pointerup', event => {
      event.preventDefault();
      statusText.textContent = window.isSecureContext
        ? 'Microphone bridge is not enabled on this proxy yet.'
        : 'Talk needs HTTPS or a trusted browser origin.';
      overlay.classList.remove('hidden');
    });

    window.addEventListener('beforeunload', stopPlayer);
    startPlayer();
  </script>
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

    if (req.method === 'GET' && url.pathname === '/cameras/state') {
      await pollStates();
      sendJson(res, 200, camerasState());
      return;
    }

    const proxyPrefixes = CONFIG.cameraPanel?.proxyPrefixes || [
      '/api/blink_liveview_proxy/',
      '/api/camera_proxy/',
      '/local/blink-liveview-proxy/'
    ];
    if (req.method === 'GET' && proxyPrefixes.some(prefix => url.pathname.startsWith(prefix))) {
      await proxyHaResponse(req, res, `${url.pathname}${url.search}`, {
        cacheControl: url.pathname.startsWith('/local/') ? 'public, max-age=3600' : 'no-store'
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
      await callAction(String(payload.name || ''));
      await pollStates(true).catch(() => {});
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/assist') {
      const payload = await readJson(req);
      const result = await processAssist(payload.text);
      await pollStates(true).catch(() => {});
      sendJson(res, 200, result);
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

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function shutdown() {
  server.close(() => process.exit(0));
}

server.listen(PORT, HOST, () => {
  console.log(`HA Light Panel listening on http://${HOST}:${PORT}/`);
  console.log(`Home Assistant: ${haBaseUrl()}`);
});

pollStates(true).catch(error => {
  console.error(`Initial HA poll failed: ${error.message}`);
});
