#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const configPath = path.resolve(process.env.CONFIG_PATH || process.argv[2] || 'config.json');
const fallbackPath = path.resolve(__dirname, '../examples/frameo-climate.json');
const chosen = fs.existsSync(configPath) ? configPath : fallbackPath;

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

function fail(message) {
  console.error(`Config invalid: ${message}`);
  process.exit(1);
}

let config;
try {
  config = JSON.parse(stripJsonComments(fs.readFileSync(chosen, 'utf8')));
} catch (error) {
  fail(`${chosen}: ${error.message}`);
}

if (!config.homeAssistant?.url && !process.env.HA_URL) {
  fail('homeAssistant.url is required unless HA_URL is set.');
}
if (!Array.isArray(config.panel?.rooms) || !config.panel.rooms.length) {
  fail('panel.rooms must contain at least one room.');
}
if (config.panel.rooms.length > 6) {
  fail('panel.rooms supports up to 6 room cards in this layout.');
}

for (const [index, room] of config.panel.rooms.entries()) {
  if (!room.label) fail(`panel.rooms[${index}].label is required.`);
  if (!room.temp) fail(`panel.rooms[${index}].temp is required.`);
}

if (config.cameras && !Array.isArray(config.cameras)) {
  fail('cameras must be an array.');
}

console.log(`Config OK: ${chosen}`);
