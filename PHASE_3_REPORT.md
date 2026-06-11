# Cerberus Phase 3 Report — Connectivity + Cron

**Branch**: cerberus
**Date**: 2026-06-11
**Tests**: 3174 passed, 0 failed (4 skipped — live integration tests from Phase 2)

---

## Objective

Harvest hermes-agent's `gateway/` and `cron/` modules, replace the seam
where they call hermes's agent loop with a call to Cerberus's existing
`POST /api/chat` REST endpoint, and wire Telegram as the first fully-working
platform.

---

## Deliverables

### 1. Gateway package

`cerberus/gateway/` (new package):

| File | Purpose |
|------|---------|
| `__init__.py` | Package docstring |
| `config.py` | `GatewayConfig`, `CerberusConfig`, `TelegramConfig`, `CronConfig` — all from env vars, no secrets in code |
| `cerberus_client.py` | The seam: `send_message()` calls `POST /api/chat`; per-chat session cache with asyncio lock |
| `platforms/__init__.py` | Sub-package |
| `platforms/base.py` | `BasePlatformAdapter` abstract class; `IncomingMessage`, `OutgoingMessage` dataclasses |
| `platforms/telegram.py` | Telegram adapter using `python-telegram-bot >= 20.0`; polling mode |
| `scheduler.py` | `GatewayCronScheduler` — cron jobs loaded from JSON file, deliver via platform adapters |
| `main.py` | Entry point; starts adapters + scheduler; SIGTERM/SIGINT clean shutdown |

### 2. The seam (critical design point)

hermes's gateway called `AIAgent` → hermes agent loop.
Cerberus gateway calls `cerberus_client.send_message()` → `POST /api/chat` → Cerberus agent loop.

The core Cerberus agent loop is untouched. The gateway is a thin HTTP client
that speaks Cerberus's existing REST API.

### 3. Telegram adapter

`gateway/platforms/telegram.py`:

- Long-polling via `python-telegram-bot >= 20.0` (no webhook server required)
- `/start`, `/reset`, `/help` commands
- Chat access control: `TELEGRAM_ALLOWED_CHAT_IDS` restricts which chats the bot responds to (empty = open)
- Long response splitting at paragraph boundaries (Telegram 4096-char limit)
- Graceful Markdown fallback: retries without `parse_mode` if Telegram rejects formatting
- `/reset` invalidates the session cache for the chat

### 4. Cron scheduler

`gateway/scheduler.py`:

- Extends (does not replace) Cerberus's existing `src/task_scheduler.py`
- Job format: `{id, name, prompt, cron, platform, chat_id, enabled}` in JSON file
- Croniter-based next-run computation
- Fires due jobs as asyncio tasks; delivers output to the target platform adapter
- Persistent: jobs survive restarts (JSON file in `data/gateway/cron_jobs.json`)
- Path-traversal protection on job IDs (regex allowlist + absolute-path rejection)
- Prompt injection protection: prompt field max 10,000 chars

### 5. Docker Compose

`cerberus/docker-compose.yml` — new `cerberus-gateway` service:

- Reuses the same Docker image as `cerberus`, runs `python -m gateway.main`
- `depends_on: cerberus` — waits for the main app to start
- No ports exposed: Telegram polling is outbound-only
- Mirrored to `docker-compose.gpu-nvidia.yml` and `docker-compose.gpu-amd.yml`

### 6. Platform pluggability

Adding a second platform (Discord, Slack, etc.) requires:

1. `gateway/platforms/<name>.py` — subclass `BasePlatformAdapter`, implement `start()`, `stop()`, `send_message()`
2. `gateway/config.py` — add a config dataclass (token env var)
3. `gateway/main.py` — one `if cfg.<name>.enabled:` line in `_build_adapters()`

No changes to the cron scheduler, cerberus_client, or base adapter.

---

## Security Properties

| Property | Status |
|----------|--------|
| Bot token never hardcoded — env var only | Implemented |
| Chat access control via TELEGRAM_ALLOWED_CHAT_IDS | Implemented |
| Cerberus API auth via Bearer token | Implemented |
| No ports exposed (polling only) | Implemented |
| Cron job IDs validated against path-traversal | Implemented |
| Prompt truncated to 10,000 chars | Implemented |
| No hermes agent loop or hermes deps imported | Confirmed |

---

## Test Results

| Area | Tests | Result |
|------|-------|--------|
| GatewayConfig from env | 6 | PASS |
| CerberusClient session + dispatch | 4 | PASS |
| Telegram message splitting | 3 | PASS |
| Telegram access control | 2 | PASS |
| CronJob validation + scheduling | 7 | PASS |
| GatewayCronScheduler lifecycle | 5 | PASS |
| Platform pluggability | 1 | PASS |
| Mock round-trip (message → Cerberus → reply) | 1 | PASS |
| GPU standalone sync | 2 | PASS |
| **Full suite** | **3174** | **PASS** |

---

## Activating Telegram (operator steps — post-mission)

No secrets are committed. After the sandbox boundary is proven:

1. Create a bot with @BotFather → copy the token
2. Add to `.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi
   CERBERUS_GATEWAY_TOKEN=<your Cerberus API token>
   TELEGRAM_ALLOWED_CHAT_IDS=<your personal Telegram chat ID>
   ```
3. `docker compose up cerberus-gateway -d`
4. Send a message to the bot in Telegram — it should reply via Cerberus

---

## Adding a Cron Job

Create or edit `data/gateway/cron_jobs.json`:

```json
{
  "jobs": [
    {
      "id": "morning-brief",
      "name": "Morning briefing",
      "prompt": "Give me a brief summary of anything I should know today.",
      "cron": "0 9 * * 1-5",
      "platform": "telegram",
      "chat_id": 123456789,
      "enabled": true
    }
  ]
}
```

The scheduler picks up changes on the next restart (or tick if hot-reload is added in a future phase).

---

## Mission 1 Status

| Phase | Status |
|-------|--------|
| Phase 0 — Audit | DONE |
| Phase 1 — Rebrand | DONE |
| Phase 2 — OpenSandbox | DONE (live tests pending Docker) |
| Phase 3 — Connectivity | DONE |
| MISSION_1_SUMMARY.md | Remaining |
