#!/usr/bin/env node
// A room's optional companion reading appears in /state only while its
// visibleWhen rule matches, and fails closed to the plain card otherwise.
'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const ROOT = path.resolve(__dirname, '..');
const SERVER = path.resolve(process.argv.find(arg => arg.endsWith('server.js')) || path.join(ROOT, 'server.js'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const entity = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes });

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-room-companion-'));
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/frameo-climate.json')));
  const home = config.panel.rooms.find(room => room.id === 'whole_home');
  home.companion = {
    label: 'Pipe Sensor',
    temp: 'sensor.pipe_temperature',
    battery: 'sensor.pipe_battery',
    extra: 'Pipe area',
    visibleWhen: { entity: 'input_select.seasonal_mode', state: 'Winter' }
  };
  const season = entity('input_select.seasonal_mode', 'Winter');
  const pipe = entity('sensor.pipe_temperature', '41.37', { unit_of_measurement: '°F' });
  const battery = entity('sensor.pipe_battery', '88', { unit_of_measurement: '%' });
  let states = [season, pipe, battery];
  const ha = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(req.url === '/api/states' ? JSON.stringify(states) : '{}');
  });
  ha.listen(0, '127.0.0.1');
  await once(ha, 'listening');
  const probe = http.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  let logs = '';
  const child = spawn(process.execPath, [SERVER], { cwd: ROOT, env: { ...process.env,
    CONFIG_PATH: path.join(dir, 'config.json'), HOST: '127.0.0.1', PORT: String(port), POLL_MS: '250',
    HA_URL: `http://127.0.0.1:${ha.address().port}`, HA_TOKEN: 'test-token'
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  const base = `http://127.0.0.1:${port}`;
  const rooms = async () => {
    await delay(600);
    const data = await (await fetch(base + '/state')).json();
    return Object.fromEntries(data.rooms.map(room => [room.id, room]));
  };
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + '/state')).ok) break; } catch (_) { /* startup */ }
      await delay(50);
    }
    let current = await rooms();
    assert.deepEqual(current.whole_home.companion,
      { label: 'Pipe Sensor', temp: 41.4, humidity: null, battery: 88, extra: 'Pipe area' });
    assert.equal(current.living.companion, undefined, 'rooms without a companion are untouched');

    for (const hidden of ['Summer', 'unknown', 'unavailable']) {
      season.state = hidden;
      current = await rooms();
      assert.equal(current.whole_home.companion, undefined, `hidden while season is ${hidden}`);
    }
    season.state = 'Winter';
    states = [pipe, battery];
    assert.equal((await rooms()).whole_home.companion, undefined, 'missing visibility entity fails closed');
    states = [season, battery];
    assert.equal((await rooms()).whole_home.companion.temp, null, 'a dead sensor reads null, not a stale number');
    console.log('Room companion checks passed.');
  } catch (error) {
    console.error(logs);
    throw error;
  } finally {
    child.kill();
    ha.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exit(1); });
