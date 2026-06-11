# Cerberus — Mission 1 Summary

**Branch**: cerberus
**Tag chain**: phase-1-complete → phase-2-complete → phase-3-complete
**Final commit**: ba1d3fe
**Test suite**: 3174 passed, 0 failed
**Date completed**: 2026-06-11

---

## What was built

Cerberus is a self-hosted, security-hardened AI workspace built in three phases
from three open-source foundations:

| Vendor | Role | License | Pinned SHA |
|--------|------|---------|------------|
| odysseus | Web UI, chat, agent loop, deep research, email, calendar, memory | AGPL-3.0 | see PROVENANCE.md |
| OpenSandbox | Isolated container execution runtime | Apache-2.0 | see PROVENANCE.md |
| hermes-agent | Messaging gateway, cron scheduler | MIT | see PROVENANCE.md |

---

## Phase 0 — Audit

Security audit of odysseus before any real data touched it.

**Findings addressed:**

| ID | Severity | File | Fix |
|----|----------|------|-----|
| C1/C2 | Critical | agent loop, shell routes | Closed by Phase 2 (OpenSandbox) |
| C3 | Critical | routes/shell_routes.py | `shlex.quote()` on tmux cmd interpolation |
| H2 | High | core/middleware.py | `INTERNAL_TOOL_TOKEN` removed from env; unconditional `secrets.token_hex(32)` |
| H3 | High | app.py, docker-compose.yml | `LOCALHOST_BYPASS` permanently removed |

Verdict: **PROCEED WITH FIXES** — audit doc at `SECURITY_AUDIT.md`.

---

## Phase 1 — Rebrand

Full odysseus → Cerberus rename: package name, service names, env prefixes,
UI strings, palette, logo, README. Guardian palette applied across all static
assets. All three security fixes (C3, H2, H3) landed here.

**Files changed**: 200+ (rsync + sed rename pass, then manual corrections)
**Tests after**: 3133 passed, 0 failed

---

## Phase 2 — Secure Execution

Agent bash and python commands now run inside ephemeral OpenSandbox containers
instead of on the host. The `BashTool` and `PythonTool` interface is unchanged —
only the execution backend was swapped.

**New files**:
- `cerberus/src/agent_tools/sandbox_backend.py` — `open_sandbox()`, `run_in_sandbox()`, `run_python_in_sandbox()`
- `cerberus/tests/test_sandbox_phase2.py` — 9 unit tests; 3 live tests gated by `SANDBOX_INTEGRATION_TESTS=1`

**Docker**: `opensandbox-server` service bound to `127.0.0.1:8090`, deny-by-default egress.

**Tests after**: 3142 passed, 0 failed

---

## Phase 3 — Connectivity

Telegram gateway and cron scheduler, harvested from hermes-agent with the
agent-loop seam replaced by `POST /api/chat` on Cerberus's existing REST API.

**New files**:
```
cerberus/gateway/
    __init__.py
    config.py           — all config from env vars
    cerberus_client.py  — the seam: send_message() → POST /api/chat
    main.py             — entry point
    platforms/
        base.py         — BasePlatformAdapter abstract class
        telegram.py     — Telegram long-polling adapter
    scheduler.py        — cron scheduler + platform delivery
cerberus/tests/test_gateway_phase3.py  — 32 tests
```

**Docker**: `cerberus-gateway` service (no exposed ports; Telegram polling is outbound-only).

**Tests after**: 3174 passed, 0 failed

---

## Carried-forward risks

| Risk | Severity | Notes |
|------|----------|-------|
| C1/C2 live escape test not yet run | High | Requires Docker. Live tests exist (`SANDBOX_INTEGRATION_TESTS=1`). Run before trusting real data to the agent. |
| odysseus is AGPL-3.0, not MIT | Medium | Self-hosted private use is fine. Network distribution triggers source-disclosure. Documented in `THIRD_PARTY_LICENSES.md`. |
| Discord/Slack not yet wired | Low | Platform adapter layer is pluggable; adding them is one new file each. |
| Sandbox fallback to host subprocess | Low | When OpenSandbox server is down, `BashTool` falls back to host. Intentional for uptime; disable with `CERBERUS_SANDBOX_ENABLED=false` to force hard-fail if you need guaranteed isolation. |

---

## Repository layout

```
Cerberus/
├── cerberus/                   ← main fork (the product)
│   ├── gateway/                ← Phase 3 (messaging + cron)
│   ├── src/
│   │   └── agent_tools/
│   │       └── sandbox_backend.py  ← Phase 2 (secure execution)
│   ├── docker-compose.yml      ← all services
│   ├── docker-compose.gpu-nvidia.yml
│   ├── docker-compose.gpu-amd.yml
│   └── tests/
│       ├── test_sandbox_phase2.py
│       └── test_gateway_phase3.py
├── vendor/
│   ├── odysseus/
│   ├── OpenSandbox/
│   └── hermes-agent/
├── SECURITY_AUDIT.md
├── PROVENANCE.md
├── PHASE_1_VERIFICATION.md
├── PHASE_2_REPORT.md
├── PHASE_3_REPORT.md
└── MISSION_1_SUMMARY.md        ← this file
```

---

## Launching Cerberus

### Requirements

- Docker Desktop (Mac: install from docker.com/products/docker-desktop)
- Git (already installed)
- A Claude API key (from console.anthropic.com)

### Steps

```bash
cd ~/Documents/Claude/Projects/Cerberus/cerberus

# 1. Copy env template and fill in the minimum required values
cp .env.example .env
```

Edit `.env` — minimum to get the UI working:
```env
CERBERUS_ADMIN_PASSWORD=choose_a_strong_password
OPENAI_API_KEY=sk-ant-...       # or your Anthropic/OpenAI key
```

```bash
# 2. Start the core services (UI + search + memory)
docker compose up cerberus chromadb searxng -d

# 3. Open the UI
open http://127.0.0.1:7000
```

Log in with `admin` and the password you set. The UI loads. Add your model
endpoint in Settings → Endpoints (point it at your Claude API key or a local
Ollama instance). Start chatting.

### To enable Telegram

```bash
# In .env, add:
TELEGRAM_BOT_TOKEN=<token from @BotFather>
CERBERUS_GATEWAY_TOKEN=<generate with: python3 -c "import secrets; print(secrets.token_hex(32))">
TELEGRAM_ALLOWED_CHAT_IDS=<your Telegram numeric chat ID>

# Then:
docker compose up cerberus-gateway -d
```

Send any message to your bot. It routes through Cerberus and replies.

### To verify the sandbox (run once after Docker is up)

```bash
SANDBOX_INTEGRATION_TESTS=1 .venv/bin/pytest tests/test_sandbox_phase2.py -v
```

Three tests run: escape (can't read host `.env`), escape (can't see host
`/etc/passwd` users), egress (outbound network blocked). All three must pass
before you enter real API keys or connect real accounts.

---

## Mission 2 entry criteria (DO NOT START YET)

Mission 2 merges hermes's self-improving learning loop and cross-session memory
into Cerberus's core agent loop. Entry requires:

- [ ] Mission 1 stable and all live tests passing
- [ ] Sandbox boundary proven (live escape/egress tests)
- [ ] Real credentials in use and working end-to-end
- [ ] Explicit human go
