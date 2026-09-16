# Cerberus

Security-hardened, self-hosted AI workspace — a full-featured agent platform where every shell/code action runs in an isolated sandbox instead of on your machine.

## Overview

Cerberus is a private AI workspace you run on your own hardware: chat with local or hosted models, hand multi-step tasks to autonomous agents, run deep research, manage email/calendar/notes/documents, and reach all of it from Discord, Telegram, or Slack.

It exists because most self-hosted "AI agent" stacks execute model-generated shell and Python commands directly on the host machine. That's a real problem — an agent that can be steered by a prompt-injected email, web page, or document can then run arbitrary code with your user's privileges. Cerberus was built to close that gap without giving up capability. It takes a full-featured upstream workspace and wraps it in three deliberate layers:

- **Backbone** — a security-hardened fork of [odysseus](https://github.com/pewdiepie-archdaemon/odysseus) (AGPL-3.0): chat, agents, deep research, documents, email, calendar, memory, and the web UI.
- **Sandbox** — every agent shell/code action is routed through [OpenSandbox](https://github.com/opensandbox-group/OpenSandbox) (Apache-2.0) and executes in an isolated, ephemeral container, never on the host. The sandbox fails closed: if it's unreachable, the tool errors instead of falling back to a host subprocess.
- **Connectivity** — a messaging gateway (Discord/Telegram/Slack + cron scheduling) adapted from [hermes-agent](https://github.com/NousResearch/hermes-agent) (MIT), so the workspace can be operated remotely, not just from a browser tab on the host.

The project's origin is itself security-first: before any real data touched the upstream code, it went through a documented Phase 0 audit (see [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md)), and every vendored upstream is pinned to an exact commit in [`PROVENANCE.md`](PROVENANCE.md). User-editable surfaces — skills, notes, documents, fetched web pages, and memories — are treated as **untrusted data**, not trusted instructions; see [`cerberus/THREAT_MODEL.md`](cerberus/THREAT_MODEL.md) for the threat model and [`cerberus/SECURITY.md`](cerberus/SECURITY.md) to report a vulnerability.

## Key Features

- **Command Center** — an 11-tab operator cockpit (COMMAND, COUNCIL, WORKSPACE, FINANCE, TRADER*, ASSISTANT, GATEWAY, AGENTS, ROOMS, COMPARE, OBSERVE — *TRADER is admin-only), keyboard-driven, rendered as a single-page HUD.
- **16 built-in agents** (ARCHITECT, CODER, TESTER, RESEARCHER, REVIEWER, SECURITY, ORCHESTRATOR, DEVOPS, DATA-ANALYST, SCRIBE, DESIGNER, DEBUGGER, PLANNER, LIBRARIAN, OPTIMIZER, PROMPTSMITH) with custom skills/personas, per-agent invocation telemetry, and prompt-testing/diff tooling.
- **Sandboxed agent execution** — shell and code tool calls run inside OpenSandbox containers; approval gates queue high-risk tool calls for operator sign-off before they execute.
- **Chat** across pluggable backends: vLLM, llama.cpp, Ollama, OpenRouter, OpenAI, Claude Subscription, GitHub Copilot.
- **Deep Research** — multi-step web gather-and-synthesize runs that produce a sanitized, visual HTML report.
- **Cookbook** — scans host hardware and recommends/downloads/serves local models (GGUF/FP8/AWQ, VRAM-aware fit scoring).
- **Compare** — fan one prompt out to up to 4 agents in parallel for blind side-by-side scoring.
- **Documents** — import/convert `.docx .xlsx .pptx .pdf` Markdown/HTML/CSV and YouTube URLs via Microsoft MarkItDown; multi-tab editor with AI assists.
- **Memory & Skills** — persistent ChromaDB vector memory with fastembed (local ONNX) embeddings and keyword fallback; import/export.
- **Email** — IMAP/SMTP inbox with AI triage, auto-tagging, summaries, and draft replies.
- **Calendar** — local-first with CalDAV sync (Radicale, Nextcloud, Apple, Fastmail).
- **Notes & Tasks** — pinnable notes with Markdown preview, plus scheduled tasks the agent loop can act on.
- **Gateway** — Discord, Telegram, and Slack adapters with per-platform tool-allowlist tiers, an approval-gate queue for high-risk actions, and inbound-email allowlisting.
- **Voice** — offline Kokoro TTS and configurable wake-word activation, with auto-saved transcripts.
- **Mobile** — `/api/mobile` session/thread API backing a companion Android app, plus PWA installability.
- **Paper trading (TRADER tab, admin-only)** — a MANDATE-gated paper-trading simulator (`cerberus/trading/`): hard-coded conservative floors on position size/exposure/daily loss/leverage that a config file can only tighten, plus a SHA-256 hash-chained, append-only audit ledger for every order/circuit-breaker event.
- **Desktop app** (new/in progress) — native Windows/macOS/Linux launcher (`desktop.py`) that boots the FastAPI app in-process and opens it in a native OS webview instead of a browser tab; PyInstaller packaging (`cerberus.spec`) and a Windows installer/CI release pipeline exist.
- **i18n** — English/Spanish locale switching.

## Tech Stack

- **Backend:** Python (3.11 in the main CI workflow; Windows desktop build workflow defaults to 3.12), FastAPI, Uvicorn, SQLAlchemy, Pydantic v2, SQLite
- **Retrieval / memory:** ChromaDB (`chromadb-client`) + `fastembed` (local ONNX embeddings), with keyword fallback
- **Sandboxed execution:** `opensandbox` SDK (pinned `==0.1.16`) — remote code-interpreter/execd/egress service
- **Search:** self-hosted SearXNG instance (Docker Compose service)
- **Frontend:** vanilla JS single-page web UI (the "jarvis-v2" theme + Command Center HUD), served as static assets; no SPA framework build step for the main app
- **Voice:** Kokoro TTS (offline neural TTS)
- **Gateway:** `python-telegram-bot>=20.0`, `discord.py>=2.0`, a hand-rolled Slack adapter, `croniter` for scheduled jobs
- **Documents:** Microsoft `markitdown>=0.1.5`, `nh3` (HTML sanitizer for untrusted rendered reports), `icalendar` / `python-dateutil` / `caldav`
- **Token compression:** `llmlingua` (optional, downloads an XLM-R model on first use)
- **Desktop packaging:** `pywebview`-style native window (WebView2 / WebKit / GTK), PyInstaller (`cerberus.spec`), Inno Setup installer (`installer/cerberus.iss`), GitHub Actions Windows build/release workflow
- **Testing:** `pytest` + `pytest-asyncio` (3,500+ test functions across 586 files under `cerberus/tests/`), plus `node --test` (27 `.test.mjs` files) for Command Center JS tests
- **Packaging/deploy:** Docker Compose (CPU, NVIDIA GPU, AMD GPU variants), systemd unit, native macOS/Windows launch scripts

## Architecture

The repository is a superproject: the Cerberus application lives in `cerberus/`, and three upstream projects are pinned as git submodules under `vendor/` — kept for provenance/audit/diff purposes rather than imported live. Cerberus's own `gateway/` code is a direct, attributed port of pieces of `hermes-agent` (each adapted file credits its hermes-agent source), and the sandboxed tool-execution path talks to OpenSandbox over its SDK/API rather than importing it as a library.

```
.
├── cerberus/                  # The Cerberus application (FastAPI backend + web UI)
│   ├── app.py                 #   Entry point; wires 68 routers, mounts static assets
│   ├── desktop.py             #   Native desktop launcher (webview around the same app)
│   ├── src/                   #   Agent loop, tools, LLM clients, RAG, CalDAV sync, config
│   ├── routes/                #   ~75 HTTP/API route modules (chat, agents, council, gateway, ...)
│   ├── services/               #   Service layer: memory, research, search, stt/tts, hwfit, trading, ...
│   ├── core/                  #   Auth, database, middleware, models, session manager
│   ├── gateway/                #   Discord/Telegram/Slack adapters + cron scheduler (ported from hermes-agent)
│   ├── mcp_servers/            #   Bundled MCP servers: email, image-gen, memory, RAG, OpenBB
│   ├── static/                #   Web UI: jarvis-v2 theme, Command Center HUD, login page
│   ├── companion/              #   Android companion app pairing/routes
│   ├── desktop_bridge/         #   Standalone Windows-side service for launching
│   │                          #   whitelisted desktop apps; not wired into app.py
│   ├── scripts/                #   ~20 `cerberus-*` operator CLI tools
│   ├── tests/                  #   3,500+ pytest tests, taxonomy-tagged (area_security, area_routes, ...)
│   ├── docs/                   #   Screenshots/demo GIFs + migration reports
│   └── README.md               #   Full application documentation
│
├── cerberus-recon/             # Standalone Electron module: xterm.js terminal that launches
│                                #   Claude Code (with a recon/pentest plugin stack) + a scope/
│                                #   findings/session dashboard. Orchestration shell only — runs
│                                #   no scanners/exploits itself.
│
├── vendor/                     # Pinned upstream git submodules (see PROVENANCE.md)
│   ├── odysseus/                #   Backbone reference        (AGPL-3.0)
│   ├── OpenSandbox/              #   Sandboxed-execution service (Apache-2.0)
│   └── hermes-agent/             #   Gateway/cron reference    (MIT)
│
├── PROVENANCE.md               # Pinned upstream commit SHAs + clone metadata
├── SECURITY_AUDIT.md           # Phase 0 security audit of the upstream code
├── PHASE_0_REPORT.md … PHASE_3_REPORT.md   # Build-phase reports
├── MISSION_1_SUMMARY.md        # End-to-end summary of the initial hardening build
└── cerberus-mission-1*.md      # Original mission briefs
```

Request flow for a typical agent action: browser/Discord/Telegram/Slack → `cerberus/app.py` router → `src/agent_loop.py` (tool selection, memory/RAG context) → if the tool is shell/code execution, the call is dispatched to the OpenSandbox service (never run in-process) → result flows back through the same router to the UI or messaging platform. High-risk tool calls are intercepted by the approval-gate layer and queued in the Command Center's GATEWAY tab for operator sign-off before they reach the sandbox.

## Getting Started

1. **Clone with submodules** (the three vendored upstreams live under `vendor/`):
   ```bash
   git clone --recurse-submodules https://github.com/ItsEliias/Cerberus.git
   # already cloned without them?
   git submodule update --init --recursive
   ```
2. **Move into the application directory:**
   ```bash
   cd Cerberus/cerberus
   ```
3. **Configure environment variables** — copy the example file and edit as needed:
   ```bash
   cp .env.example .env
   ```
   Notable variables (all optional / defaulted unless noted):
   - `LLM_HOST` — primary LLM host for model discovery (default `localhost`)
   - `SEARXNG_INSTANCE` — self-hosted search backend URL
   - `AUTH_ENABLED`, `APP_BIND`, `APP_PORT` — auth and bind/port for the web UI (keep `APP_BIND` on loopback)
   - `CERBERUS_ADMIN_PASSWORD` — optional pre-seeded admin password for first boot (never commit a real value)
   - `CHROMADB_HOST` / `CHROMADB_PORT` — vector store connection
   - `GATEWAY_EMAIL_ALLOWLIST` — recipient allowlist for gateway-triggered email sends
   - `DISCORD_BOT_TOKEN`, `TELEGRAM_BOT_TOKEN`, `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` — messaging gateway credentials (set only the platforms you use)
   - `LLMLINGUA_ENABLED` — toggle token-compression (downloads a ~700 MB model on first use)
4. **Install dependencies** (native path):
   ```bash
   python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```
5. **Run first-time setup** (creates `data/`, the SQLite database, and an admin account):
   ```bash
   python setup.py
   ```
6. **Start the dev server:**
   ```bash
   python -m uvicorn app:app --host 127.0.0.1 --port 7000
   ```
   Open `http://localhost:7000`. Keep `--host 127.0.0.1` unless you intentionally want LAN/reverse-proxy exposure.

   Or via Docker Compose (brings up Cerberus + ChromaDB + SearXNG together):
   ```bash
   docker compose up -d
   ```

## Running It

Commands below are run from `cerberus/` unless noted.

| Command | What it does |
|---|---|
| `python -m uvicorn app:app --host 127.0.0.1 --port 7000` | Run the FastAPI app in dev mode |
| `python setup.py` | First-run setup: creates `data/`, the SQLite DB, and an admin account |
| `python desktop.py` | Run the native desktop launcher (webview window instead of a browser) |
| `docker compose up -d` | Start Cerberus + ChromaDB + SearXNG (+ gateway/ntfy as configured) in Docker |
| `docker compose build && docker compose up -d` | Rebuild containers after a code change (required — the CC iframe also needs a hard refresh) |
| `pytest -m "not slow"` | Fast test lane — the default for day-to-day changes |
| `pytest` | Full Python test suite (3,500+ tests across 586 files under `tests/`) |
| `node --test tests/*.test.mjs` | Command Center frontend tests (hand-rolled DOM shim, no jsdom) |
| `pyinstaller cerberus.spec` | Build the standalone desktop executable (`dist/Cerberus`) |

From the repo root, `cerberus-recon/` is a separate Node/Electron module with its own lifecycle: `cd cerberus-recon && npm install && npm start`.

## Project Structure

| Path | Purpose |
|---|---|
| `cerberus/app.py` | FastAPI entry point; mounts static assets and 68 routers |
| `cerberus/src/` | Core logic: agent loop, LLM/tool clients, RAG, CalDAV sync, config, embeddings |
| `cerberus/routes/` | HTTP/API route modules, one per feature area (~75 files) |
| `cerberus/services/` | Service layer: memory, research, search, speech, hardware-fit, trading |
| `cerberus/core/` | Auth, database session, middleware, ORM models |
| `cerberus/gateway/` | Discord/Telegram/Slack adapters + cron scheduler, ported from hermes-agent |
| `cerberus/mcp_servers/` | Bundled MCP servers (email, image-gen, memory, RAG, OpenBB) |
| `cerberus/static/` | Web UI assets: `jarvis-v2` theme, Command Center HUD, login page |
| `cerberus/companion/` | Android companion app pairing endpoints |
| `cerberus/scripts/` | `cerberus-*` operator CLI tools (backup, mail, memory, docs, ...) |
| `cerberus/tests/` | pytest suite with an area-tagged taxonomy (`tests/README.md`) |
| `cerberus/docs/` | Screenshots and demo GIFs referenced by this README and `cerberus/README.md` |
| `cerberus-recon/` | Standalone Electron terminal shell that launches Claude Code for recon work |
| `vendor/` | Pinned upstream submodules: `odysseus`, `OpenSandbox`, `hermes-agent` |
| `PROVENANCE.md` | Exact pinned commit SHAs for each vendored upstream |
| `SECURITY_AUDIT.md` | Phase 0 security audit findings on the upstream code |
| `PHASE_0_REPORT.md` … `PHASE_3_REPORT.md` | Build-phase reports documenting the hardening work |

## Status

Actively developed, pre-release. There are no semantic-version release tags — the six existing tags are internal build/mission milestones (`phase-1-complete` … `phase-3-complete`, `mission-1-complete`, `cerberus-1.5-baseline`, `overnight-baseline`), and `cerberus/CHANGELOG.md` tracks everything under a single ongoing `[Unreleased]` section. The default branch (`cerberus`) sees frequent, PR-gated merges (168 branches in this repo at time of writing, many representing parallel in-progress features). The most recent work on the default branch is a native Windows desktop packaging effort (`desktop.py`, PyInstaller spec, Inno Setup installer, GitHub Actions release workflow) plus test-suite stabilization. `cerberus/ROADMAP.md` frames it directly: functional and used daily by its author, but pre-1.0 — fresh-install reliability across OSes, Cookbook robustness across GPUs/drivers, and a prompt-injection audit of untrusted content paths are called out as the top open items.

## License

Cerberus is released under the **GNU Affero General Public License v3.0** (AGPL-3.0) — see [`cerberus/LICENSE`](cerberus/LICENSE). As a hardened fork of odysseus (also AGPL-3.0), it inherits the same copyleft terms: running a modified Cerberus as a network service requires making your source available to its users.

Vendored/adapted upstreams keep their own licenses — odysseus (AGPL-3.0), OpenSandbox (Apache-2.0), hermes-agent (MIT) — with full texts in [`cerberus/THIRD_PARTY_LICENSES.md`](cerberus/THIRD_PARTY_LICENSES.md) and credits in [`cerberus/ACKNOWLEDGMENTS.md`](cerberus/ACKNOWLEDGMENTS.md).
