#!/usr/bin/env node
// The repo root is the single source for the panel. The HAOS add-on needs its
// own copies because the Supervisor builds add-ons with the add-on directory as
// the Docker build context, and COPY cannot reach outside that context — so
// everything under addon/ listed here is a build artifact, never hand-edited.
//
//   npm run sync-addon              regenerate them
//   npm run sync-addon -- --check   fail if any is stale (CI uses this)

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');

const FILES = [
  ['server.js', 'addon/server.js'],
  ['examples/frameo-climate.json', 'addon/examples/frameo-climate.json'],
  ['examples/starter.json', 'addon/examples/starter.json']
];

let stale = 0;
let written = 0;

for (const [from, to] of FILES) {
  const source = fs.readFileSync(path.join(ROOT, from));
  const targetPath = path.join(ROOT, to);
  const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath) : null;

  if (current && source.equals(current)) continue;

  if (CHECK) {
    console.error(`${to} is stale against ${from}`);
    stale += 1;
    continue;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, source);
  console.log(`Wrote ${to} from ${from} (${source.length} bytes)`);
  written += 1;
}

if (stale) {
  console.error('Regenerate with: npm run sync-addon');
  process.exit(1);
}
if (CHECK) console.log(`addon/ is in sync (${FILES.length} files)`);
else if (!written) console.log(`addon/ was already in sync (${FILES.length} files)`);
