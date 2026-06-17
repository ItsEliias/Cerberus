# Cerberus

> **Security-hardened, self-hosted AI workspace.** Cerberus guards the gate — every agent action runs inside an isolated sandbox so it can never touch the host directly.

![Cerberus](cerberus/docs/cerberus.jpg)

| | |
|---|---|
| ![Chat & Agents](cerberus/docs/chat.gif) | ![Deep Research](cerberus/docs/research.gif) |
| ![Compare](cerberus/docs/compare.gif) | ![Documents](cerberus/docs/document.gif) |
| ![Notes & Tasks](cerberus/docs/notes.gif) | |

```
───────────────────────────────────────────────
  Cerberus vers. 1.0 — Guardian of the Gate
───────────────────────────────────────────────
```

Cerberus is a complete, private AI workspace you run on your own hardware — chat with local or hosted models, hand tasks to an autonomous agent, do multi-step deep research, manage email/calendar/notes, and reach it from your phone. It is a **security-hardened fork of [odysseus](https://github.com/pewdiepie-archdaemon/odysseus)**, rebuilt around the principle that an AI agent should never be trusted with raw access to your machine.

---

## Why Cerberus

Most self-hosted agent stacks run model-generated shell and Python commands directly on the host. Cerberus doesn't. It takes a capable upstream workspace and wraps it in three deliberate layers:

- **Backbone** — [odysseus](https://github.com/pewdiepie-archdaemon/odysseus) (AGPL-3.0): chat, deep research, documents, email, calendar, the agent loop, and the web UI.
- **Sandbox** — [OpenSandbox](https://github.com/opensandbox-group/OpenSandbox) (Apache-2.0): every agent shell/code action runs in an isolated, ephemeral container — never on the host.
- **Connectivity** — [hermes-agent](https://github.com/NousResearch/hermes-agent) (MIT): reach Cerberus from Telegram, Slack, Discord, and other messaging platforms.

Every upstream is pinned to an exact commit and tracked in [`PROVENANCE.md`](PROVENANCE.md), and the whole stack went through a documented security audit before any real data touched it (see [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md)).

---

## Features

- **Chat** — talk to any local model or API; adding new ones is simple.
  `vLLM · llama.cpp · Ollama · OpenRouter · OpenAI · GitHub Copilot`
- **Agent** — hand it tools and let it run a whole task end to end. Every shell/code command executes inside OpenSandbox, isolated from the host.
  `MCP · web · files · sandboxed shell · sandboxed Python · skills · memory`
- **Cookbook** — scans your hardware, recommends models, and lets you download and serve them with a click.
  `VRAM-aware · GGUF / FP8 / AWQ · fit scoring · vLLM / llama.cpp serving`
- **Deep Research** — multi-step runs that gather, read, and synthesize sources into a visual report.
- **Compare** — run models side by side, blind, with no bias.
- **Documents** — multi-tab editor with AI assists for Markdown, HTML, and CSV, plus syntax highlighting.
- **Memory / Skills** — persistent memory and skills so the agent improves over time.
  `ChromaDB · fastembed (ONNX) · vector + keyword retrieval · import/export`
- **Email** — IMAP/SMTP inbox with AI triage: urgency reminders, auto-tagging, summaries, and draft replies.
- **Notes & Tasks** — quick notes, todos, and scheduled tasks the agent can act on.
- **Calendar** — local-first with CalDAV sync to Radicale, Nextcloud, Apple, or Fastmail.
- **Connectivity** — Telegram out of the box, with Discord/Slack adapters, via the hermes gateway.
- **Mobile-ready** — responsive, installable as a PWA, with touch gestures.

---

## Quick start

The upstream foundations live in `vendor/` as git submodules, so clone with them included:

```bash
git clone --recurse-submodules https://github.com/ItsEliias/Cerberus.git
# already cloned without them? run:
#   git submodule update --init --recursive
```

The application lives in [`cerberus/`](cerberus/). The fastest path is Docker:

```bash
cd cerberus
docker compose up -d
# open http://localhost:7000
```

Or run it natively (no real keys required for a localhost demo):

```bash
cd cerberus
cp .env.example .env          # edit with your LLM host if needed
python setup.py               # creates data/, the database, and an admin account
python -m uvicorn app:app --host 127.0.0.1 --port 7000
# open http://localhost:7000
```

> **Binding note:** keep `--host 127.0.0.1` (loopback). Only use `0.0.0.0` when you intentionally want to expose the server to your local network — and never without a reverse proxy and TLS in front of it.

GPU-specific Compose files (`docker-compose.gpu-nvidia.yml`, `docker-compose.gpu-amd.yml`) and platform launchers (`start-macos.sh`, `launch-windows.ps1`) are included in `cerberus/`. See [`cerberus/README.md`](cerberus/README.md) for the full application documentation.

---

## Security model

Cerberus is hardened beyond the upstream odysseus defaults:

| Control | Status |
|---------|--------|
| Auth always on | `AUTH_ENABLED=true`, hardcoded |
| Localhost-only bind | `APP_BIND=127.0.0.1` |
| `LOCALHOST_BYPASS` removed | Permanently disabled |
| Internal token unpredictable | Generated at process start, never read from env |
| Tmux shell injection fixed | `cmd` wrapped in `shlex.quote()` |
| Agent execution sandboxed | OpenSandbox isolates every shell/code call |

User-editable surfaces — skills, notes, documents, fetched web pages, and memories — are treated as **untrusted data**, not trusted instructions. See [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) for the Phase 0 findings and [`cerberus/THREAT_MODEL.md`](cerberus/THREAT_MODEL.md) for the threat model. To report a vulnerability, see [`cerberus/SECURITY.md`](cerberus/SECURITY.md).

---

## Repository layout

This repository contains the Cerberus application, snapshots of its upstream dependencies, and the audit trail from the build.

```
.
├── cerberus/            # The Cerberus application (FastAPI backend + web UI)
│   ├── app.py           # Slim orchestrator / entry point
│   ├── src/             # Core agent loop, tools, LLM, RAG, integrations
│   ├── routes/          # ~58 HTTP/API route modules
│   ├── services/        # Service layer (search, memory, research, stt/tts, hwfit, …)
│   ├── core/            # Auth, database, middleware, models, session manager
│   ├── gateway/         # hermes messaging gateway + platform adapters
│   ├── mcp_servers/     # Bundled MCP servers (email, image-gen, memory, RAG)
│   ├── static/          # Web UI assets, incl. the "jarvis-v2" theme
│   ├── scripts/         # ~20 `cerberus-*` CLI tools + maintenance scripts
│   ├── integrations/    # Claude & Codex skill integrations
│   ├── docs/            # Screenshots, demo clips, and migration reports
│   └── README.md        # Full application documentation
│
├── vendor/              # Pinned upstream git submodules (see PROVENANCE.md)
│   ├── odysseus/        # Backbone         (AGPL-3.0)
│   ├── OpenSandbox/     # Secure execution (Apache-2.0)
│   └── hermes-agent/    # Connectivity     (MIT)
│
├── PROVENANCE.md        # Pinned upstream commit SHAs + clone metadata
├── SECURITY_AUDIT.md    # Phase 0 security audit of the upstream code
├── PHASE_0_REPORT.md … PHASE_3_REPORT.md   # Build phase reports
├── MISSION_1_SUMMARY.md # End-to-end summary of the initial build
└── cerberus-mission-1*.md  # Mission briefs
```

### Tech stack

- **Backend:** Python, FastAPI, Uvicorn, SQLAlchemy, Pydantic v2
- **Retrieval:** ChromaDB + fastembed (local ONNX embeddings), with keyword fallback
- **Frontend:** vanilla JS web UI plus a Vite-built sub-app, served as static assets
- **Models:** pluggable across vLLM, llama.cpp, Ollama, OpenRouter, OpenAI, and Copilot
- **Packaging:** Docker / Docker Compose (with NVIDIA and AMD GPU variants), plus native macOS/Windows launchers

---

## Build provenance

Cerberus was assembled and hardened in documented phases. The mission-level audit trail lives at the repository root; the corresponding application-level reports live under `cerberus/`.

| Phase | What happened | Reference |
|-------|---------------|-----------|
| Phase 0 | Security audit of odysseus before any real data; critical fixes identified | [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md), [`PHASE_0_REPORT.md`](PHASE_0_REPORT.md) |
| Phase 1 | Full odysseus → Cerberus rebrand; the three core security fixes landed | [`PHASE_1_VERIFICATION.md`](PHASE_1_VERIFICATION.md) |
| Phase 2 | Agent shell/Python execution moved into OpenSandbox containers | [`PHASE_2_REPORT.md`](PHASE_2_REPORT.md) |
| Phase 3 | Connectivity and further hardening | [`PHASE_3_REPORT.md`](PHASE_3_REPORT.md) |

A consolidated overview is in [`MISSION_1_SUMMARY.md`](MISSION_1_SUMMARY.md).

---

## Contributing

Cerberus is moving fast and help is genuinely welcome — bug squashing, fresh-install smoke tests across Linux/macOS/Windows (Docker, native, and WSL), and Cookbook reliability across different GPUs and drivers are all high-priority areas. See [`cerberus/ROADMAP.md`](cerberus/ROADMAP.md) for what's wanted and [`cerberus/CONTRIBUTING.md`](cerberus/CONTRIBUTING.md) for how to get started.

---

## License & attribution

Cerberus is released under the **GNU Affero General Public License v3.0** (AGPL-3.0) — see [`cerberus/LICENSE`](cerberus/LICENSE). As a hardened fork of odysseus (AGPL-3.0), it inherits the same copyleft terms; if you run a modified Cerberus as a network service, the AGPL requires you to make your source available to its users.

Cerberus stands on three open-source foundations:

- **odysseus** — © pewdiepie-archdaemon contributors — AGPL-3.0
- **OpenSandbox** — © 2025 Alibaba Group Holding Ltd. — Apache-2.0
- **hermes-agent** — © NousResearch contributors — MIT

Full details:

- [`cerberus/ACKNOWLEDGMENTS.md`](cerberus/ACKNOWLEDGMENTS.md) — upstream credits
- [`cerberus/THIRD_PARTY_LICENSES.md`](cerberus/THIRD_PARTY_LICENSES.md) — full license texts for vendored dependencies
- [`PROVENANCE.md`](PROVENANCE.md) — pinned upstream commit SHAs
