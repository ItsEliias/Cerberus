# SECURITY AUDIT — Cerberus Phase 0

**Verdict: PROCEED WITH FIXES**

The codebase is a legitimate, actively maintained open-source AI workspace. No active backdoor, credential exfiltration, or malicious code was found. The project has real security awareness (reserved username sentinels, SSRF mitigations, path traversal allowlists, bcrypt auth, TOTP). The findings below are architectural risks, not malice — they are expected for a developer tool and must be addressed before production hardening.

Auditor: cerberus-phase0-auditor (Claude Sonnet 4.6)
Date: 2026-06-11
Commit audited: `d5603ee57551c00e59f9a6c7b4b07075fb66ef6f`

---

## Critical Findings

### C1 — Unsanitized shell injection in BashTool (agent execution path)

**File:line:** `src/agent_tools/subprocess_tools.py:109`

**Description:** `BashTool.execute` passes LLM-generated content verbatim to `asyncio.create_subprocess_shell()`. Shell=True with arbitrary user-supplied (LLM-generated) input is a textbook shell injection surface. Any prompt injection in a user message, a crawled web page, or a document the agent reads can cause arbitrary host command execution.

**Recommended action:** This is the primary motivation for Phase 2 (OpenSandbox integration). Replace `create_subprocess_shell(content, ...)` with `Sandbox.commands.run(content, ...)` via the OpenSandbox Python SDK. Do not attempt partial sanitization — the fix is full sandbox isolation.

---

### C2 — Unsanitized shell command in shell_routes.py (user-facing terminal)

**File:line:** `routes/shell_routes.py:420`, `routes/shell_routes.py:470`, `routes/shell_routes.py:626`

**Description:** The user-facing `/api/shell/exec` and `/api/shell/stream` endpoints pass the `command` field from the JSON request body directly to `asyncio.create_subprocess_shell()`. While the routes are gated by `_require_admin`, an admin account is not fully trusted in a multi-user instance — compromise of any admin account (e.g. via session fixation or TOTP bruteforce) provides unrestricted host RCE.

**Recommended action:** For Phase 2: route shell execution through OpenSandbox. For the short term: add a per-request command allowlist or at minimum document that this endpoint grants full host shell access and must not be exposed beyond localhost.

---

### C3 — Cookbook `_generate_tmux` embeds user command in unquoted bash script

**File:line:** `routes/shell_routes.py:608-616`

**Description:** `_generate_tmux` writes a bash script to a temp file that embeds the raw `cmd` variable without shell-quoting. A command containing `'; rm -rf ~; '` or backticks would escape the script context and execute arbitrary code under the user's shell.

**Recommended action:** Use `shlex.quote(cmd)` when interpolating `cmd` into the script body, or pass `cmd` as a script argument rather than inlining it. Example: `f"set -- {shlex.quote(cmd)}\n$@"`.

---

## High Findings

### H1 — `create_subprocess_shell` used in 19 locations outside the agent

**File:line:** `routes/cookbook_routes.py` (multiple), `routes/codex_routes.py:408`, `services/shell/service.py:56,104`

**Description:** 20 calls to `create_subprocess_shell` exist outside the agent tools. Several in cookbook_routes.py pass pip package names and SSH commands; the cookbook setup commands are partially constrained by allowlists but the SSH host and venv path are user-supplied and validated only by regex. A malformed SSH host could inject arguments.

**Recommended action:** Audit each call site. Where the command is fully static, use `create_subprocess_exec` with an explicit argv list. Where the command depends on user input, validate with a strict allowlist or use `shlex.split` + `create_subprocess_exec`.

---

### H2 — Internal agent bypass token visible via `ODYSSEUS_INTERNAL_TOKEN` env var override

**File:line:** `core/middleware.py:16`

**Description:** `INTERNAL_TOOL_TOKEN` is initialized from `os.environ.get("ODYSSEUS_INTERNAL_TOKEN")`. If someone sets that env var to a known value (e.g., a developer who reads the Docker Compose), they can forge the `X-Odysseus-Internal-Token` header on any loopback request and obtain admin-equivalent access without credentials. In Docker, the env is visible to anyone who can `docker inspect`.

**Recommended action:** Generate the token with `secrets.token_hex(32)` unconditionally at startup; never accept it from the environment. Remove the env override. The token is only useful within the same process, so configurability adds no value and is a liability.

