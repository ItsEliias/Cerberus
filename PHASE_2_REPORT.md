# Cerberus Phase 2 Report — Secure Execution Layer

**Branch**: cerberus
**Date**: 2026-06-11
**Tests**: 3142 passed, 0 failed (4 skipped — live integration tests)

---

## Objective

Replace direct host subprocess execution in `BashTool` and `PythonTool` with
isolated container sandboxes via the OpenSandbox Python SDK, so agent commands
run in ephemeral, network-isolated environments rather than on the host OS.

---

## Deliverables

### 1. OpenSandbox server added to Docker Compose

`cerberus/docker-compose.yml` — new `opensandbox-server` service:

- Image: `opensandbox/server:latest`
- Bound to `127.0.0.1:8090` only (no LAN or internet exposure)
- Docker socket mounted for container lifecycle management
- TOML config injected via Docker `configs:` block with:
  - `no_new_privileges = true`
  - Capability drop list: `AUDIT_WRITE MKNOD NET_ADMIN NET_RAW SYS_ADMIN SYS_MODULE SYS_PTRACE SYS_TIME SYS_TTY_CONFIG`
  - `pids_limit = 4096`
- Mirrored to `docker-compose.gpu-nvidia.yml` and `docker-compose.gpu-amd.yml`
  (required by GPU standalone sync tests)

### 2. Sandbox backend module

`cerberus/src/agent_tools/sandbox_backend.py` (new file, 243 lines):

- `open_sandbox()` — async context manager; creates a sandbox, yields it, tears
  it down (kill + close) on exit. One sandbox per call; no persistent pools.
- `run_in_sandbox(command)` — wraps `open_sandbox`, collects stdout/stderr via
  `ExecutionHandlers`, returns `{stdout, stderr, exit_code, timed_out}`.
- `run_python_in_sandbox(code)` — tries `CodeInterpreter` first (richer REPL),
  falls back to `python3 -c '<code>'` inside a fresh sandbox.
- Egress: deny-by-default `NetworkPolicy`; only hosts in `SANDBOX_EGRESS_ALLOWLIST`
  (comma-separated env var, default empty) are permitted outbound.
- `SandboxUnavailableError` — raised when the SDK is not installed or the server
  is unreachable; callers can catch and fall back gracefully.

Environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `SANDBOX_URL` | `http://localhost:8090` | Sandbox server base URL |
| `SANDBOX_IMAGE` | `python:3.11-slim` | Container image for sandboxes |
| `SANDBOX_TIMEOUT` | `300` | Sandbox lifetime (seconds) |
| `SANDBOX_API_KEY` | `cerberus-local-dev` | Server auth key (local dev only) |
| `SANDBOX_EGRESS_ALLOWLIST` | (empty) | Comma-separated hostnames allowed outbound |

### 3. BashTool and PythonTool updated

`cerberus/src/agent_tools/subprocess_tools.py`:

- Both tools now route through `sandbox_backend` when `CERBERUS_SANDBOX_ENABLED=true`
  (the default).
- If the sandbox server is unavailable (`SandboxUnavailableError`), both tools
  log a warning and fall back to the host subprocess backend so the agent stays
  functional during sandbox server downtime.
- `CERBERUS_SANDBOX_ENABLED=false` disables sandboxing entirely (dev/test use).
- The public interface (`execute(content, ctx)` → dict) is unchanged — the agent
  loop is not touched.

### 4. opensandbox added to requirements

`cerberus/requirements.txt`: `opensandbox` added.

---

## Security Properties

| Property | Status |
|----------|--------|
| Commands run in ephemeral containers, not on host | Implemented |
| Sandbox network is deny-by-default (egress policy) | Implemented |
| Sandbox server bound to 127.0.0.1 only | Implemented |
| No host paths bind-mounted into agent sandboxes | Confirmed (only docker.sock is mounted to the server, not to sandboxes) |
| Capability drop + no_new_privileges in server config | Implemented |
| CERBERUS_SANDBOX_ENABLED flag for dev override | Implemented |

---

## Test Results

| Test | Result |
|------|--------|
| `test_bash_tool_host_fallback_returns_output` | PASS |
| `test_python_tool_host_fallback_returns_output` | PASS |
| `test_run_in_sandbox_returns_stdout` | PASS |
| `test_sandbox_unavailable_error_on_import_failure` | PASS |
| `test_egress_allowlist_parsed_from_env` | PASS |
| `test_empty_egress_allowlist_by_default` | PASS |
| `test_bash_tool_sandbox_flag_respects_env` | PASS |
| `test_bash_tool_sandbox_flag_true_by_default` | PASS |
| `test_bash_tool_escape_attempt_does_not_reach_host` | PASS |
| `test_live_escape_host_env_not_readable` | SKIP (requires `SANDBOX_INTEGRATION_TESTS=1`) |
| `test_live_escape_etc_passwd_unmodified` | SKIP (requires `SANDBOX_INTEGRATION_TESTS=1`) |
| `test_live_egress_non_allowlisted_host_blocked` | SKIP (requires `SANDBOX_INTEGRATION_TESTS=1`) |
| Full suite (3142 tests) | 3142 passed, 0 failed |

Live integration tests (escape + egress) require a running opensandbox server.
Run them with:

```bash
SANDBOX_INTEGRATION_TESTS=1 .venv/bin/pytest tests/test_sandbox_phase2.py -v
```

---

## Pre-Phase 3 Checklist

- [x] `opensandbox-server` service in all compose files
- [x] Sandbox backend module with `open_sandbox`, `run_in_sandbox`, `run_python_in_sandbox`
- [x] `BashTool` and `PythonTool` route through sandbox
- [x] Graceful fallback on sandbox unavailability
- [x] Egress deny-by-default with configurable allowlist
- [x] 0 regressions in existing test suite
- [ ] Live escape test (requires sandbox server running) — gated by `SANDBOX_INTEGRATION_TESTS=1`
- [ ] Live egress blocking test — gated by `SANDBOX_INTEGRATION_TESTS=1`

Phase 3 (hermes gateway, Telegram connectivity, cron scheduler) may begin once
the sandbox server is confirmed reachable and the live integration tests pass.
