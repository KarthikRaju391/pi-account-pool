#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const out = process.env.FAKE_PI_LOG || path.join(process.env.HOME || '/tmp', 'fake-pi-log.jsonl');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.appendFileSync(out, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: {
    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
    PI_CODING_AGENT_SESSION_DIR: process.env.PI_CODING_AGENT_SESSION_DIR,
    PI_POOL_PROVIDER: process.env.PI_POOL_PROVIDER,
    PI_POOL_ACCOUNT_ID: process.env.PI_POOL_ACCOUNT_ID,
    PI_POOL_CONFIG: process.env.PI_POOL_CONFIG,
  }
}) + '\n');
console.log('[fake-pi] launched');
