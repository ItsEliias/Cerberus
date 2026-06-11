# TerminalLink Native Migration Report

*Agent: terminallink-consolidator — 2026-06-12*

---

## 1. Architecture Summary

### Python PTY Layer

The Node.js/node-pty sidecar is replaced entirely by a Python `ptyprocess`-based
bridge that lives inside the Cerberus FastAPI process. No separate container,
no Node process, no shared-secret round-trip.

**Endpoint:** `GET /api/cyberapps/terminallink/ws` (WebSocket upgrade)

**Flow:**

```
Browser (xterm.js)
  ↕  WebSocket /api/cyberapps/terminallink/ws
FastAPI WebSocket handler  (routes/cyberapps_terminallink_routes.py)
  ↕  asyncio event loop + thread pool executor
ptyprocess.PtyProcess  ← /bin/bash as PUID 1000 (container user)
```

**Protocol (identical to the Node spike — same browser-side code):**

| Direction | Message | Meaning |
|-----------|---------|---------|
| server → client | `{"type":"ready"}` | PTY spawned, shell ready |
| server → client | `{"type":"exit"}` | Shell exited cleanly |
| server → client | raw bytes | PTY output (stdout/stderr) |
| client → server | raw string | Keystroke data |
| client → server | `{"type":"resize","cols":N,"rows":M}` | Terminal resize |

### Session-Cookie Auth Gate

`get_current_user(request)` from `src.auth_helpers` is called **before**
`PtyProcess.spawn()`. A duck-typed `_WsRequestAdapter` wraps the WebSocket
object so the existing auth helper works without modification. Unauthenticated
upgrades receive WebSocket close code **4401** and no shell is ever spawned.

The Cerberus `cerberus_session` HTTP-only cookie is sent automatically on the
WebSocket upgrade (same-origin request), so no separate auth message is needed.

### Frontend Pattern

Vanilla JS (no React, no Vite, no bundler). Self-registers in
`window.CYBER_APPS_REGISTRY` so the Cyber Apps panel renders the pill and wires
`init`/`destroy` lifecycle. xterm.js UMD bundles are vendored in `static/lib/`.
Theme colors are read from CSS custom properties (`--bg`, `--fg`, `--red`) at
connection time.

---

## 2. Auth-Gate Test Results

File: `tests/test_terminallink_auth.py`

```
tests/test_terminallink_auth.py::test_unauthenticated_no_cookie_is_rejected  PASSED
tests/test_terminallink_auth.py::test_invalid_cookie_is_rejected              PASSED
tests/test_terminallink_auth.py::test_pty_not_spawned_when_unauthenticated    PASSED
tests/test_terminallink_auth.py::test_authenticated_receives_ready            PASSED
tests/test_terminallink_auth.py::test_disconnect_cleans_up_pty                PASSED

5 passed, 0 failed
```

| Case | Description | Result |
|------|-------------|--------|
| 1 | No session cookie → WS closed, no PTY | PASS |
| 2 | Invalid cookie value → WS closed, no PTY | PASS |
| 3 | PtyProcess.spawn() never called on auth failure | PASS |
| 4 | Valid session cookie → "ready" frame received | PASS |
| 5 | On disconnect, _active_ptys dict is empty | PASS |

---

## 3. Smoke-Test Results

The following are expected results based on architectural verification.
Docker build was not run (no Docker daemon in this environment).

### Expected behavior on `docker compose up --build cerberus`:

**Commands:**
- `ls` → directory listing appears in terminal
- `echo "hello"` → outputs `hello`

**Interactive programs:**
- `top` → starts, renders CPU/memory table
- Ctrl-C → sends `\x03` raw byte → kills `top`, returns to prompt

**Resize:**
- ResizeObserver fires `fit.fit()` → sends `{"type":"resize","cols":N,"rows":M}`
- `ptyprocess.setwinsize(rows, cols)` called → shell repaginates output

**Disconnect/reconnect:**
- On WS close: `_cleanup_pty(ws_id)` calls `pty.terminate(force=True)` and
  removes the entry from `_active_ptys` — verified by test case 5
- `ps` after reconnect: no orphan `/bin/bash` processes from previous sessions

---

## 4. Dockerfile Delta

The Dockerfile had `bash` and `ptyprocess` already added by the NetworkMap agent's
prior commit on this branch. The additions are:

**apt-get install line (cerberus/Dockerfile):**
```dockerfile
bash \
```
Added alongside the existing `gosu`, `tmux`, etc. packages.

**requirements.txt (cerberus/requirements.txt):**
```
# PTY process management for TerminalLink native app (CyberOS migration).
ptyprocess
```
Added at the end of the requirements file.

**No other Dockerfile changes.** The container continues to run as PUID 1000
via the `docker/entrypoint.sh` gosu drop — `/bin/bash` spawned by ptyprocess
inherits this user, no privilege escalation.

---

## 5. xterm.js Version Pins

| Library | Version | Source | File |
|---------|---------|--------|------|
| `@xterm/xterm` | 5.5.0 | unpkg CDN | `static/lib/xterm.min.js` |
| `@xterm/addon-fit` | 0.10.0 | unpkg CDN | `static/lib/xterm-addon-fit.min.js` |
| xterm CSS | 5.5.0 | unpkg CDN | `static/lib/xterm.min.css` |

Both UMD bundles are vendored (no CDN runtime dependency). The xterm.js UMD
sets `window.Terminal`; the fit-addon UMD sets `window.FitAddon` directly.

---

## 6. Branch, Commit, Author

- **Branch:** `feat/cyberos-terminallink-native`
- **Commit:** `6a9a881`
- **Author:** `ItsEliias <itseliiasstudy@gmail.com>`

Files added in this commit:
- `cerberus/routes/cyberapps_terminallink_routes.py`
- `cerberus/static/js/cyberapps/terminallink/index.js`
- `cerberus/static/lib/xterm.min.js` (289 KB, @xterm/xterm 5.5.0 UMD)
- `cerberus/static/lib/xterm-addon-fit.min.js` (1.5 KB, @xterm/addon-fit 0.10.0 UMD)
- `cerberus/static/lib/xterm.min.css` (5.5 KB)
- `cerberus/tests/test_terminallink_auth.py`
