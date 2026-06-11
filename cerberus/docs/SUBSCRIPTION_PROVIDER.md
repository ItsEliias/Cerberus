# Claude (Subscription) Provider

## Overview

This provider lets you use your Claude Max / Pro subscription account from
within Cerberus by running the Claude Code CLI as a local subprocess.  It is
an additive, self-contained spike — it does not replace or touch any existing
provider.

**Interactive use only.** Do NOT configure this as the swarm/automation
model — subscription rate limits are per-human-account and are not designed
for parallel agent workloads.

## How It Works

| Layer | Mechanism |
|-------|-----------|
| Auth | Claude Code CLI OAuth (user runs `claude` login once) |
| Transport | Local subprocess — NOT HTTP |
| Completions | `claude -p --tools "" --output-format json --no-session-persistence` |
| Streaming | `claude -p --tools "" --output-format stream-json --verbose --include-partial-messages --no-session-persistence` |

### Provider Interface Contract

Cerberus identifies providers by a sentinel base URL stored in
`ModelEndpoint.base_url`.  The sentinel for this provider is:

```
claude-subscription://local
```

`_detect_provider()` in `src/llm_core.py` returns `"claude-subscription"` for
this URL.  The streaming and sync completion paths in `stream_llm` and
`llm_call_async` branch on this string to use the subprocess adapter instead
of HTTP.

### Subprocess Adapter

**File:** `src/claude_subscription.py`

The two public async functions are:

```python
async def stream_completion(messages, model=None, binary_hint=None) -> AsyncGenerator[str, None]
async def call_completion(messages, model=None, binary_hint=None) -> str
```

Both accept an OpenAI-style message list and emit the same SSE wire format as
`stream_llm` so the chat tab renders identically to any other provider.

### Environment Scrub (Critical)

Before spawning the subprocess, `_scrub_env()` removes `ANTHROPIC_API_KEY`
and `ANTHROPIC_AUTH_TOKEN` from the inherited environment:

```python
_SCRUBBED_ENV_KEYS = frozenset({"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"})

def _scrub_env() -> Dict[str, str]:
    return {k: v for k, v in os.environ.items() if k not in _SCRUBBED_ENV_KEYS}
```

If either variable leaks into the child process, Claude Code silently uses
the API account instead of the subscription — billing per token.  This is the
#1 failure mode.  The test `test_scrub_env_removes_api_key_and_auth_token`
and `test_call_completion_uses_scrubbed_env` guard this invariant.

### Tools Disabled

All built-in tools are disabled via `--tools ""`.  This prevents the CLI from
reading files or executing shell commands as a side effect of a chat turn.
On a security suite this boundary is mandatory.

## Claude Code Flags

Verified against **Claude Code 2.1.152**.

| Flag | Purpose |
|------|---------|
| `-p` | Headless / print mode |
| `--tools ""` | Disable all built-in tools |
| `--output-format json` | Single JSON result (sync path) |
| `--output-format stream-json` | NDJSON event stream (async path) |
| `--verbose` | Required for `stream-json` mode |
| `--include-partial-messages` | Emit `stream_event` chunks for streaming tokens |
| `--no-session-persistence` | Stateless — no session saved to disk |

## Auth / Preflight

`preflight_check()` in `src/claude_subscription.py`:

1. Resolves the `claude` binary via `shutil.which` (or an optional `binary_hint`).
2. Checks that `~/.claude/settings.json` (or a legacy credentials file) exists,
   indicating the user has completed `claude` setup and logged in.

If either check fails, the provider surfaces a clear error with a remediation
message — never a stack trace or silent hang.

| Condition | Error message | Action |
|-----------|--------------|--------|
| Binary not found | "Claude Code is not installed." | `npm install -g @anthropic-ai/claude-code` |
| Not logged in | "Claude Code is installed but you are not logged in to your subscription." | "Run `claude` in your terminal and use /login to authenticate." |

## Registration

Routes: `routes/claude_subscription_routes.py`

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/claude-subscription/status` | Preflight check |
| `POST` | `/api/claude-subscription/provision` | Create/update ModelEndpoint row |
| `DELETE` | `/api/claude-subscription/remove` | Remove the endpoint row |

Registered in `app.py`:

```python
from routes.claude_subscription_routes import setup_claude_subscription_routes
app.include_router(setup_claude_subscription_routes())
```

## Available Models

The static model list (no HTTP probe needed):

```
claude-sonnet-4-6
claude-opus-4
claude-haiku-4
claude-sonnet-4-5
```

The user selects the active model through the standard Cerberus model picker.

## Hiding from the Menu

This provider uses the standard Cerberus `features.json` mechanism (same as
`deep_research`, `gallery`, etc.).  To hide the tab:

```bash
curl -s -X POST http://localhost:7000/api/auth/features \
  -H 'Content-Type: application/json' \
  -d '{"claude_subscription": false}'
```

Or via the admin Settings panel → Features.

## Constraints and Limits

- **Interactive only.** Not wired into any swarm, automation, or background
  task lane.  Those routes stay on API-key providers.
- **No API key field.** The ModelEndpoint row has `api_key = None`.
- **No multi-user sharing.** The OAuth login belongs to the OS user running
  Cerberus.  Shared Cerberus instances must use a dedicated machine account
  that has completed the `claude` login.
- **Rate limits.** Claude subscription accounts have per-session and per-day
  usage limits. Heavy use will hit them.
