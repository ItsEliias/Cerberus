# PHASE 0 REPORT — Audit & Vendor

Phase: 0 (Audit & Vendor)
Date: 2026-06-11
Agent: cerberus-phase0-auditor (Claude Sonnet 4.6)
Branch: cerberus

---

## What Was Done

1. Created `Projects/Cerberus/` working directory, initialized git repo on the `cerberus` branch with `ItsEliias` identity.
2. Cloned all three source repos into `vendor/`:
   - `pewdiepie-archdaemon/odysseus` @ `d5603ee57551c00e59f9a6c7b4b07075fb66ef6f`
   - `NousResearch/hermes-agent` @ `d1383a6b1450c6c139720b1b01f8b99cc130453f`
   - `opensandbox-group/OpenSandbox` @ `476bb979cb46049e72ad231b25b1fac964ce95d0`
3. Deep security review of odysseus: read `app.py`, `core/auth.py`, `core/middleware.py`, `src/agent_loop.py`, `src/agent_tools/` (all files), `routes/shell_routes.py`, `routes/vault_routes.py`, `docker-compose.yml`, `setup.py`, `.env.example`, `src/tool_execution.py`.
4. Grep audit across the entire odysseus tree (eval, exec, subprocess, network calls, hardcoded credentials, telemetry, external URLs).
5. Light read-through of hermes `gateway/` + `cron/` and OpenSandbox `server/` + Python SDK.
6. Stood up odysseus on `127.0.0.1:7000` with throwaway credentials; confirmed clean boot, admin login flow, and correct port binding.
7. Produced `PROVENANCE.md` and `SECURITY_AUDIT.md`.

---

## What Passed

- Auth system is solid: bcrypt passwords, TOTP with backup codes, reserved-username sentinel protection, session token TTL and revocation on user deletion, atomic JSON writes.
- CORS and CSP are correctly configured for localhost. Security headers middleware present.
- No hardcoded credentials, no telemetry beacons, no active backdoor or exfiltration code found.
- odysseus boots clean on localhost with `AUTH_ENABLED=true`, `LOCALHOST_BYPASS=false`, bound only to `127.0.0.1:7000`.
- Admin account + temp password flow works exactly as documented.
- Path traversal protections exist for the agent's file tools (`_resolve_tool_path`, sensitive-dir deny list).
- Docker Compose keeps all services on localhost binds by default.
- ChromaDB `ANONYMIZED_TELEMETRY=FALSE` is set explicitly.

---

## What Is Risky

### Must fix before any production data is introduced:

1. **Shell injection via LLM-generated commands (C1, C2)** — `BashTool` and the shell routes pass user/LLM content to `create_subprocess_shell`. This is the primary Phase 2 target. Until OpenSandbox sandbox isolation is wired in, the agent can read/write any host file and execute any command under the server's user.

2. **Tmux script injection (C3)** — unquoted `cmd` interpolation in the tmux wrapper script. Fix with `shlex.quote` before Phase 2.

3. **Internal bypass token from env (H2)** — `ODYSSEUS_INTERNAL_TOKEN` env var allows token prediction. Remove env override; generate unconditionally at process start.

### Should fix before multi-user or network-exposed deployment:

4. **TOTP backup codes stored plaintext (M2)** — hash them before storage.
5. **Docker image tags should use SHA digest pins (M6)** — replace date-tags with `@sha256:` digests.
6. **`LOCALHOST_BYPASS` should be removed in Cerberus fork (H3)** — no use case in the production build.
7. **CDN script-src in CSP allows jsdelivr.net (H5)** — vendor static assets locally.

---

## What's Next (Phase 1)

- Operator reviews `SECURITY_AUDIT.md` and gives an explicit go/no-go.
- If go: Phase 1 (rebrand odysseus → Cerberus) can begin. Phases 1 and 2 can run in parallel (minimal file overlap).
- Phase 2 (OpenSandbox integration) must fix C1/C2 before any real credentials or data are loaded.
- Fix C3 and H2 can be done in Phase 1 as part of the code audit pass — they are small one-file changes.

---

## Acceptance Criteria Status

| Criterion | Status |
|-----------|--------|
| `SECURITY_AUDIT.md` with verdict line | DONE |
| Findings ranked critical/high/medium/low with file:line | DONE |
| odysseus boots clean on localhost with throwaway config | DONE — port 7000, 127.0.0.1 only |
| Admin account + temp password flow works | DONE |
| Evidence captured in audit | DONE |
| `PROVENANCE.md` with pinned commits | DONE |