---

### H3 — `LOCALHOST_BYPASS=true` warning is inadequate for Cloudflare/reverse-proxy users

**File:line:** `app.py:169-170`

**Description:** The `LOCALHOST_BYPASS` logic correctly checks for proxy forwarding headers (`_is_trusted_loopback`), but the `.env.example` description is a one-liner and does not explain that tunnels like Cloudflare connect from 127.0.0.1 themselves. A user running odysseus behind a tunnel who sets `LOCALHOST_BYPASS=true` for convenience could unintentionally expose a no-auth endpoint to the internet depending on which headers their tunnel preserves.

**Recommended action:** In the Cerberus fork, remove `LOCALHOST_BYPASS` entirely (set it permanently to `false` in the Docker Compose and `.env`). There is no legitimate use case for Cerberus; it exists as a developer shortcut.

---

### H4 — File path containment only applies to agent tools, not shell_routes

**File:line:** `routes/shell_routes.py` (full file), `src/agent_tools/subprocess_tools.py:109`

**Description:** The `_resolve_tool_path` / `_resolve_tool_path_in_workspace` path allowlist and sensitive-file deny list apply only to `ReadFileTool`, `WriteFileTool`, and `EditFileTool`. The shell endpoint and the `BashTool` can trivially `cat /etc/passwd` or read the host `.env` because they execute arbitrary commands with the full filesystem available.

**Recommended action:** Phase 2 sandbox isolation is the fix. Before Phase 2 is complete, document explicitly that shell access = host filesystem access and ensure no production data is stored on the same host.

---

### H5 — `cdn.jsdelivr.net` in CSP `script-src` allows external script execution

**File:line:** `core/middleware.py:118`

**Description:** The Content-Security-Policy allows scripts from `https://cdn.jsdelivr.net`. If jsdelivr.net is compromised or if a specific package/version at that CDN is malicious, it executes with full page trust. This is a supply-chain risk.

**Recommended action:** Audit which static assets actually load from jsdelivr. Replace CDN references with locally-vendored copies of those files (they belong in `static/vendor/`). Remove the CDN from `script-src` once vendored.

---

## Medium Findings

### M1 — `SECURITY_COOKIES=false` by default in docker-compose.yml

**File:line:** `docker-compose.yml:43`

**Description:** `SECURE_COOKIES=false` means session cookies are not marked `Secure` even when served through HTTPS. If a reverse proxy is used (e.g. Caddy for Tailscale access), the cookie can be sent over an HTTP leg.

**Recommended action:** In Cerberus docker-compose.yml, set `SECURE_COOKIES=true` by default. Document that this requires a trusted HTTPS front-end.

---

### M2 — TOTP backup codes are single-use but stored in plaintext in auth.json

**File:line:** `core/auth.py:442-443`

**Description:** 8-character hex backup codes are stored verbatim in `data/auth.json`. Anyone with read access to the data directory (e.g. via the `data/` bind mount in Docker) can read and consume backup codes.

**Recommended action:** Hash backup codes with bcrypt before storage (same pattern as passwords). Verify on use by iterating and comparing hashes.

---

### M3 — skill_importer fetches arbitrary GitHub raw URLs

**File:line:** `services/memory/skill_importer.py:132`

**Description:** The skill importer constructs a `raw.githubusercontent.com` URL from user-supplied `owner`/`repo`/`ref` components and fetches it. This is an SSRF vector if the components are not validated against a strict allowlist of trusted owners/repos.

**Recommended action:** Add a configurable allowlist of permitted GitHub owners/repos for skill imports. Block fetches to non-GitHub hosts at the importer level.

---

### M4 — `data/auth.json` and `data/sessions.json` have no at-rest encryption

**File:line:** `core/auth.py:113`, `core/auth.py:136`

**Description:** Session tokens and bcrypt hashes are stored in plaintext JSON on disk. An attacker with file-system access (e.g. via the bash tool before sandbox isolation) can exfiltrate sessions and offline-crack weaker passwords.

**Recommended action:** Phase 2 sandbox isolation limits this risk. Additionally, consider `src/secret_storage.py` (already present) for at-rest encryption of session tokens. Accept this risk for Phase 0 given sandbox work is Phase 2.

