const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Always sandbox the smoke test, even when run directly on a developer machine.
// Do not use the caller's real HOME or ~/.pi/account-pool.json.
const HOME = process.env.PI_POOL_TEST_HOME || fs.mkdtempSync(path.join(os.tmpdir(), 'pi-account-pool-smoke-'));
const repo = process.cwd();
const logFile = path.join(HOME, 'fake-pi-log.jsonl');
const configFile = path.join(HOME, '.pi', 'account-pool.json');
const projectDir = path.join(HOME, 'workspace', 'project');
fs.mkdirSync(projectDir, { recursive: true });
fs.mkdirSync(path.join(HOME, '.pi', 'agent', 'sessions', '--tmp-placeholder--'), { recursive: true });

function run(args, opts = {}) {
  const res = spawnSync('pi-pool', args, {
    cwd: opts.cwd || projectDir,
    env: { ...process.env, HOME, PI_POOL_CONFIG: configFile, FAKE_PI_LOG: logFile },
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    console.error('COMMAND FAILED', ['pi-pool', ...args].join(' '));
    console.error('stdout:', res.stdout);
    console.error('stderr:', res.stderr);
  }
  assert.equal(res.status, 0);
  return res;
}
function logs() {
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
}
function writeAuth(provider, id) {
  const dir = path.join(HOME, '.pi', 'accounts', `${provider}-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({ [provider]: { access: `token-${id}` } }, null, 2));
}

// Fresh setup for a generic provider.
run(['setup', 'mock', '--accounts', 'one,two,exhausted', '--auth-key', 'mock']);
let cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
cfg.activeProvider = 'mock';
cfg.sharedSessionDir = path.join(HOME, '.pi', 'agent', 'sessions');
cfg.providers.mock.accountDirTemplate = path.join(HOME, '.pi', 'accounts', 'mock-{{id}}');
for (const acct of cfg.providers.mock.accounts) acct.dir = path.join(HOME, '.pi', 'accounts', `mock-${acct.id}`);
cfg.providers.mock.usage = {
  type: 'script',
  command: `node ${path.join(repo, 'test', 'mock-usage.js')} {{id}}`,
  paths: {
    allowed: 'limits.allowed',
    primaryUsedPercent: 'limits.short.used_percent',
    primaryResetAfterSeconds: 'limits.short.reset_after_seconds',
    secondaryUsedPercent: 'limits.weekly.used_percent',
    secondaryResetAfterSeconds: 'limits.weekly.reset_after_seconds',
    limitReached: 'limits.limit_reached',
    limitReachedType: 'limits.reason'
  }
};
fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2));
for (const id of ['one', 'two', 'exhausted']) writeAuth('mock', id);

// Management commands should not launch pi.
fs.rmSync(logFile, { force: true });
const usage = run(['--usage']);
assert.match(usage.stdout, /two\s+ready/);
assert.equal(logs().length, 0);

const which = run(['--which']);
assert.equal(which.stdout.trim(), 'two');
assert.equal(logs().length, 0);

const authStatus = run(['auth-status']);
assert.match(authStatus.stdout, /one\s+present/);
assert.match(authStatus.stdout, /two\s+present/);
assert.equal(logs().length, 0);

const doctor = run(['doctor']);
assert.match(doctor.stdout, /No obvious issues found/);
assert.equal(logs().length, 0);

run(['pin', 'one']);
const pinnedWhich = run(['--which']);
assert.equal(pinnedWhich.stdout.trim(), 'one');
run(['unpin']);
const autoWhich = run(['--which']);
assert.equal(autoWhich.stdout.trim(), 'two');

// Normal launch picks the best account and forwards args to pi.
run(['-c']);
const [launch] = logs();
assert.equal(launch.env.PI_POOL_ACCOUNT_ID, 'two');
assert.equal(launch.env.PI_POOL_PROVIDER, 'mock');
assert.deepEqual(launch.argv, ['-c']);
assert.equal(launch.env.PI_CODING_AGENT_DIR, path.join(HOME, '.pi', 'accounts', 'mock-two'));
const expectedSafePath = `--${launch.cwd.replace(/^[\/\\]/, '').replace(/[\/\\:]/g, '-')}--`;
assert.equal(launch.env.PI_CODING_AGENT_SESSION_DIR, path.join(HOME, '.pi', 'agent', 'sessions', expectedSafePath));

// Forced account still works.
fs.rmSync(logFile, { force: true });
run(['account', 'one', '-r']);
const [forced] = logs();
assert.equal(forced.env.PI_POOL_ACCOUNT_ID, 'one');
assert.deepEqual(forced.argv, ['-r']);

console.log('pi-account-pool smoke test passed');
