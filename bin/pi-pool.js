#!/usr/bin/env node
/* pi-account-pool launcher. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');

const home = os.homedir();
const legacyConfigFile = path.join(home, '.pi', 'account-pool.json');
const configFile = process.env.PI_POOL_CONFIG || legacyConfigFile;
const defaultAccountsRoot = path.join(home, '.pi', 'accounts');
const defaultSharedSessionDir = path.join(home, '.pi', 'agent', 'sessions');
const defaultIds = ['1','2','3','4','5','6','7','8','9','a'];
const openAiClientId = 'app_EMoamEEZ73f0CkXaXp7hrann';
const lowUsageWarningPercent = 95;

function now() { return Date.now(); }
function mkdirp(p) { fs.mkdirSync(p, { recursive: true, mode: 0o700 }); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, data) { mkdirp(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); }
function expandHome(s) { return typeof s === 'string' && s.startsWith('~/') ? path.join(home, s.slice(2)) : s; }
function iso(ms) { return ms ? new Date(ms).toISOString() : '-'; }
function relSeconds(s) {
  if (!Number.isFinite(s)) return '-';
  if (s <= 0) return 'now';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d${h}h`;
  if (h) return `${h}h${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}
function getPath(obj, dotted) {
  if (!dotted) return undefined;
  return dotted.split('.').reduce((acc, key) => acc == null ? undefined : acc[key], obj);
}
function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (const p of parts.slice(0, -1)) cur = cur[p] ||= {};
  cur[parts.at(-1)] = value;
}
function renderTemplate(value, vars) {
  if (typeof value !== 'string') return value;
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
    const v = getPath(vars, expr.trim());
    return v == null ? '' : String(v);
  });
}
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) out._.push(a);
    else if (a === '--accounts' || a === '--provider' || a === '--account' || a === '--config' || a === '--usage-url' || a === '--auth-key') out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

function defaultOpenAiProvider(ids = defaultIds) {
  return {
    type: 'openai-codex',
    authKey: 'openai-codex',
    accountDirTemplate: path.join(defaultAccountsRoot, 'openai-{{id}}'),
    accounts: ids.map((id) => ({ id, enabled: true, cooldownUntil: null, lastUsedAt: null })),
    usage: {
      type: 'http',
      url: 'https://chatgpt.com/backend-api/wham/usage',
      method: 'GET',
      headers: {
        Authorization: 'Bearer {{auth.access}}',
        'ChatGPT-Account-Id': '{{auth.accountId}}',
        'User-Agent': 'codex-cli',
        Accept: 'application/json'
      },
      paths: {
        primaryUsedPercent: 'rate_limit.primary_window.used_percent',
        primaryResetAfterSeconds: 'rate_limit.primary_window.reset_after_seconds',
        secondaryUsedPercent: 'rate_limit.secondary_window.used_percent',
        secondaryResetAfterSeconds: 'rate_limit.secondary_window.reset_after_seconds',
        allowed: 'rate_limit.allowed',
        limitReached: 'rate_limit.limit_reached',
        limitReachedType: 'rate_limit_reached_type.type',
        creditsOverageReached: 'credits.overage_limit_reached',
        spendControlReached: 'spend_control.reached'
      }
    }
  };
}
function defaultConfig() {
  return {
    version: 1,
    activeProvider: 'openai-codex',
    sharedSessionDir: defaultSharedSessionDir,
    strategy: 'most-usage-remaining',
    defaultCooldownMinutes: 180,
    usageStaleSeconds: 120,
    providers: { 'openai-codex': defaultOpenAiProvider() }
  };
}
function normalizeLegacy(cfg) {
  if (cfg.providers) return cfg;
  // Backward compatibility with the first local prototype shape.
  return {
    version: 1,
    activeProvider: 'openai-codex',
    sharedSessionDir: cfg.sharedSessionDir || defaultSharedSessionDir,
    strategy: cfg.strategy || 'most-usage-remaining',
    defaultCooldownMinutes: cfg.defaultCooldownMinutes || 180,
    usageStaleSeconds: cfg.usageStaleSeconds || 120,
    providers: {
      'openai-codex': {
        ...defaultOpenAiProvider((cfg.accounts || []).map((a) => a.id)),
        accounts: cfg.accounts || defaultOpenAiProvider().accounts
      }
    }
  };
}
function load() {
  const cfg = fs.existsSync(configFile) ? normalizeLegacy(readJson(configFile)) : defaultConfig();
  cfg.sharedSessionDir = expandHome(cfg.sharedSessionDir || defaultSharedSessionDir);
  cfg.activeProvider ||= Object.keys(cfg.providers)[0];
  cfg.strategy ||= 'most-usage-remaining';
  cfg.defaultCooldownMinutes ||= 180;
  cfg.usageStaleSeconds ||= 120;
  ensureDirs(cfg);
  save(cfg);
  return cfg;
}
function save(cfg) { writeJson(configFile, cfg); }
function provider(cfg, name = cfg.activeProvider) {
  const p = cfg.providers?.[name];
  if (!p) throw new Error(`Unknown provider '${name}'. Known: ${Object.keys(cfg.providers || {}).join(', ')}`);
  return p;
}
function accountDir(p, acct) { return expandHome(acct.dir || renderTemplate(p.accountDirTemplate || path.join(defaultAccountsRoot, `${p.type || 'account'}-{{id}}`), { account: acct, id: acct.id })); }
function authPath(p, acct) { return path.join(accountDir(p, acct), 'auth.json'); }
function ensureSymlinkIfExists(src, dst) { if (!fs.existsSync(src) || fs.existsSync(dst)) return; try { fs.symlinkSync(src, dst); } catch {} }
function ensureDirs(cfg) {
  mkdirp(cfg.sharedSessionDir);
  const baseAgent = path.join(home, '.pi', 'agent');
  for (const p of Object.values(cfg.providers || {})) {
    for (const acct of p.accounts || []) {
      const dir = accountDir(p, acct);
      acct.dir = dir;
      migrateStoredUsage(p, acct);
      if (acct.cooldownUntil && acct.cooldownUntil <= now()) acct.cooldownUntil = null;
      mkdirp(dir);
      for (const name of ['settings.json', 'AGENTS.md', 'APPEND_SYSTEM.md', 'SYSTEM.md', 'models.json']) ensureSymlinkIfExists(path.join(baseAgent, name), path.join(dir, name));
      for (const name of ['extensions', 'skills', 'prompts', 'themes']) ensureSymlinkIfExists(path.join(baseAgent, name), path.join(dir, name));
    }
  }
}
function readAuth(p, acct) { try { return readJson(authPath(p, acct))[p.authKey || p.type]; } catch { return null; } }

async function refreshOpenAiAuth(p, acct, auth) {
  if (!auth?.refresh) return auth;
  if (auth.expires && auth.expires > now() + 5 * 60_000 && auth.access) return auth;
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refresh, client_id: openAiClientId });
  const res = await fetch('https://auth.openai.com/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new Error(`refresh failed ${res.status}`);
  const data = await res.json();
  const next = { ...auth, access: data.access_token || auth.access, refresh: data.refresh_token || auth.refresh, expires: data.expires_in ? now() + Number(data.expires_in) * 1000 : auth.expires };
  const full = fs.existsSync(authPath(p, acct)) ? readJson(authPath(p, acct)) : {};
  full[p.authKey || p.type] = next;
  writeJson(authPath(p, acct), full);
  return next;
}
async function maybeRefreshAuth(p, acct, auth) {
  if (p.type === 'openai-codex' || p.refresh?.type === 'openai-oauth') return refreshOpenAiAuth(p, acct, auth);
  return auth;
}
function normalizeUsage(payload, p, acct) {
  const paths = p.usage?.paths || {};
  const u = {
    raw: payload,
    fetchedAt: now(),
    primaryUsedPercent: Number(getPath(payload, paths.primaryUsedPercent)),
    primaryResetAfterSeconds: Number(getPath(payload, paths.primaryResetAfterSeconds)),
    secondaryUsedPercent: Number(getPath(payload, paths.secondaryUsedPercent)),
    secondaryResetAfterSeconds: Number(getPath(payload, paths.secondaryResetAfterSeconds)),
    allowed: getPath(payload, paths.allowed),
    limitReached: Boolean(getPath(payload, paths.limitReached)),
    limitReachedType: getPath(payload, paths.limitReachedType),
    error: null
  };
  if (getPath(payload, paths.creditsOverageReached) || getPath(payload, paths.spendControlReached)) u.limitReached = true;
  if (!getPath(payload, paths.limitReached) && u.limitReachedType && u.limitReachedType !== 'none') u.limitReached = true;
  acct.usage = u;
  acct.usageFetchedAt = u.fetchedAt;
  acct.usageError = null;
  return u;
}
function migrateStoredUsage(p, acct) {
  if (!acct.usage || acct.usage.raw || Object.prototype.hasOwnProperty.call(acct.usage, 'primaryUsedPercent')) return;
  // Migrate the original prototype config, which stored provider-native usage JSON directly.
  if (acct.usage.rate_limit || acct.usage.rateLimit || acct.usage.credits || acct.usage.spend_control || acct.usage.rate_limit_reached_type) {
    const fetchedAt = acct.usageFetchedAt || now();
    normalizeUsage(acct.usage, p, acct);
    acct.usageFetchedAt = fetchedAt;
    acct.usage.fetchedAt = fetchedAt;
  }
}
async function fetchHttpUsage(p, acct, auth) {
  const usage = p.usage;
  const vars = { auth, account: acct, provider: p, id: acct.id };
  const headers = {};
  for (const [k, v] of Object.entries(usage.headers || {})) headers[k] = renderTemplate(v, vars);
  const res = await fetch(renderTemplate(usage.url, vars), { method: usage.method || 'GET', headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`usage ${res.status}: ${text.slice(0, 180)}`);
  return JSON.parse(text);
}
async function fetchScriptUsage(p, acct, auth) {
  const cmd = renderTemplate(p.usage.command, { auth, account: acct, provider: p, id: acct.id });
  const out = execFileSync('/bin/sh', ['-lc', cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out);
}
function usageIsStale(cfg, acct) { return !acct.usageFetchedAt || now() - acct.usageFetchedAt > (cfg.usageStaleSeconds || 120) * 1000; }
async function refreshUsageForAccount(cfg, p, acct, force = false) {
  if (!force && !usageIsStale(cfg, acct)) return;
  const auth0 = readAuth(p, acct);
  if (!auth0) { acct.usageError = `missing auth; run pi-pool login ${acct.id}`; acct.usageFetchedAt = now(); return; }
  try {
    const auth = await maybeRefreshAuth(p, acct, auth0);
    let payload;
    if (!p.usage || p.usage.type === 'none') return;
    if (p.usage.type === 'script') payload = await fetchScriptUsage(p, acct, auth);
    else payload = await fetchHttpUsage(p, acct, auth);
    const u = normalizeUsage(payload, p, acct);
    if (isLimitReached(acct)) {
      const resets = [u.primaryResetAfterSeconds, u.secondaryResetAfterSeconds].filter((v) => Number.isFinite(v) && v > 0);
      if (resets.length) {
        const reset = Math.max(60, Math.min(...resets));
        acct.cooldownUntil = now() + reset * 1000;
      } else {
        // No reset window means this is a hard provider/account state (for example credits depleted), not a timed cooldown.
        acct.cooldownUntil = null;
      }
      acct.lastRateLimitAt = now();
      acct.lastRateLimitReason = 'usage endpoint limit reached';
    } else {
      // A fresh usage check says the provider allows this account, so clear any older heuristic/manual cooldown.
      acct.cooldownUntil = null;
    }
  } catch (e) {
    acct.usageError = e.message || String(e);
    acct.usageFetchedAt = now();
  }
}
async function refreshUsage(cfg, p, ids = null, opts = {}) {
  for (const acct of p.accounts.filter((a) => !ids || ids.includes(String(a.id)))) {
    if (!opts.quiet) process.stderr.write(`[pi-pool] usage ${p.type || cfg.activeProvider}/${acct.id}... `);
    await refreshUsageForAccount(cfg, p, acct, opts.force);
    if (!opts.quiet) process.stderr.write(`${usageSummary(acct)}\n`);
  }
  save(cfg);
}
function cooldownActive(acct) { return Boolean(acct.cooldownUntil && acct.cooldownUntil > now()); }
function isLimitReached(acct) {
  const u = acct.usage;
  if (!u) return false;
  return Boolean(u.limitReached) || u.allowed === false;
}
function isLowUsage(acct) {
  const u = acct.usage;
  if (!u || isLimitReached(acct)) return false;
  return (Number.isFinite(u.primaryUsedPercent) && u.primaryUsedPercent >= lowUsageWarningPercent) || (Number.isFinite(u.secondaryUsedPercent) && u.secondaryUsedPercent >= lowUsageWarningPercent);
}
function eligible(acct) { return acct.enabled !== false && !cooldownActive(acct) && !isLimitReached(acct); }
function score(acct) {
  const u = acct.usage || {};
  const p = Number.isFinite(u.primaryUsedPercent) ? 100 - u.primaryUsedPercent : 50;
  const s = Number.isFinite(u.secondaryUsedPercent) ? 100 - u.secondaryUsedPercent : 50;
  return p * 2 + s;
}
function choose(p) {
  const choices = p.accounts.filter(eligible);
  choices.sort((a, b) => score(b) - score(a) || (a.lastUsedAt || 0) - (b.lastUsedAt || 0) || String(a.id).localeCompare(String(b.id)));
  return choices[0] || null;
}
function usageSummary(acct) {
  if (acct.usageError) return `usage error: ${acct.usageError}`;
  const u = acct.usage;
  if (!u) return fs.existsSync(path.join(acct.dir || '', 'auth.json')) ? 'usage unknown' : 'not logged in';
  if (u.limitReachedType && !Number.isFinite(u.primaryUsedPercent) && !Number.isFinite(u.secondaryUsedPercent)) return `limit: ${u.limitReachedType}`;
  const parts = [];
  if (Number.isFinite(u.primaryUsedPercent)) parts.push(`primary ${Math.round(u.primaryUsedPercent)}% used, resets in ${relSeconds(u.primaryResetAfterSeconds)}`);
  if (Number.isFinite(u.secondaryUsedPercent)) parts.push(`weekly ${Math.round(u.secondaryUsedPercent)}% used, resets in ${relSeconds(u.secondaryResetAfterSeconds)}`);
  return parts.join('; ') || 'usage unknown';
}
function accountState(a) {
  if (a.enabled === false) return 'disabled';
  if (cooldownActive(a)) return 'cooldown';
  if (isLimitReached(a)) return 'limited';
  if (isLowUsage(a)) return 'low';
  if (!a.usage && !a.usageError) return 'unknown';
  return 'ready';
}
function stateNote(a) {
  if (cooldownActive(a)) return `available in ${relSeconds((a.cooldownUntil - now()) / 1000)}`;
  if (isLimitReached(a)) return a.usage?.limitReachedType || 'provider says limit reached';
  if (isLowUsage(a)) return 'usable, but close to limit';
  return a.usageError || '';
}
function printStatus(cfg, p) {
  console.log(`Config:   ${configFile}`);
  console.log(`Provider: ${cfg.activeProvider}`);
  console.log(`Sessions: ${cfg.sharedSessionDir}`);
  console.log(`Strategy: ${cfg.strategy}`);
  console.log('');
  console.log('Acct  State     Primary window                 Weekly/secondary              Note');
  console.log('----  --------  -----------------------------  ----------------------------  ------------------------------');
  for (const a of p.accounts) {
    if (a.cooldownUntil && a.cooldownUntil <= now()) a.cooldownUntil = null;
    const u = a.usage || {};
    const primary = Number.isFinite(u.primaryUsedPercent) ? `${Math.round(u.primaryUsedPercent)}% used, reset ${relSeconds(u.primaryResetAfterSeconds)}` : '-';
    const secondary = Number.isFinite(u.secondaryUsedPercent) ? `${Math.round(u.secondaryUsedPercent)}% used, reset ${relSeconds(u.secondaryResetAfterSeconds)}` : '-';
    console.log(`${String(a.id).padEnd(4)}  ${accountState(a).padEnd(8)}  ${primary.padEnd(29)}  ${secondary.padEnd(28)}  ${stateNote(a)}`);
  }
  save(cfg);
}
function findAcct(p, id) { const a = p.accounts.find((x) => String(x.id) === String(id)); if (!a) throw new Error(`Unknown account '${id}'`); return a; }
function launchPi(cfg, p, acct, piArgs) {
  acct.lastUsedAt = now(); save(cfg);
  let cwd = process.cwd(); try { cwd = fs.realpathSync(cwd); } catch {}
  console.error(`[pi-pool] provider=${cfg.activeProvider} account=${acct.id} ${usageSummary(acct)}`);
  console.error(`[pi-pool] dir=${accountDir(p, acct)}`);
  console.error(`[pi-pool] shared sessions=${cfg.sharedSessionDir}`);
  const env = { ...process.env, PI_CODING_AGENT_DIR: accountDir(p, acct), PI_CODING_AGENT_SESSION_DIR: cfg.sharedSessionDir, PI_POOL_PROVIDER: cfg.activeProvider, PI_POOL_ACCOUNT_ID: String(acct.id), PI_POOL_CONFIG: configFile };
  const result = spawnSync('pi', piArgs, { stdio: 'inherit', env, cwd });
  if (result.error) { console.error(`[pi-pool] failed to launch pi: ${result.error.message}`); process.exit(127); }
  process.exit(result.status ?? 0);
}
function setupCommand(args) {
  const parsed = parseArgs(args);
  const providerName = parsed._[0] || parsed.provider || 'openai-codex';
  const ids = (parsed.accounts ? parsed.accounts.split(',') : defaultIds).map((s) => s.trim()).filter(Boolean);
  const cfg = fs.existsSync(configFile) ? load() : defaultConfig();
  cfg.activeProvider = providerName;
  if (providerName === 'openai-codex') cfg.providers[providerName] = defaultOpenAiProvider(ids);
  else {
    cfg.providers[providerName] = {
      type: providerName,
      authKey: parsed['auth-key'] || providerName,
      accountDirTemplate: path.join(defaultAccountsRoot, `${providerName}-{{id}}`),
      accounts: ids.map((id) => ({ id, enabled: true, cooldownUntil: null, lastUsedAt: null })),
      usage: parsed['usage-url'] ? { type: 'http', url: parsed['usage-url'], headers: { Authorization: 'Bearer {{auth.access}}' }, paths: {} } : { type: 'none' }
    };
  }
  ensureDirs(cfg); save(cfg); console.log(`Configured ${providerName} in ${configFile}`);
}
function help() { console.log(`pi-account-pool

Usage:
  pi-pool setup [openai-codex|provider] --accounts 1,2,3,a
  pi-pool login <id>
  pi-pool usage [id]
  pi-pool status
  pi-pool which
  pi-pool account <id> [pi args...]
  pi-pool cooldown <id> [minutes]
  pi-pool enable <id> | disable <id> | clear-cooldown <id>
  pi-pool [pi args...]

Examples:
  pi-pool setup openai-codex --accounts 1,2,3,4,5,6,7,8,9,a
  pi-pool login 1     # then run /login inside pi
  pi-pool usage
  pi-pool -c
`); }
async function main() {
  const raw = process.argv.slice(2);
  const cmd = raw[0];
  if (!cmd) {
    const cfg = load(), p = provider(cfg);
    await refreshUsage(cfg, p, null, { quiet: false });
    const acct = choose(p);
    if (!acct) { printStatus(cfg, p); console.error('\nNo ready accounts.'); process.exit(2); }
    return launchPi(cfg, p, acct, raw);
  }
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') return help();
  if (cmd === 'setup' || cmd === '--setup') return setupCommand(raw.slice(1));
  const cfg = load(), p = provider(cfg);
  if (cmd === 'status' || cmd === '--status') return printStatus(cfg, p);
  if (cmd === 'usage' || cmd === '--usage') { const id = raw[1]; if (id) findAcct(p, id); await refreshUsage(cfg, p, id ? [id] : null, { force: true }); return printStatus(cfg, p); }
  if (cmd === 'which' || cmd === '--which') { await refreshUsage(cfg, p, null, { quiet: true }); const acct = choose(p); if (!acct) process.exit(2); console.log(acct.id); return; }
  if (cmd === 'login' || cmd === '--login') return launchPi(cfg, p, findAcct(p, raw[1]), []);
  if (cmd === 'account' || cmd === '--account') { const acct = findAcct(p, raw[1]); await refreshUsage(cfg, p, [String(acct.id)], { quiet: true }); return launchPi(cfg, p, acct, raw.slice(2)); }
  if (['enable','disable','clear-cooldown'].includes(cmd) || ['--enable','--disable','--clear-cooldown'].includes(cmd)) {
    const c = cmd.replace(/^--/, ''); const acct = findAcct(p, raw[1]);
    if (c === 'enable') acct.enabled = true; if (c === 'disable') acct.enabled = false; if (c === 'clear-cooldown') acct.cooldownUntil = null;
    save(cfg); return printStatus(cfg, p);
  }
  if (cmd === 'cooldown' || cmd === '--cooldown') { const acct = findAcct(p, raw[1]); const minutes = Number(raw[2] || cfg.defaultCooldownMinutes); acct.cooldownUntil = now() + minutes * 60_000; save(cfg); return printStatus(cfg, p); }
  // Unknown command: pass through to pi.
  await refreshUsage(cfg, p, null, { quiet: false });
  const acct = choose(p);
  if (!acct) { printStatus(cfg, p); process.exit(2); }
  return launchPi(cfg, p, acct, raw);
}
main().catch((e) => { console.error(`[pi-pool] ${e.message || e}`); process.exit(1); });
