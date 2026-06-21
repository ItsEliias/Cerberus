# Cerberus

> Security-hardened, self-hosted AI workspace. 16 sandboxed agents, a 10-tab Command Center cockpit, Discord/Telegram gateway, Kokoro voice, and a full document library — all behind an approval-gated execution layer.

![Cerberus](docs/cerberus.jpg)

| | |
|---|---|
|![Chat & Agents](docs/chat.gif)|![Deep Research](docs/research.gif)|
|![Compare](docs/compare.gif)|![Documents](docs/document.gif)|
|![Notes & Tasks](docs/notes.gif)||

```
───────────────────────────────────────────────
  Cerberus vers. 2.0 — Guardian of the Gate
───────────────────────────────────────────────
```

Built on top of [odysseus](https://github.com/pewdiepie-archdaemon/odysseus) (AGPL-3.0), with three pillars:

- **Backbone** — odysseus: chat, deep research, docs, email, calendar, agent loop, web UI
- **Sandbox** — [OpenSandbox](https://github.com/opensandbox-group/OpenSandbox) (Apache-2.0): every agent shell/code action runs in an isolated container, never on the host
- **Connectivity** — [hermes-agent](https://github.com/NousResearch/hermes-agent) (MIT): Telegram, Discord, Slack — reach Cerberus from any messaging platform

## Features

### Command Center — 10-tab cockpit

The CC is a single-page Nexus HUD rendered inside an iframe. Keyboard-driven (`?` for shortcuts).

| Tab | What's in it |
|-----|-------------|
| **COMMAND** | Live task queue, model roster, quick-run |
| **AGENTS** | 16-agent roster, health monitor, memory viewer, prompt-testing, invocation stats |
| **ASSISTANT** | Chat panel + sub-panels: Notes, Documents, Contacts, Research, Memory Timeline |
| **GATEWAY** | Discord/Telegram status, approval cards, email composer, webhook manager |
| **WORKSPACE** | Scheduled-task manager, webhook config, operator profile |
| **OBSERVE** | Per-agent/model token breakdown, sparklines, system diagnostics strip |
| **COMPARE** | Fan one prompt to up to 4 agents in parallel, blind-score |
| **COUNCIL** | Live agent-routing graph (SSE), council presets, changelog panel |
| **FINANCE** | LLM cost & usage dashboard (token spend by day / agent / model) |
| **ROOMS** | Conference rooms, voice sessions |

### Agents

16 built-in V4 tool-using agents:

`ARCHITECT · CODER · TESTER · RESEARCHER · REVIEWER · SECURITY · ORCHESTRATOR · DEVOPS · DATA-ANALYST · SCRIBE · DESIGNER · DEBUGGER · PLANNER · LIBRARIAN · OPTIMIZER · PROMPTSMITH`

Every shell/code action runs inside **OpenSandbox** — isolated from the host, fails closed. Each agent supports custom skills and personas; approval gates queue destructive tool calls for operator sign-off before execution.

### Voice

- **Kokoro TTS** — offline neural text-to-speech, no cloud dependency
- **Wake-word** — hands-free activation (configurable phrase, stored in localStorage)
- Transcripts auto-saved as notes; recent-sessions strip in the VOICE panel

### Gateway

Discord and Telegram adapters, extensible to Slack. Per-platform:

- **Tool tiers** — each platform gets its own scoped allowed-tool set
- **Approval gates** — high-risk actions queue for operator sign-off in the CC GATEWAY tab
- **Email allowlisting** — restrict inbound users by domain or address (configured via `.env`)

### Document library

Import or fetch: `.docx · .xlsx · .pptx · .pdf · Markdown · HTML · CSV` and YouTube URLs via [MarkItDown](https://github.com/microsoft/markitdown). List, view, import, and delete in the ASSISTANT → DOCUMENTS sub-panel.

### Profile & onboarding

First-login wizard collects operator name, preferred model, and notification prefs. Profile persists across sessions and surfaces in the CC header.

### Observability & activity

- **Activity heatmap** — last 30 days of agent invocations, streak chips on the dashboard
- **OBSERVE tab** — per-agent and per-model token counts, cost sparklines, session history
- **Diagnostics strip** — live system health (CPU, memory, uptime) inline in the OBSERVE tab
- **Health monitor** — per-agent up/down status with auto-recovery reset endpoint

### Mobile API + Android companion

`GET /api/mobile` returns session summary, thread list, and paginated thread messages, used by the [Cerberus Android companion](companion/). Push-token registration for browser and mobile notifications.

### Other

- **Chat** — any local model or API (`vLLM · llama.cpp · Ollama · OpenRouter · OpenAI · Claude Subscription · GitHub Copilot`)
- **Deep Research** — multi-step web gather + synthesise → visual report
- **Cookbook** — VRAM-aware model recommender; click to download and serve (GGUF / FP8 / AWQ)
- **Email** — IMAP/SMTP with AI triage, auto-tag, auto-summary, draft replies
- **Notes & Tasks** — pinnable notes with MD preview; scheduled tasks the agent can act on
- **Calendar** — local-first, CalDAV sync (Radicale / Nextcloud / Apple / Fastmail)
- **Memory / Skills** — persistent ChromaDB memory, fastembed ONNX vectors, import/export
- **Cyber Apps** — native app panel: CyberLab, NetLab, NetworkMap, ReconDesk, VaultCore, CredVault, GhostVault, Dashboard, ReportForge, PlaybookStudio, SignalBoard, TerminalLink
- **i18n** — English / Spanish locale switching (more planned)

## Security model

| Control | Status |
|---------|--------|
| Auth always on | `AUTH_ENABLED=true` hardcoded |
| Localhost-only bind | `APP_BIND=127.0.0.1` |
| LOCALHOST_BYPASS removed | Permanently disabled |
| Internal token unpredictable | Generated at process start, never from env |
| Tmux shell injection fixed | `cmd` wrapped in `shlex.quote()` |
| Agent execution sandboxed | OpenSandbox isolates every shell/code call |
| Untrusted content guard | Notes / docs / gateway msgs / tool output = data, never instructions |
| V4 approval gates | High-risk agent tool calls queue for operator sign-off |
| Per-platform tool tiers | Gateway platforms get scoped tool allowlists |
| Email allowlisting | Gateway inbound restricted by domain/address |
| Sandbox fails closed | No host fallback — tool errors if sandbox unavailable |

See `SECURITY.md` for the threat model and `THREAT_MODEL.md` for the V4 agent threat surface.

## Quick start

```bash
cd cerberus
cp .env.example .env          # set LLM host + gateway tokens as needed
python setup.py               # creates data/, DB, admin account
python -m uvicorn app:app --host 127.0.0.1 --port 7000
# open http://localhost:7000
```

> **Bind note:** always `--host 127.0.0.1` (loopback). Use `0.0.0.0` only behind a reverse proxy + TLS.

**Docker Compose (recommended):**

```bash
docker compose up -d          # main app on :7000
# Gateway is a SEPARATE compose service — rebuild both when shared code changes.
```

After any code change: `docker compose build && docker compose up -d`, then hard-refresh the CC iframe.

## Attribution

Cerberus is a hardened fork of odysseus. See:

- `ACKNOWLEDGMENTS.md` — upstream credits
- `THIRD_PARTY_LICENSES.md` — full license texts for all vendored dependencies
- `PROVENANCE.md` — pinned upstream commit SHAs

odysseus copyright © pewdiepie-archdaemon contributors, AGPL-3.0 License.
OpenSandbox copyright © 2025 Alibaba Group Holding Ltd., Apache-2.0 License.
hermes-agent copyright © NousResearch contributors, MIT License.
