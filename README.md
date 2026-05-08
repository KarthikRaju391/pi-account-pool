# pi-account-pool

Account-profile pooling for the [pi coding agent](https://pi.dev).

`pi-account-pool` lets you keep multiple subscription logins in separate Pi auth profiles, share the same project/session history across them, automatically choose an account with available usage, and show quota/cooldown state in Pi's status bar.

It is designed for accounts you are allowed to use. Do not use this to bypass provider terms, seat licensing, or anti-abuse limits.

## What it includes

- `pi-pool` launcher CLI
  - selects an account profile before Pi starts
  - sets `PI_CODING_AGENT_DIR` to the selected account profile
  - sets `PI_CODING_AGENT_SESSION_DIR` to a shared session directory
  - polls usage endpoints when configured
- Pi extension
  - status bar usage summary
  - `/pool-status`
  - `/pool-cooldown [minutes]`
  - automatic cooldown recording on HTTP `429` / rate-limit messages

A launcher is required because Pi's auth/config directory must be chosen before Pi starts. A Pi extension alone cannot switch account profiles reliably.

## Install from GitHub

```bash
npm install -g github:KarthikRaju391/pi-account-pool
pi install git:github.com/KarthikRaju391/pi-account-pool
```

The first command installs the `pi-pool` CLI. The second installs the Pi extension.

For local development:

```bash
git clone https://github.com/KarthikRaju391/pi-account-pool.git
cd pi-account-pool
npm link
pi install .
```

## Sandboxed smoke test

The repo includes a Docker smoke test that simulates a fresh machine, installs the package globally, replaces `pi` with a fake recorder binary, configures a mock provider, verifies usage-based account selection, and checks that Pi receives the expected account/session environment.

```bash
npm run test:docker
```

There is also a real-Pi package-loading test. It installs the actual Pi CLI in Docker, installs this package into Pi, verifies `pi list`, and verifies Pi accepts the extension path:

```bash
npm run test:real-pi
```

The tests do not use real provider credentials or your local Pi config.

## Quick start

Create a pool for a provider and choose the account labels you want to use:

```bash
pi-pool setup openai-codex --accounts work,personal,backup
```

Each label gets its own Pi auth/config profile under `~/.pi/accounts/`. Log into each profile once:

```bash
pi-pool login work      # inside Pi, run /login and authenticate the matching account
pi-pool login personal
pi-pool login backup
```

Then use Pi through the launcher:

```bash
pi-pool
pi-pool -c
pi-pool -r
pi-pool "fix the failing tests"
```

Check usage and selection:

```bash
pi-pool usage       # or: pi-pool --usage
pi-pool status      # or: pi-pool --status
pi-pool auth-status
pi-pool doctor
pi-pool which       # or: pi-pool --which
```

Force a specific account:

```bash
pi-pool account work -c
```

Mark cooldown manually:

```bash
pi-pool cooldown work 60
```

Inside Pi:

```txt
/pool-status
/pool-cooldown 60
```

## How sessions work

Each account has its own auth/config directory, for example:

```txt
~/.pi/accounts/openai-work
~/.pi/accounts/openai-personal
```

All profiles share one session root by default:

```txt
~/.pi/agent/sessions
```

For each launch, `pi-pool` passes Pi the current codebase's project-specific session directory under that root, for example:

```txt
~/.pi/agent/sessions/--Users-you-code-project--
```

Pi already organizes sessions by working directory/codebase, so project histories continue to be codebase-specific while being usable from any account profile.

`pi-pool` preserves the exact directory path you launch it from. This matters if you sometimes enter a repo through a symlink or alternate path: Pi treats `/real/path/repo` and `/symlink/path/repo` as different session locations. To resume an existing session, launch `pi-pool -c` from the same path string you used with normal `pi`.

## Config

Default config path:

```txt
~/.pi/account-pool.json
```

Override with:

```bash
PI_POOL_CONFIG=/path/to/config.json pi-pool status
```

Simplified OpenAI/Codex config shape:

```json
{
  "version": 1,
  "activeProvider": "openai-codex",
  "sharedSessionDir": "~/.pi/agent/sessions",
  "strategy": "most-usage-remaining",
  "defaultCooldownMinutes": 180,
  "usageStaleSeconds": 120,
  "providers": {
    "openai-codex": {
      "type": "openai-codex",
      "authKey": "openai-codex",
      "accountDirTemplate": "~/.pi/accounts/openai-{{id}}",
      "accounts": [
        { "id": "work", "enabled": true },
        { "id": "personal", "enabled": true }
      ],
      "usage": {
        "type": "http",
        "url": "https://chatgpt.com/backend-api/wham/usage",
        "headers": {
          "Authorization": "Bearer {{auth.access}}",
          "ChatGPT-Account-Id": "{{auth.accountId}}",
          "User-Agent": "codex-cli"
        },
        "paths": {
          "allowed": "rate_limit.allowed",
          "primaryUsedPercent": "rate_limit.primary_window.used_percent",
          "primaryResetAfterSeconds": "rate_limit.primary_window.reset_after_seconds",
          "secondaryUsedPercent": "rate_limit.secondary_window.used_percent",
          "secondaryResetAfterSeconds": "rate_limit.secondary_window.reset_after_seconds",
          "limitReached": "rate_limit.limit_reached"
        }
      }
    }
  }
}
```

## Generic provider support

For Claude, Copilot, or any other subscription provider, the account pooling flow is the same:

1. create profile directories
2. log into each profile once with Pi's `/login`
3. configure a usage source, if one exists
4. launch with `pi-pool`

Usage can be configured as generic HTTP:

```json
{
  "providers": {
    "my-provider": {
      "type": "my-provider",
      "authKey": "my-provider-auth-key-in-auth-json",
      "accountDirTemplate": "~/.pi/accounts/my-provider-{{id}}",
      "accounts": [
        { "id": "primary", "enabled": true },
        { "id": "secondary", "enabled": true }
      ],
      "usage": {
        "type": "http",
        "url": "https://example.com/usage",
        "headers": {
          "Authorization": "Bearer {{auth.access}}"
        },
        "paths": {
          "allowed": "limits.allowed",
          "primaryUsedPercent": "limits.short.used_percent",
          "primaryResetAfterSeconds": "limits.short.reset_after_seconds",
          "secondaryUsedPercent": "limits.weekly.used_percent",
          "secondaryResetAfterSeconds": "limits.weekly.reset_after_seconds",
          "limitReached": "limits.limit_reached"
        }
      }
    }
  }
}
```

Or as a script:

```json
{
  "usage": {
    "type": "script",
    "command": "my-usage-checker --auth-dir {{account.dir}}"
  }
}
```

The script must print JSON. Use `paths` if your script returns nested provider-native JSON; or return fields matching the normalized concepts and set matching paths.

If a provider has no usage endpoint, set:

```json
"usage": { "type": "none" }
```

The extension will still record cooldowns from 429 responses and manual `/pool-cooldown` commands. Example provider configs live in `examples/providers/`.

## Status states

`pi-pool status` uses these states:

- `ready` — provider usage says the account is usable.
- `low` — usable, but one window is above the warning threshold.
- `cooldown` — provider returned a reset window; the account will be retried after that reset.
- `limited` — provider says the account is not usable and did not provide a reset window, for example depleted workspace credits.
- `disabled` — manually disabled.
- `unknown` — no usage has been fetched yet.

Fresh usage checks override old heuristic cooldowns. `setup` writes a timestamped backup next to the config file before changing an existing config. Config writes are atomic and protected by a short-lived lock to avoid common concurrent-launch races.

## Troubleshooting

Use:

```bash
pi-pool doctor
pi-pool auth-status
```

`doctor` checks the active provider, configured accounts, missing auth files, and the project session directory for the current cwd. `auth-status` lists each account's `auth.json` path and whether auth is present.

Fresh usage checks override old heuristic cooldowns. For example, if an account was previously cooled down but the provider now reports `allowed: true`, `pi-pool usage` or normal launch clears the old cooldown.

## OpenAI endpoint caveat

The OpenAI ChatGPT/Codex usage endpoint used by the built-in adapter is an internal ChatGPT endpoint (`/backend-api/wham/usage`) observed in OpenAI Codex and related tools. It is not a public stable API and may change.

## License

MIT
