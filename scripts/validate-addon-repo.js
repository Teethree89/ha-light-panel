#!/usr/bin/env node
// Guards the structure Home Assistant Supervisor requires when someone adds
// this repo under Settings -> Add-ons -> Add-on Store -> Repositories.
//
// Without repository.yaml at the root, Supervisor rejects the URL outright with
// "<url> is not a valid add-on repository" (issue #1). Everything checked here
// is a hard requirement for that flow, so CI fails if any of it goes missing.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const problems = [];

function fail(message) {
  problems.push(message);
}

// Deliberately not a general YAML parser: these files are flat key/value maps,
// and a regex keeps the project free of runtime dependencies.
function topLevelKey(text, key) {
  const match = text.match(new RegExp(`^${key}\\s*:\\s*(.*)$`, 'm'));
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, '');
}

function hasKey(text, key) {
  return new RegExp(`^${key}\\s*:`, 'm').test(text);
}

// 1. The repository manifest itself.
const repoFileYaml = path.join(root, 'repository.yaml');
const repoFileJson = path.join(root, 'repository.json');
const repoFile = fs.existsSync(repoFileYaml)
  ? repoFileYaml
  : fs.existsSync(repoFileJson) ? repoFileJson : null;

if (!repoFile) {
  fail('Missing repository.yaml (or repository.json) at the repo root. Supervisor needs it to accept this URL as an add-on repository.');
} else {
  const text = fs.readFileSync(repoFile, 'utf8');
  const name = repoFile.endsWith('.json')
    ? JSON.parse(text).name
    : topLevelKey(text, 'name');
  if (!name) fail(`${path.basename(repoFile)}: a non-empty "name" is required.`);
}

// 2. At least one add-on directory with a usable config.
const addonDirs = fs.readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
  .map(entry => path.join(root, entry.name))
  .filter(dir => fs.existsSync(path.join(dir, 'config.yaml')) || fs.existsSync(path.join(dir, 'config.json')));

if (!addonDirs.length) {
  fail('No add-on directory found. Each add-on needs its own subdirectory containing config.yaml.');
}

const REQUIRED_ADDON_KEYS = ['name', 'version', 'slug', 'description', 'arch'];

for (const dir of addonDirs) {
  const label = path.relative(root, dir);
  const configPath = fs.existsSync(path.join(dir, 'config.yaml'))
    ? path.join(dir, 'config.yaml')
    : path.join(dir, 'config.json');
  const text = fs.readFileSync(configPath, 'utf8');
  const isJson = configPath.endsWith('.json');
  const parsed = isJson ? JSON.parse(text) : null;

  for (const key of REQUIRED_ADDON_KEYS) {
    const present = isJson ? parsed[key] !== undefined : hasKey(text, key);
    if (!present) fail(`${label}/${path.basename(configPath)}: missing required key "${key}".`);
  }

  // A local-build add-on (no `image:`) must ship a Dockerfile Supervisor can build.
  const hasImage = isJson ? parsed.image !== undefined : hasKey(text, 'image');
  if (!hasImage && !fs.existsSync(path.join(dir, 'Dockerfile'))) {
    fail(`${label}: no "image" key and no Dockerfile, so Supervisor has nothing to build or pull.`);
  }
}

if (problems.length) {
  console.error('Add-on repository is invalid:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`Add-on repository OK: ${addonDirs.length} add-on(s), manifest ${path.basename(repoFile)}`);
