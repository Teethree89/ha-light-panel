#!/usr/bin/env node
// Checks that the pages stay under the ingress prefix when served through the
// ha_light_panel integration (X-Ingress-Path: /api/ha_light_panel) or add-on
// ingress, and that snapshots come from where Home Assistant actually keeps them.
//
// The ingress shim in server.js only rewrites fetch() and XHR. Anything the
// browser loads straight from markup (<img src>, <a href>, <script src>) must
// carry the prefix itself, or it is requested from Home Assistant's root and
// 404s. The live page once shipped its snapshot backdrop that way.
//
// Starts server.js against a stub Home Assistant on free local ports, so it
// needs no network, token or config of its own.
//
//   node scripts/check-ingress-urls.js [path/to/server.js]

'use strict';
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SERVER = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'));
const INGRESS = '/api/ha_light_panel';
const SLUG = 'front';
// Served by Home Assistant itself rather than the panel, so the shim and the
// markup both deliberately leave it unprefixed.
const HA_DIRECT_PREFIX = '/api/blink_liveview_proxy/';

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const failures = [];
function check(label, ok, detail = '') {
  if (!ok) failures.push(`${label}${detail ? ': ' + detail : ''}`);
}

async function main() {
  const haRequests = [];
  const ha = http.createServer((req, res) => {
    haRequests.push(`${req.method} ${req.url}`);
    if (req.url.startsWith('/api/states')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([
        { entity_id: `camera.${SLUG}`, state: 'idle', attributes: { entity_picture: `/api/camera_proxy/camera.${SLUG}?token=abc` } },
        { entity_id: `camera.${SLUG}_live`, state: 'idle', attributes: { access_token: 'live-token' } }
      ]));
    } else if (req.url.startsWith('/api/camera_proxy/')) {
      res.setHeader('content-type', 'image/jpeg');
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  const haPort = await freePort();
  await new Promise(resolve => ha.listen(haPort, '127.0.0.1', resolve));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-light-panel-ingress-'));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    cameras: [{ slug: SLUG, label: 'Front', sourceEntity: `camera.${SLUG}`, liveEntity: `camera.${SLUG}_live` }],
    // Enables the Blink Status UI so its markup and overlay are part of the check.
    blinkOps: { proxyStatusUrl: `http://127.0.0.1:${haPort}/status` }
  }));
  const port = await freePort();
  let output = '';
  const child = spawn(process.execPath, [SERVER], {
    cwd: dir,
    env: {
      ...process.env,
      CONFIG_PATH: configPath,
      HOST: '127.0.0.1',
      PORT: String(port),
      HA_URL: `http://127.0.0.1:${haPort}`,
      HA_TOKEN: 'test-token'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });

  const cleanup = () => {
    child.kill();
    ha.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };

  try {
    const base = `http://127.0.0.1:${port}`;
    const get = async (pathname, headers = {}) => {
      const response = await fetch(base + pathname, { headers });
      return { status: response.status, type: response.headers.get('content-type') || '', body: await response.text() };
    };

    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
      try {
        ready = (await get('/cameras')).status === 200;
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    if (!ready) throw new Error('server.js did not start serving /cameras');

    const ingress = { 'x-ingress-path': INGRESS };
    const pages = ['/', '/cameras', `/live/${SLUG}`, `/clips/${SLUG}`, '/mic-test'];
    const bodies = {};
    for (const page of pages) {
      const response = await get(page, ingress);
      check(`GET ${page} under ingress`, response.status === 200, `HTTP ${response.status}`);
      bodies[page] = response.body;
      const rooted = [...response.body.matchAll(/\b(?:src|href|action)\s*=\s*["'](\/[^"'\s]*)["']/g)]
        .map(match => match[1])
        .filter(url => !url.startsWith('//') && !url.startsWith(HA_DIRECT_PREFIX));
      for (const url of new Set(rooted)) {
        check(`${page} markup stays under the ingress prefix`,
          url === INGRESS || url.startsWith(INGRESS + '/'), `found ${url}`);
      }
    }

    // Guard against the loop above passing because nothing matched at all.
    const live = bodies[`/live/${SLUG}`] || '';
    const wanted = `${INGRESS}/camera/${SLUG}/snapshot.jpg`;
    check('live page backdrop uses the prefixed snapshot URL',
      live.includes(`<img class="backdrop-fill" src="${wanted}"`));
    check('live page still frame uses the prefixed snapshot URL',
      live.includes(`<img class="snapshot" src="${wanted}"`));
    check('camera cards use the prefixed snapshot URL',
      (bodies['/cameras'] || '').includes(`href="${wanted}"`));

    // The reconnecting overlay is a full-screen layer. If it ever intercepts taps, a stale proxy
    // leaves every camera button dead until it clears, so it must let them through.
    check('the proxy reconnect overlay does not intercept taps',
      /<div id="proxyRefreshOverlay"[^>]*style="[^"]*pointer-events:\s*none/.test(bodies['/cameras'] || ''));

    // Without the header nothing is prefixed (plain LAN or Docker use).
    const plain = await get(`/live/${SLUG}`);
    check('live page without ingress keeps the bare snapshot URL',
      plain.body.includes(`<img class="snapshot" src="/camera/${SLUG}/snapshot.jpg"`));

    // The panel's own route resolves the real location from entity_picture.
    const snapshot = await get(`/camera/${SLUG}/snapshot.jpg`, ingress);
    check('panel snapshot route serves an image', snapshot.status === 200 && snapshot.type.startsWith('image/'),
      `HTTP ${snapshot.status} ${snapshot.type}`);
    check('panel fetched the snapshot from Home Assistant camera_proxy',
      haRequests.some(request => request === `GET /api/camera_proxy/camera.${SLUG}?token=abc`),
      haRequests.filter(request => request.includes('camera')).join(', ') || 'no camera request seen');
  } catch (error) {
    failures.push(error.message + (output ? `\n--- server.js output ---\n${output.trim()}` : ''));
  } finally {
    cleanup();
  }
}

const hardTimeout = setTimeout(() => {
  console.error('Ingress URL check timed out');
  process.exit(2);
}, 30000);
hardTimeout.unref();

main().then(() => {
  if (failures.length) {
    console.error(`Ingress URL check FAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('Ingress URLs OK: pages stay under the prefix and snapshots resolve through camera_proxy');
  process.exit(0);
}).catch(error => {
  console.error(error);
  process.exit(2);
});
