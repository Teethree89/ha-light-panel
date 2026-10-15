#!/usr/bin/env node
// Checks the Blink proxy auto-restart rules in server.js without starting it.
//
// server.js starts a listener when loaded, so the functions under test are
// pulled out of its source BY NAME (proxyNeedsAutoRestart,
// autoRestartBlinkProxyIfStale, runAutoRestartIfStale and the Cameras page's
// proxyLooksStaleForRestart / checkAutoRestartProxy / proxyIsUnhealthy) and run
// in a vm with a stubbed proxy status, a stubbed restart and a virtual clock,
// so the real 12 s re-check, 90 s grace and 5 minute cooldown are exercised
// instantly. Renaming one of those functions fails this script loudly.
//
//   node scripts/check-proxy-auto-restart.js [path/to/server.js] [--verbose]

'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const SERVER = path.resolve(args.find(arg => !arg.startsWith('--')) || path.join(__dirname, '..', 'server.js'));
const src = fs.readFileSync(SERVER, 'utf8');

// ---- extraction by name ---------------------------------------------------
function extractFunction(name) {
  const m = new RegExp('^[ \\t]*(?:async )?function ' + name + '\\(', 'm').exec(src);
  if (!m) throw new Error('function not found: ' + name);
  let i = src.indexOf('{', m.index);
  const start = m.index;
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"') {
      for (i++; src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unterminated: ' + name);
}
function extractDecl(name) {
  const m = new RegExp('^[ \\t]*(?:const|let) ' + name + ' = [^;]+;', 'm').exec(src);
  if (!m) throw new Error('decl not found: ' + name);
  return m[0];
}

const decls = ['AUTO_PROXY_RESTART_COOLDOWN_MS', 'AUTO_PROXY_RESTART_RECHECK_MS', 'PROXY_STARTUP_GRACE_SECONDS',
  'lastAutoProxyRestartAt', 'autoProxyRestartInFlight',
  'proxyAutoRestartChecked', 'proxyManualRestartAt', 'PROXY_MANUAL_RESTART_QUIET_MS',
  'proxyAutoRestartRetryAt', 'PROXY_AUTO_RESTART_RETRY_MS', 'PROXY_OVERLAY_DELAY_MS'].map(extractDecl);
const graceValue = Number(/PROXY_STARTUP_GRACE_SECONDS = (\d+)/.exec(decls[2])[1]);
const recheckValue = Number(/AUTO_PROXY_RESTART_RECHECK_MS = (\d+)/.exec(decls[1])[1]);
const functions = ['proxyNeedsAutoRestart', 'autoRestartBlinkProxyIfStale', 'runAutoRestartIfStale',
  'proxyLooksStaleForRestart', 'checkAutoRestartProxy', 'proxyIsUnhealthy'].map(extractFunction);
// The page script interpolates server constants; resolve them as the template would.
const code = (decls.join('\n') + '\n' + functions.join('\n'))
  .replace('${PROXY_STARTUP_GRACE_SECONDS}', String(graceValue))
  .replace('${AUTO_PROXY_RESTART_RECHECK_MS}', String(recheckValue));
if (/\$\{/.test(code)) throw new Error('unresolved interpolation left in extracted code');

// ---- harness --------------------------------------------------------------
const T0 = 1_000_000_000_000; // virtual epoch ms (non-zero: lastAutoProxyRestartAt uses 0 for "never")

function makeEnv(statusAt, opts = {}) {
  let now = T0;
  let seq = 0;
  let timers = [];
  const env = { restarts: [], posts: 0, overlayShown: 0, overlayAt: [], overlayMessages: [], overlayVisible: false, statusCalls: 0, results: [] };
  const tSec = () => (now - T0) / 1000;

  const fakeSetTimeout = (fn, ms) => { const id = ++seq; timers.push({ id, at: now + (ms || 0), fn }); return id; };
  const fakeClearTimeout = id => { timers = timers.filter(t => t.id !== id); };
  const sleepVirtual = ms => new Promise(resolve => fakeSetTimeout(resolve, ms));

  class FakeDate extends Date { static now() { return now; } }

  const sandbox = {
    Date: FakeDate,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    console,
    proxyRefreshMessage: { textContent: '' },
    showProxyRefreshOverlay(message) {
      env.overlayShown++; env.overlayAt.push(tSec()); env.overlayMessages.push(message); env.overlayVisible = true;
      sandbox.proxyRefreshMessage.textContent = message;
    },
    hideProxyRefreshOverlay() { env.overlayVisible = false; },
    async loadTokenStatus() {},
    async blinkProxyStatus() {
      env.statusCalls++;
      if (opts.statusThrowsOnce && !env.threw) { env.threw = true; throw new Error('boom'); }
      return JSON.parse(JSON.stringify(statusAt(tSec())));
    },
    async restartBlinkProxyAndWait() {
      env.restarts.push(tSec());
      await sleepVirtual(5000); // a restart takes a few seconds, so concurrent callers can overlap it
      return { ok: true };
    },
    async fetch() {
      env.posts++;
      const result = await ctx.autoRestartBlinkProxyIfStale();
      env.results.push(result);
      return { json: async () => result };
    }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx);

  const flush = async () => { for (let i = 0; i < 25; i++) await new Promise(r => setImmediate(r)); };
  async function advanceTo(sec) {
    const target = T0 + sec * 1000;
    await flush();
    for (;;) {
      const due = timers.filter(t => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      timers = timers.filter(t => t !== due);
      now = due.at;
      due.fn();
      await flush();
    }
    now = target;
    await flush();
  }

  // Real getters: Object.assign would evaluate them once and copy the value.
  Object.defineProperties(env, {
    lastStamp: { get: () => vm.runInContext('lastAutoProxyRestartAt', ctx) },
    inFlight: { get: () => vm.runInContext('autoProxyRestartInFlight', ctx) !== null },
    oneShotSpent: { get: () => vm.runInContext('proxyAutoRestartChecked', ctx) }
  });
  Object.assign(env, {
    ctx, advanceTo, tSec,
    serverVerdict: s => ctx.proxyNeedsAutoRestart(s),
    clientVerdict: s => ctx.proxyLooksStaleForRestart(s),
    // Page model: renderTokenStatus() fires checkAutoRestartProxy(proxy) un-awaited on every poll.
    async runPage(everySec, durationSec, tailSec = 90) {
      for (let t = 0; t <= durationSec; t += everySec) {
        await advanceTo(t);
        ctx.checkAutoRestartProxy(statusAt(t));
      }
      await advanceTo(durationSec + tailSec);
    },
    // Server-only model: another page / tab POSTs on its own schedule, one request per tick.
    async runServerOnly(everySec, durationSec, tailSec = 90) {
      const pending = [];
      for (let t = 0; t <= durationSec; t += everySec) {
        await advanceTo(t);
        pending.push(ctx.autoRestartBlinkProxyIfStale().then(r => { env.results.push(r); return r; }));
      }
      await advanceTo(durationSec + tailSec);
      return Promise.all(pending);
    }
  });
  return env;
}

const H = over => Object.assign({
  ok: true, ready: true, auth_state: 'success', process_uptime_seconds: 18000,
  token_seconds_remaining: 80000, watchdog_attempts: 0, cameras_discovered: 4, cameras_configured: 4
}, over);
const DOWN = { ok: false, error: 'fetch failed' };

// Page runs are gated by the client predicate, so a server-only regression would hide behind it.
// Every status-only scenario is therefore also run as one direct server call (a second page/tab).
async function direct(statusAt) {
  const e = makeEnv(statusAt);
  const p = e.ctx.autoRestartBlinkProxyIfStale();
  await e.advanceTo(60);
  const r = await p;
  return { restarts: e.restarts.length, result: r };
}

let finished = false;
process.on('exit', code => {
  if (!finished) { console.error('HARNESS DID NOT FINISH (a promise never settled)'); process.exitCode = 3; }
});

const rows = [];
function record(id, label, expected, actual, extra = '') {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  rows.push({ id, label, expected, actual, pass, extra });
}

(async () => {
  // S1 manual restart: unreachable 3 s, authenticating at uptime 1-6 s, then ready; polled every second.
  const s1 = t => t < 3 ? DOWN
    : t < 9 ? H({ ready: false, auth_state: 'authenticating', process_uptime_seconds: t - 2, token_seconds_remaining: null })
      : H({ process_uptime_seconds: t - 2 });
  for (const every of [1, 15]) {
    const e = makeEnv(s1);
    await e.runPage(every, 60);
    record('S1', `manual restart, page polls every ${every}s`, 0, e.restarts.length,
      `posts=${e.posts} overlayShown=${e.overlayShown} overlayVisibleAtEnd=${e.overlayVisible} oneShotSpent=${e.oneShotSpent} cooldownStamped=${e.lastStamp !== 0}`);
    record('S1', `one-shot not spent after the recovered blip (every ${every}s)`, [false, false], [e.oneShotSpent, e.overlayVisible]);
  }
  {
    // A benign blip first (the manual restart), then a genuine fault later in the SAME page load.
    // If the blip spent the page's one-shot, the real fault would never be acted on.
    const s1b = t => t < 100 ? s1(t)
      : H({ ready: false, auth_state: 'failure', process_uptime_seconds: 2000 + t, token_seconds_remaining: null });
    const e = makeEnv(s1b);
    await e.runPage(15, 200);
    record('S1b', 'blip (recovered) then real fault on same page load: restarts', 1, e.restarts.length,
      `posts=${e.posts} restartAt=${e.restarts.map(r => r.toFixed(1))} oneShotSpent=${e.oneShotSpent}`);
  }
  {
    // Restart Proxy pressed on this page: its own downtime must not raise the overlay or a POST.
    const e = makeEnv(s1);
    vm.runInContext('proxyManualRestartAt = Date.now()', e.ctx); // what the button handler does
    await e.runPage(1, 60);
    record('S1c', 'Restart Proxy pressed on this page: no POST, no overlay, no restart', [0, 0, 0],
      [e.posts, e.overlayShown, e.restarts.length]);
    // ...but if that manual restart did not help, the page still acts once the quiet period is over.
    const f = makeEnv(() => DOWN);
    vm.runInContext('proxyManualRestartAt = Date.now()', f.ctx);
    await f.runPage(15, 120);
    record('S1d', 'manual restart failed: page acts only after the quiet period (45s + 12s re-check)', [1, 57],
      [f.restarts.length, f.restarts[0]]);
    record('S1d', 'the Restart Proxy handler records the press time before it POSTs', true,
      /proxyManualRestartAt = Date\.now\(\);\s*\n\s*const original = button\.textContent;/.test(src));
  }
  {
    // Server-side only, every second, for the same timeline (no client one-shot involved).
    const e = makeEnv(s1);
    await e.runServerOnly(1, 60);
    record('S1', 'manual restart, server called every 1s (no client)', 0, e.restarts.length, `calls=${e.statusCalls}`);
  }

  // S2 reset + manual sign-in.
  const s2 = t => t < 30 ? H({ ready: false, auth_state: 'idle', process_uptime_seconds: 20000 + t, token_seconds_remaining: null })
    : t < 35 ? H({ ready: false, auth_state: 'authenticating', process_uptime_seconds: 20000 + t, token_seconds_remaining: null })
      : t < 75 ? H({ ready: false, auth_state: 'waiting_for_pin', process_uptime_seconds: 20000 + t, token_seconds_remaining: null })
        : t < 80 ? H({ ready: false, auth_state: 'authenticating', process_uptime_seconds: 20000 + t, token_seconds_remaining: null })
          : H({ auth_state: 'success', process_uptime_seconds: 20000 + t });
  for (const every of [1, 15]) {
    const e = makeEnv(s2);
    await e.runPage(every, 200);
    record('S2', `reset + sign-in, page polls every ${every}s`, 0, e.restarts.length,
      `posts=${e.posts} overlayShown=${e.overlayShown} statusCalls=${e.statusCalls}`);
  }
  {
    const e = makeEnv(s2);
    await e.runServerOnly(1, 200);
    record('S2', 'reset + sign-in, server called every 1s (no client)', 0, e.restarts.length, `calls=${e.statusCalls}`);
  }

  // S3 stuck: uptime 20 min, ready:false, failure.
  const s3 = t => H({ ready: false, auth_state: 'failure', process_uptime_seconds: 1200 + t, token_seconds_remaining: null });
  {
    const e = makeEnv(s3);
    await e.runPage(15, 280);
    record('S3', 'stuck, page polls every 15s for 280s', 1, e.restarts.length,
      `posts=${e.posts} restartAt=${e.restarts.map(r => r.toFixed(1))} overlayVisibleAtEnd=${e.overlayVisible} oneShotSpent=${e.oneShotSpent}`);
    record('S3', 'one-shot IS spent after a real restart (page does not re-POST)', [true, 1], [e.oneShotSpent, e.posts]);
  }
  {
    const e = makeEnv(s3);
    await e.runServerOnly(15, 280);
    const afterCooldown = e.restarts.length;
    record('S3', 'stuck, server called every 15s for 280s (cooldown)', 1, afterCooldown,
      `restartAt=${e.restarts.map(r => r.toFixed(1))} skipped=${e.results.filter(r => r.skipped).length}/${e.results.length}`);
    await e.advanceTo(330);
    const late = e.ctx.autoRestartBlinkProxyIfStale();
    await e.advanceTo(400);
    await late;
    record('S3', 'stuck, one call after the 5 min cooldown has expired', 2, e.restarts.length,
      `restartAt=${e.restarts.map(r => r.toFixed(1))}`);
  }

  // S4 service stopped.
  {
    const e = makeEnv(() => DOWN);
    await e.runPage(15, 120);
    record('S4', 'service stopped (unreachable throughout), page', 1, e.restarts.length,
      `posts=${e.posts} restartAt=${e.restarts.map(r => r.toFixed(1))}`);
  }
  {
    const e = makeEnv(t => t < 8 ? DOWN : H({ process_uptime_seconds: t - 7 }));
    await e.runPage(1, 40);
    record('S4b', 'unreachable only 8 s (< 12 s re-check), page every 1s', 0, e.restarts.length,
      `posts=${e.posts} overlayShown=${e.overlayShown} oneShotSpent=${e.oneShotSpent}`);
  }

  // S5 token expired.
  {
    const e = makeEnv(() => H({ ready: true, token_seconds_remaining: -100, process_uptime_seconds: 18000 }));
    await e.runPage(15, 60);
    record('S5', 'token expired, ready:true, uptime 5h', 1, e.restarts.length, `posts=${e.posts}`);
    const d = await direct(() => H({ ready: true, token_seconds_remaining: -100, process_uptime_seconds: 18000 }));
    record('S5', 'token expired, direct server call', 1, d.restarts, JSON.stringify(d.result));
  }

  // S6 two simultaneous auto calls during S3 (plus a third that arrives mid-restart).
  {
    const e = makeEnv(s3);
    const a = e.ctx.autoRestartBlinkProxyIfStale();
    const b = e.ctx.autoRestartBlinkProxyIfStale();
    await e.advanceTo(14);
    const c = e.ctx.autoRestartBlinkProxyIfStale(); // arrives while the 5 s restart is still running
    await e.advanceTo(60);
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    const same = ra === rb && rb === rc;
    record('S6', 'three concurrent callers share one run', 1, e.restarts.length,
      `sameResult=${same} result=${JSON.stringify(ra)} inFlightAfter=${e.inFlight}`);
    record('S6', 'all callers got an identical result object', true, same && ra.restarted === true);
  }

  // S7 first look stale, re-check healthy.
  {
    const s7 = t => t < 5 ? H({ ready: false, auth_state: 'failure', process_uptime_seconds: 1200 + t })
      : t < 40 ? H({ process_uptime_seconds: 1200 + t })
        : H({ ready: false, auth_state: 'failure', process_uptime_seconds: 1200 + t });
    const e = makeEnv(s7);
    const p = e.ctx.autoRestartBlinkProxyIfStale();
    await e.advanceTo(13);
    const r = await p;
    record('S7', 'stale then healthy: restarts', 0, e.restarts.length, `result=${JSON.stringify(r)}`);
    record('S7', 'stale then healthy: cooldown NOT stamped', 0, e.lastStamp);
    const stampedProbe = makeEnv(s3);
    const sp = stampedProbe.ctx.autoRestartBlinkProxyIfStale();
    await stampedProbe.advanceTo(30); await sp;
    record('S7', 'sanity: a real restart DOES stamp the cooldown (getter is live)', true, stampedProbe.lastStamp !== 0);
    await e.advanceTo(45);
    const p2 = e.ctx.autoRestartBlinkProxyIfStale();
    await e.advanceTo(90);
    const r2 = await p2;
    record('S7', 'real fault shortly after is still acted on', 1, e.restarts.length, `result=${JSON.stringify(r2)}`);
  }

  // S8 older proxy: no auth_state, no process_uptime_seconds.
  {
    const e = makeEnv(() => ({ ok: true, ready: false, token_seconds_remaining: null }));
    await e.runPage(15, 60);
    record('S8', 'older proxy, ready:false, no auth_state/uptime', 1, e.restarts.length, `posts=${e.posts} restartAt=${e.restarts.map(r => r.toFixed(1))}`);
    const d = await direct(() => ({ ok: true, ready: false, token_seconds_remaining: null }));
    record('S8', 'older proxy, direct server call', 1, d.restarts, JSON.stringify(d.result));
  }

  // S9 grace boundary.
  for (const [uptime, expected] of [[89, 0], [90, 1], [91, 1]]) {
    const e = makeEnv(() => H({ ready: false, auth_state: 'failure', process_uptime_seconds: uptime, token_seconds_remaining: null }));
    await e.runPage(15, 30);
    record('S9', `uptime ${uptime}s, ready:false, failure (static)`, expected, e.restarts.length,
      `server=${e.serverVerdict(H({ ready: false, auth_state: 'failure', process_uptime_seconds: uptime }))} client=${e.clientVerdict(H({ ready: false, auth_state: 'failure', process_uptime_seconds: uptime }))}`);
    const d = await direct(() => H({ ready: false, auth_state: 'failure', process_uptime_seconds: uptime, token_seconds_remaining: null }));
    record('S9', `uptime ${uptime}s, direct server call`, expected, d.restarts, JSON.stringify(d.result));
  }
  {
    // Uptime that actually advances through the boundary: 85 at t=0.
    const e = makeEnv(t => H({ ready: false, auth_state: 'failure', process_uptime_seconds: 85 + t, token_seconds_remaining: null }));
    await e.runPage(1, 30, 90);
    record('S9', 'uptime 85 -> crosses 90 at t=5, polled every 1s', 1, e.restarts.length,
      `posts=${e.posts} restartAt=${e.restarts.map(r => r.toFixed(1))}`);
  }

  // S10 unknown auth_state.
  {
    const e = makeEnv(() => H({ ready: false, auth_state: 'foo', process_uptime_seconds: 600, token_seconds_remaining: null }));
    await e.runPage(15, 60);
    record('S10', 'unknown auth_state "foo", ready:false, past grace', 1, e.restarts.length, `posts=${e.posts}`);
    const d = await direct(() => H({ ready: false, auth_state: 'foo', process_uptime_seconds: 600, token_seconds_remaining: null }));
    record('S10', 'unknown auth_state, direct server call', 1, d.restarts, JSON.stringify(d.result));
    for (const st of ['authenticating', 'waiting_for_pin', 'idle']) {
      const x = await direct(() => H({ ready: false, auth_state: st, process_uptime_seconds: 20000, token_seconds_remaining: null }));
      record('S2', `direct server call, ${st} + ready:false, uptime hours`, 0, x.restarts, JSON.stringify(x.result));
    }
    for (const st of ['failure', 'expired', 'success']) {
      const x = await direct(() => H({ ready: false, auth_state: st, process_uptime_seconds: 20000, token_seconds_remaining: null }));
      record('S3', `direct server call, ${st} + ready:false, uptime hours`, 1, x.restarts, JSON.stringify(x.result));
    }
    const y = await direct(() => H({ ready: false, auth_state: 'failure', process_uptime_seconds: 30, token_seconds_remaining: null }));
    record('S9', 'direct server call, failure + ready:false, uptime 30s (startup)', 0, y.restarts, JSON.stringify(y.result));
    const z = await direct(() => H({ ready: true, token_seconds_remaining: -50, process_uptime_seconds: 30 }));
    record('S9', 'direct server call, token expired but uptime 30s', 0, z.restarts, JSON.stringify(z.result));
  }

  // Extras.
  {
    const e = makeEnv(() => H({ ready: false, auth_state: 'failure', process_uptime_seconds: -5, token_seconds_remaining: null }));
    await e.runPage(15, 30);
    record('E1', 'negative uptime (clock stepped back) is not a grace period', 1, e.restarts.length);
  }
  {
    const e = makeEnv(() => H({ ready: false, auth_state: 'failure', process_uptime_seconds: null, token_seconds_remaining: null }));
    await e.runPage(15, 30);
    record('E2', 'uptime null (not a number) falls through to stale', 1, e.restarts.length);
  }
  {
    const e = makeEnv(() => H({ watchdog_attempts: 5 }));
    await e.runPage(15, 60);
    record('E3', 'healthy but watchdog_attempts 5: no POST, no overlay (dot stays red)', [0, 0, 0], [e.posts, e.overlayShown, e.restarts.length]);
  }
  {
    const e = makeEnv(s3, { statusThrowsOnce: true });
    const first = e.ctx.autoRestartBlinkProxyIfStale().then(() => false, () => true);
    await e.advanceTo(1);
    const threw = await first;
    const clearedAfterThrow = !e.inFlight;
    const p2 = e.ctx.autoRestartBlinkProxyIfStale();
    await e.advanceTo(60);
    await p2;
    record('E4', 'in-flight promise is cleared after a rejection; next call still works',
      [true, true, 1], [threw, clearedAfterThrow, e.restarts.length]);
  }
  {
    const settlesAtOnce = async (e, p) => {
      let done = false;
      p.then(() => { done = true; }, () => { done = true; });
      await e.advanceTo(e.tSec()); // flush microtasks only; the virtual clock does not move
      return done;
    };
    const e = makeEnv(s3);
    const p = e.ctx.autoRestartBlinkProxyIfStale();
    await e.advanceTo(30); await p;
    const q = e.ctx.autoRestartBlinkProxyIfStale(); // inside the 5 min cooldown
    const quick = await settlesAtOnce(e, q);
    await e.advanceTo(60);
    const r = await q;
    record('E5', 'cooldown skip returns at once (before any re-check wait)', [true, true], [quick, r.skipped === true]);
    const h = makeEnv(() => H());
    const r2p = h.ctx.autoRestartBlinkProxyIfStale();
    const quick2 = await settlesAtOnce(h, r2p);
    record('E5', 'healthy first look returns at once (no wait)', [true, false], [quick2, (await r2p).stale]);
    const st = makeEnv(s3);
    const sp2 = st.ctx.autoRestartBlinkProxyIfStale();
    const early = await settlesAtOnce(st, sp2);
    await st.advanceTo(60); await sp2;
    record('E5', 'a stale first look (no cooldown) does NOT return before the re-check', false, early);
  }

  // The overlay swallows every tap, so it must not appear for a blip and must not repeat.
  {
    const e = makeEnv(s1);
    await e.runPage(1, 60);
    record('O1', 'a blip that recovers on its own never shows the overlay', 0, e.overlayShown);
  }
  {
    const e = makeEnv(s3);
    await e.runPage(15, 120);
    record('O2', 'a stuck proxy shows the overlay only after the 12 s re-check (13.5 s), not at once',
      [true, true], [e.overlayAt[0] >= 13.5, e.overlayAt[0] < 20], `shownAt=${e.overlayAt.map(t => t.toFixed(1))}`);
    record('O2', 'and the result message is shown once the restart finishes', true,
      e.overlayMessages[e.overlayMessages.length - 1] === 'Reconnected.', `messages=${JSON.stringify(e.overlayMessages)}`);
  }
  {
    // A proxy that is stale for a few seconds out of every 30 and healthy by the re-check.
    const flapping = t => (t % 30) < 5 ? DOWN : H({ process_uptime_seconds: 5000 + t });
    const e = makeEnv(flapping);
    await e.runPage(15, 600);
    record('O3', 'a flapping proxy: no restart, no overlay, and POSTs paced by the retry pause',
      [0, 0, true], [e.restarts.length, e.overlayShown, e.posts <= 11], `posts=${e.posts} (60 s pause, 600 s run)`);
  }
  {
    // Cooldown already used: the page's request is answered at once, and the message must still appear.
    const e = makeEnv(s3);
    const warm = e.ctx.autoRestartBlinkProxyIfStale();
    await e.advanceTo(30); await warm;
    await e.advanceTo(40);
    e.ctx.checkAutoRestartProxy(s3(40));
    await e.advanceTo(60);
    record('O4', 'an immediate cooldown answer still shows its message', [1, true],
      [e.overlayShown, /already tried/.test(e.overlayMessages[0] || '')], `messages=${JSON.stringify(e.overlayMessages)}`);
  }

  // Client / server predicate parity over a grid of inputs.
  {
    const e = makeEnv(() => H());
    const states = [undefined, 'idle', 'authenticating', 'waiting_for_pin', 'success', 'expired', 'failure', 'foo'];
    const readies = [undefined, true, false];
    const uptimes = [undefined, null, -1, 0, 89, 90, 91, 100000];
    const tokens = [undefined, null, -1, 0, 1, 5000];
    const oks = [true, false];
    let n = 0, mismatches = 0;
    for (const ok of oks) for (const auth_state of states) for (const ready of readies)
      for (const process_uptime_seconds of uptimes) for (const token_seconds_remaining of tokens) {
        const s = { ok, auth_state, ready, process_uptime_seconds, token_seconds_remaining };
        n++;
        if (e.serverVerdict(s) !== e.clientVerdict(s)) mismatches++;
      }
    record('P', `client predicate == server predicate over ${n} inputs`, 0, mismatches);
  }

  // Report.
  const w = Math.max(...rows.map(r => r.id.length));
  const failures = rows.filter(r => !r.pass);
  for (const r of VERBOSE ? rows : failures) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(w)}  ${r.label}\n        expected=${JSON.stringify(r.expected)} actual=${JSON.stringify(r.actual)}${r.extra ? '  [' + r.extra + ']' : ''}`);
  }
  console.log(failures.length
    ? `Blink proxy auto-restart: ${failures.length} of ${rows.length} checks FAILED`
    : `Blink proxy auto-restart OK: ${rows.length} checks`);
  const failed = failures.length;
  finished = true;
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(2); });