---

### M5 — `ODYSSEUS_ADMIN_PASSWORD` accepted from env at runtime; visible in docker inspect

**File:line:** `setup.py:93`, `docker-compose.yml:37`

**Description:** The initial admin password can be passed as a Docker environment variable, making it visible via `docker inspect` to any user with Docker socket access.

**Recommended action:** Use Docker secrets instead of env vars for `ODYSSEUS_ADMIN_PASSWORD`. Alternatively, document clearly that this env var must be unset after first boot.

---

### M6 — `searxng` pinned to `2026.5.31-7159b8aed` — not `latest` but also not SemVer

**File:line:** `docker-compose.yml:89`

**Description:** The pinned searxng tag is a date + git hash, not a cryptographic digest. An attacker who could tamper with the Docker Hub registry could serve a malicious image under the same tag.

**Recommended action:** Pin by `@sha256:` digest for all images in the Cerberus docker-compose.yml. This is standard practice for security-sensitive deployments.

---

## Low Findings

### L1 — `app.py` title still "AI Chat Application" — no branding hardening

**File:line:** `app.py:83`

**Description:** The FastAPI app title leaks the upstream project identity in OpenAPI docs at `/docs`. Minor fingerprinting vector.

**Recommended action:** Phase 1 rebrand resolves this.

---

### L2 — `ast.literal_eval` used in tool_parsing.py

**File:line:** `src/tool_parsing.py:199,257`

**Description:** `ast.literal_eval` is not `eval` — it cannot execute arbitrary code. This is safe. Noted here only to confirm it was reviewed.

**Recommended action:** No action needed.

---

### L3 — Boot log contains app structure at INFO level

**File:line:** `app.py` (startup logging)

**Description:** Startup logs at INFO level emit component init status, ChromaDB connectivity, model endpoint URLs, etc. In production this is verbose. Not a security issue for a local-only deployment.

**Recommended action:** Consider DEBUG for noisy startup messages in production config. No urgent action.

---

### L4 — 7-day session TTL with no explicit rotation

**File:line:** `core/auth.py:51`

**Description:** `TOKEN_TTL = 7 days`. Sessions are not rotated on use. A stolen cookie (e.g. via network sniffing before HTTPS is in place) remains valid for up to 7 days.

**Recommended action:** Add session rotation on auth. For Cerberus reduce TTL to 24h or tie it to the admin's preference setting.

---

## Grep Audit Summary

| Pattern | Count (non-test files) | Notes |
|---------|------------------------|-------|
| `create_subprocess_shell` | 20 | See C1, C2, C3, H1 |
| `subprocess.run` / `Popen` | 33 | Mostly setup.py + core/platform_compat.py; not call-path injectable |
| Outbound HTTP (httpx/requests/urllib/aiohttp) | 225 | All are user-initiated API calls (LLM, search, caldav, etc.); no telemetry beacons found |
| Telemetry / analytics endpoints | 0 | No data-to-remote-server calls found; `search/analytics.py` is local query statistics only |
| `eval(` (actual eval) | 0 | Two `ast.literal_eval` calls are safe (L2 above) |
| Hardcoded credentials / "TODO: set real key" | 0 | All secrets come from env vars or runtime user input |
| External hardcoded URLs (non-localhost) | 87 | Legitimate external services: Brave/Tavily/Serper/Google search APIs, GitHub OAuth, GitHub Copilot API, HuggingFace, YouTube, Ollama download links, npm install hints — none are telemetry endpoints |
| ChromaDB `ANONYMIZED_TELEMETRY=FALSE` | 1 | `docker-compose.yml:81` — telemetry explicitly disabled for ChromaDB |

Notable external URLs audited:
- `services/search/providers.py` — Brave, Google, Tavily, Serper, DuckDuckGo: all gated on user-supplied API keys, called only when user initiates a search.
- `src/copilot.py:44` — `https://api.githubcopilot.com` — GitHub Copilot API, user-opt-in only.
- `routes/mcp_routes.py:219-220` — `accounts.google.com` OAuth endpoints — standard OAuth flow, not auto-triggered.
- `services/memory/skill_importer.py:132` — `raw.githubusercontent.com` — see M3.

No phone-home, no analytics beacon, no background exfiltration calls found.

