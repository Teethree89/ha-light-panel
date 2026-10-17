#!/usr/bin/env node
// Exercise the real HTTP action guard against mutable fake HA states. Add
// --browser for optional Playwright checks of taps, modals and SVG geometry.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-companion-'));
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/frameo-climate.json')));
  const season = entity('input_select.seasonal_mode', 'Winter');
  const status = entity('sensor.warm_floors_status', 'ready', { reason: 'Ready for a 20 minute warm-up.', minutes_left: null });
  let states = [season, status];
  let outage = false;
  let serviceFailure = false;
  const calls = [];
  const ha = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (outage) { res.writeHead(503); res.end('{}'); return; }
    if (req.url === '/api/states') { res.end(JSON.stringify(states)); return; }
    if (req.url.startsWith('/api/services/')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      calls.push({ url: req.url, data: JSON.parse(body) });
      if (serviceFailure) { res.writeHead(500); res.end('{"message":"Service failed"}'); return; }
      await delay(150); // Allow duplicate-tap suppression to be exercised.
      status.state = status.state === 'running' ? 'cooling_down' : 'running';
      status.attributes = { reason: status.state === 'running' ? 'Running. Tap to stop.' : 'Cooling down for 30 minutes.', minutes_left: status.state === 'running' ? 12 : null };
      res.end('[]'); return;
    }
    res.writeHead(404); res.end('{}');
  });
  ha.listen(0, '127.0.0.1');
  await once(ha, 'listening');
  let child;
  let browser;
  let logs = '';
  let base;
  const start = async () => {
    if (child) { child.kill(); await once(child, 'exit'); }
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    // Reserve a free port until immediately before starting the child.
    const probe = http.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [SERVER], { cwd: ROOT, env: { ...process.env,
      CONFIG_PATH: path.join(dir, 'config.json'), HOST: '127.0.0.1', PORT: String(port), POLL_MS: '750',
      HA_URL: `http://127.0.0.1:${ha.address().port}`, HA_TOKEN: 'test-token'
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + '/state')).ok) return; } catch (_) { /* startup */ }
      await delay(50);
    }
    throw new Error('Panel startup failed: ' + logs);
  };
  const act = async (extra = {}) => {
    const response = await fetch(base + '/action', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'balanceCompanion', ...extra }) });
    return { code: response.status, data: await response.json() };
  };
  const state = async () => {
    await delay(800);
    return (await (await fetch(base + '/state')).json()).balance.companion;
  };
  try {
    await start();
    assert.equal((await state()).visible, true);
    assert.equal((await state()).canAct, true);
    // Only server config controls service/data; browser substitutions are ignored.
    assert.equal((await act({ service: 'script.evil', data: { entity_id: 'climate.evil' }, expectedActive: false })).code, 200);
    assert.deepEqual(calls[0], { url: '/api/services/script/warm_floors', data: {} });
    assert.equal((await state()).active, true);
    assert.equal((await state()).minutesLeft, 12);
    assert.equal((await act({ expectedActive: false })).code, 409);
    assert.equal(calls.length, 1);
    assert.equal((await act({ expectedActive: true })).code, 200);
    assert.equal((await state()).canAct, false);
    for (const blocked of ['cooling_down', 'maintenance', 'house_warm', 'ecobee_unavailable', 'unknown', 'unavailable']) {
      status.state = blocked; status.attributes.reason = 'Blocked: ' + blocked;
      const count = calls.length;
      const result = await act(); // No preceding /state: guard must refresh on its own.
      assert.equal(result.code, 409, blocked);
      assert.equal(result.data.error, status.attributes.reason);
      assert.equal(calls.length, count);
    }
    status.state = 'ready';
    for (const hidden of ['Summer', 'unknown', 'unavailable']) {
      season.state = hidden;
      assert.equal((await act()).code, 409);
      assert.equal((await state()).visible, false);
    }
    states = [season]; season.state = 'Winter';
    assert.equal((await act()).code, 409, 'missing status entity');
    states = [season, status]; status.state = 'ready';
    outage = true;
    const count = calls.length;
    assert.equal((await act()).code, 500, 'HA outage fails closed');
    assert.equal(calls.length, count);
    outage = false;
    serviceFailure = true;
    assert.equal((await act()).code, 500, 'service error reaches caller');
    serviceFailure = false;
    status.attributes.reason = 'Ready for a 20 minute warm-up.';

    if (process.argv.includes('--browser')) {
      const { chromium } = require('playwright');
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const waitStatus = async value => page.waitForFunction(value => appState.latest?.ok && appState.latest?.balance?.companion?.status === value, value);
      const width = id => page.locator('#' + id).getAttribute('width');
      const waitWidth = value => page.waitForFunction(value => document.getElementById('balanceBg').getAttribute('width') === value, value);
      await page.goto(base);
      await waitStatus('ready');
      assert.equal(await width('balanceBg'), '109');
      assert.equal(await page.locator('#companionText').textContent(), 'Warm');
      assert.equal(await page.locator('#companionText2').textContent(), 'Floors');
      await page.screenshot({ path: '/tmp/warm-floors-landscape.png' });
      const beforeConfirm = calls.length;
      await page.locator('#btnBalanceCompanion').click();
      await page.locator('#infoModal:not(.hidden)').waitFor();
      assert.equal(calls.length, beforeConfirm);
      assert.equal(await page.locator('#infoModalBody').textContent(), status.attributes.reason);
      await page.locator('#infoModalClose').click();
      assert.equal(calls.length, beforeConfirm);
      await page.locator('#btnBalanceCompanion').click();
      await page.locator('#infoModalConfirm').click();
      await waitStatus('running');
      assert.equal(await page.locator('#companionText').textContent(), 'Stop');
      assert.equal(await page.locator('#companionText2').textContent(), '12 min left');
      await page.locator('#btnBalanceCompanion').evaluate(node => {
        node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      });
      await waitStatus('cooling_down');
      assert.equal(calls.length, beforeConfirm + 2, 'one start and one stop, no double toggle or Balance call');
      await page.locator('#btnBalanceCompanion').dispatchEvent('pointerup');
      await page.locator('#infoModal:not(.hidden)').waitFor();
      assert.equal(await page.locator('#infoModalBody').textContent(), status.attributes.reason);
      assert.equal(calls.length, beforeConfirm + 2);
      await page.locator('#infoModalClose').click();
      await page.setViewportSize({ width: 520, height: 900 });
      await waitWidth('212');
      assert.equal(await width('balanceBg'), '212');
      assert.equal(await width('companionBg'), '212');
      await page.screenshot({ path: '/tmp/warm-floors-portrait.png', fullPage: true });
      season.state = 'Summer';
      await page.waitForFunction(() => appState.latest?.balance?.companion?.visible === false);
      assert.equal(await width('balanceBg'), '432');
      await page.setViewportSize({ width: 1280, height: 800 });
      await waitWidth('226');
      assert.equal(await width('balanceBg'), '226');
      assert.equal(await page.locator('#btnBalanceText').textContent(), 'Balance rooms');
      season.state = 'Winter'; status.state = 'ready';
      await page.waitForFunction(() => appState.latest?.balance?.companion?.visible === true);
      assert.equal(await width('balanceBg'), '109');
      await page.setViewportSize({ width: 520, height: 900 });
      await waitWidth('212');
      await page.setViewportSize({ width: 1280, height: 800 });
      await waitWidth('109');
      assert.equal(await width('balanceBg'), '109');
      // A status change while the start confirmation is open must not turn
      // that confirmation into an unintended stop of somebody else's run.
      await waitStatus('ready');
      await page.locator('#btnBalanceCompanion').click();
      const beforeRace = calls.length;
      status.state = 'running';
      await waitStatus('running');
      await page.locator('#infoModalConfirm').click();
      assert.equal(calls.length, beforeRace);
      assert.match(await page.locator('#infoModalBody').textContent(), /status changed/);
      assert.deepEqual(errors, [], 'no browser JavaScript errors');
      await page.close();

      // Builder transformations apply to both halves as one native region.
      config.panel.layout = { nativeCards: { btnBalance: { x: 40, y: 520, w: 300, h: 80, title: 'Air Balance' } } };
      status.state = 'ready';
      await start();
      const custom = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await custom.goto(base);
      await custom.waitForFunction(() => appState.latest?.balance?.companion?.visible === true);
      const transform = await custom.locator('#btnBalance').getAttribute('transform');
      assert.match(transform, /translate\(40 520\) scale\(/);
      assert.equal(await custom.locator('#btnBalanceText').textContent(), 'Air');
      assert.equal(await custom.locator('#btnBalanceText2').textContent(), 'Balance');
      const first = await custom.locator('#balanceBg').boundingBox();
      const second = await custom.locator('#companionBg').boundingBox();
      assert.ok(second.x > first.x + first.width);
      assert.ok(Math.abs(second.width - first.width) < 0.1);
      assert.ok(Math.abs(second.x + second.width - first.x - 300) < 0.1);
      await custom.close();
      delete config.panel.layout;

    }

    // A negative-only visibility rule must also fail closed on missing data.
    config.panel.balance.companion.visibleWhen = { entity: season.entity_id, notState: 'Summer' };
    season.state = 'unavailable';
    await start();
    assert.equal((await state()).visible, false);
    assert.equal((await act()).code, 409);

    delete config.panel.balance.companion;
    await start();
    assert.deepEqual(await state(), { configured: false, visible: false });
    assert.equal((await act()).code, 500);
    if (browser) {
      const page = await browser.newPage();
      await page.goto(base);
      await page.waitForFunction(() => appState.latest !== null);
      assert.equal(await page.locator('#balanceBg').getAttribute('width'), '226');
      assert.equal(await page.locator('#btnBalanceCompanion').isVisible(), false);
      await page.close();
    }
    console.log('Balance companion checks passed' + (browser ? ' (including browser layout, confirmation and start/stop)' : ''));
  } finally {
    if (browser) await browser.close();
    if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    await new Promise(resolve => ha.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
