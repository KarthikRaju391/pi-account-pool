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

## Quick start: OpenAI ChatGPT/Codex subscriptions

Create 10 account profiles named `1`-`9` and `a`:

```bash
pi-pool setup openai-codex --accounts 1,2,3,4,5,6,7,8,9,a
```

Log into each profile once:

```bash
pi-pool login 1   # inside Pi, run /login and choose OpenAI / ChatGPT subscription
pi-pool login 2
# ...
pi-pool login a
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
pi-pool usage
pi-pool status
pi-pool which
```

Force an account:

```bash
pi-pool account 3 -c
```

Mark cooldown manually:

```bash
pi-pool cooldown 3 60
```

Inside Pi:

```txt
/pool-status
/pool-cooldown 60
```

## How sessions work

Each account has its own auth/config directory, e.g.:

```txt
~/.pi/accounts/openai-1
~/.pi/accounts/openai-2
```

All profiles share one session directory by default:

```txt
~/.pi/agent/sessions
```

Pi already organizes sessions by working directory/codebase, so project histories continue to be codebase-specific while being usable from any account profile.

## Config

Default config path:

```txt
~/.pi/account-pool.json
```

Override with:

```bash
PI_POOL_CONFIG=/path/to/config.json pi-pool status
```

Simplified OpenAI config shape:

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
      "accounts": [{ "id": "1", "enabled": true }],
      "usage": {
        "type": "http",
        "url": "https://chatgpt.com/backend-api/wham/usage",
        "headers": {
          "Authorization": "Bearer {{auth.access}}",
          "ChatGPT-Account-Id": "{{auth.accountId}}",
          "User-Agent": "codex-cli"
        },
        "paths": {
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
      "accounts": [{ "id": "1", "enabled": true }, { "id": "2", "enabled": true }],
      "usage": {
        "type": "http",
        "url": "https://example.com/usage",
        "headers": {
          "Authorization": "Bearer {{auth.access}}"
        },
        "paths": {
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

The script must print JSON. Use `paths` if your script returns nested provider-native JSON; or return fields matching the OpenAI-normalized concepts and set matching paths.

If a provider has no usage endpoint, set:

```json
"usage": { "type": "none" }
```

The extension will still record cooldowns from 429 responses and manual `/pool-cooldown` commands.

## OpenAI endpoint caveat

The OpenAI ChatGPT/Codex usage endpoint used by the built-in adapter is an internal ChatGPT endpoint (`/backend-api/wham/usage`) observed in OpenAI Codex and related tools. It is not a public stable API and may change.

## License

MIT

## Status states

`pi-pool status` uses these states:

- `ready` — provider usage says the account is usable.
- `low` — usable, but one window is above the warning threshold.
- `cooldown` — provider returned a reset window; the account will be retried after that reset.
- `limited` — provider says the account is not usable and did not provide a reset window, for example depleted workspace credits.
- `disabled` — manually disabled.
- `unknown` — no usage has been fetched yet.

Fresh usage checks override old heuristic cooldowns. For example, if an account was previously cooled down but the provider now reports `allowed: true`, `pi-pool usage`/normal launch clears the old cooldown.