---

## Localhost Stand-up Evidence

**Environment:** macOS Darwin 25.5.0, Python 3.14.5, throwaway credentials only.

**Commands run:**
```
cd vendor/odysseus
python3.14 -m venv /tmp/odysseus-test-venv
/tmp/odysseus-test-venv/bin/pip install -r requirements.txt
ODYSSEUS_ADMIN_USER=testadmin ODYSSEUS_ADMIN_PASSWORD=throwaway123 \
  ODYSSEUS_SKIP_RUN_HINT=1 /tmp/odysseus-test-venv/bin/python setup.py
AUTH_ENABLED=true LOCALHOST_BYPASS=false APP_BIND=127.0.0.1 \
  /tmp/odysseus-test-venv/bin/python -m uvicorn app:app \
  --host 127.0.0.1 --port 7000
```

**Startup result:** Clean boot, no crashes. ChromaDB and MemoryVectorStore degrade gracefully (no Docker Compose stack running — expected). All MCP built-in servers connected.

**Port listen output (lsof -i -P -n | grep LISTEN | grep 127.0.0.1):**
```
Python  36227  codyliddell  10u  IPv4  TCP 127.0.0.1:7000 (LISTEN)
```
Only port 7000 bound. No 0.0.0.0 binding. No other ports.

**Functional checks:**

| Check | Result |
|-------|--------|
| `GET /api/health` | `200 {"status":"healthy"}` |
| `GET /api/version` | `200 {"version":"1.0.0"}` |
| `GET /` (unauthenticated) | `302` redirect to `/login` |
| `POST /api/auth/login` (throwaway creds) | `200 {"ok":true,"username":"testadmin"}` |
| `GET /api/auth/status` (with session cookie) | `200 {"authenticated":true,"username":"testadmin","is_admin":true}` |

**All throwaways deleted after test:** `data/auth.json`, `data/sessions.json`, `.env`, venv at `/tmp/odysseus-test-venv`.

---

## Notes on hermes-agent (gateway slice)

**Scope reviewed:** `gateway/` directory, `cron/` directory, platform adapter list.

**Summary:**
- Platform adapters (Telegram, Slack, Signal, Matrix, Email, DingTalk, Feishu, etc.) are clean. All credentials come from `os.getenv()` — no hardcoded tokens.
- `gateway/shutdown_forensics.py` uses `subprocess.Popen` for a detached post-crash `ps` dump — diagnostic only, not injectable.
- `gateway/run.py:1412` uses `create_subprocess_exec` (not shell=True) — safe.
- No `eval()`, no `exec()`, no outbound telemetry found in the gateway slice.
- The `gateway/config.py` loads all platform credentials (Telegram bot token, Matrix password, etc.) from env vars. Phase 3 must ensure these are passed via Docker secrets or a `.env` not committed to git.
- **Flag for Phase 3:** The gateway's platform adapters expect to reach external messaging APIs (api.telegram.org, etc.). Cerberus's "localhost only" guardrail applies to the Cerberus web UI, not to the gateway's outbound calls to messaging platforms. The gateway is intentionally outbound-network. This is expected behavior; just document it clearly in Phase 3.

---

## Notes on OpenSandbox (server and Python SDK slices)

**Scope reviewed:** `server/opensandbox_server/` (main.py, middleware/auth.py, config.py), `sdks/code-interpreter/python/`.

**Summary:**
- OpenSandbox server is a FastAPI app with API-key auth (`OPEN-SANDBOX-API-KEY` header). Auth middleware correctly exempts health/docs paths only.
- No `eval()`, no `exec()`, no `create_subprocess_shell` found in the server slice.
- The Python SDK (`sdks/code-interpreter/python/`) is a clean HTTP client wrapping the server API.
- Copyright header: Apache-2.0, Alibaba Group Holding Ltd. The NOTICE file must be carried forward per Phase 1 license obligations.
- **Flag for Phase 2:** The `server/opensandbox_server/config.py` `api_key` field must be set to a strong random value in the Cerberus docker-compose.yml. An empty or default API key would allow any loopback caller to create/destroy sandboxes.
- The server supports Docker, Kubernetes, and Firecracker runtimes. For Phase 2, Docker is the right choice; gVisor/Kata can be added later if the host supports it.
