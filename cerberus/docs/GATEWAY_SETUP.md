# Gateway Setup

The Cerberus Gateway bridges Discord (and optionally Telegram/Slack) to the Cerberus chat backend, giving those platforms full access to your tools — calendar, notes, email, web search, etc.

## How it works

The gateway authenticates as a Cerberus user, creates one chat session per channel, and routes all messages through `/api/chat_stream` with `mode=agent`. This gives the LLM the full agent tool pipeline including intent-based auto-escalation for calendar/notes requests.

## Required `.env` variables

`data/` is gitignored — create or edit `cerberus/.env` (not committed):

```env
# Gateway auth — must match an existing Cerberus account
CERBERUS_GATEWAY_USER=<your-cerberus-username>
CERBERUS_GATEWAY_TOKEN=<your-cerberus-password>

# Discord
DISCORD_BOT_TOKEN=<discord-bot-token>

# Optional: restrict to specific guilds/channels (comma-separated IDs)
# DISCORD_ALLOWED_GUILD_IDS=123456789,987654321
# DISCORD_ALLOWED_CHANNEL_IDS=111222333
```

The gateway user should be your **main Cerberus account** (not a separate service account) so that calendar events, notes, and other tool writes land in your data.

## data/auth.json

`data/auth.json` is gitignored. The gateway uses an existing Cerberus account — no separate gateway service account is needed. Create or manage users via **Settings → Users** in the Cerberus UI, or via the admin API.

## data/app.db — no manual changes needed

The gateway auto-discovers your configured LLM endpoint from `GET /api/models` on first use and caches it for the process lifetime. No manual DB changes are required. If you have multiple endpoints and want to pin a specific one, set:

```env
CERBERUS_GATEWAY_ENDPOINT_ID=<endpoint-uuid>
```

## Optional env vars

| Variable | Default | Description |
|---|---|---|
| `CERBERUS_API_URL` | `http://cerberus:7000` | Internal URL of the Cerberus app |
| `CERBERUS_GATEWAY_USER` | `itseliias` | Cerberus username the gateway logs in as |
| `CERBERUS_GATEWAY_TOKEN` | _(required)_ | Password for that user |
| `CERBERUS_GATEWAY_ENDPOINT_ID` | _(auto-discover)_ | Pin a specific model endpoint |
| `CERBERUS_SESSION_MODEL` | _(endpoint default)_ | Override the model used for gateway sessions |
| `DISCORD_BOT_TOKEN` | _(required to enable Discord)_ | From Discord Developer Portal |
| `DISCORD_ALLOWED_GUILD_IDS` | _(all guilds)_ | Comma-separated server IDs |
| `DISCORD_ALLOWED_CHANNEL_IDS` | _(all channels)_ | Comma-separated channel IDs |
| `GATEWAY_CRON_ENABLED` | `true` | Enable the cron scheduler |

## Rebuild after changing .env

```bash
docker compose -f cerberus/docker-compose.yml up -d cerberus-gateway
```

No image rebuild needed for env-only changes — `up -d` restarts the container with the new values.
