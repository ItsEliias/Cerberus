# Cyber Apps Bugfixes Round 1

**Branch:** `feat/cyber-apps-bugfixes-r1`
**Commit:** `43bef87`
**Author:** ItsEliias <itseliiasstudy@gmail.com>

---

## Bug #1 — TerminalLink WebSocket: "Connection closed" immediately on open

### Root Cause

Starlette's `BaseHTTPMiddleware` does **not** dispatch for WebSocket upgrade requests. The `AuthMiddleware` class in `app.py` extends `BaseHTTPMiddleware`, which means its `dispatch()` method is never called during a WS handshake. As a result, `request.state.current_user` is never stamped on the WebSocket object.

`_get_ws_user()` in `routes/cyberapps_terminallink_routes.py` first tries `ws.state.current_user` (always None for WS) then falls back to `get_current_user(adapter)`, which reads `request.state.current_user` — also None. The function returns `None`, the handler closes with code 4401, and the frontend shows "DISCONNECTED — Connection closed."

Confirmed by:
```
docker exec cerberus-cerberus-1 python -c "
import inspect, starlette.middleware.base as m
src = inspect.getsource(m.BaseHTTPMiddleware)
print('ws handled' if 'websocket' in src.lower() else 'WS NOT handled by BaseHTTPMiddleware')
"
# Output: WS NOT handled by BaseHTTPMiddleware
```

### Fix

`routes/cyberapps_terminallink_routes.py`:

- `_get_ws_user()` now reads `ws.cookies.get("cerberus_session")` directly and validates it via `ws.app.state.auth_manager.validate_token()` and `get_username_for_token()` — the same validation the HTTP middleware performs, inlined for the WS path.
- Handles three edge cases: `AUTH_ENABLED=false` (returns `_anon`), unconfigured/first-run (allows loopback only), missing auth_manager (falls back to adapter path).
- Shell resolution improved: `TERMINALLINK_DEFAULT_SHELL` env var → `SHELL` env var → `/bin/bash` if present → `/bin/sh` (always present). Eliminates silent failures when `SHELL` is unset in the container.
- PTY spawn errors now send an explicit `{"type":"error","message":"..."}` frame before close — the frontend overlay can show the actual reason.

### Verification

```
# 5/5 auth-gate tests pass:
docker exec cerberus-cerberus-1 python -m pytest tests/test_terminallink_auth.py -v
# All PASSED: unauthenticated rejected, invalid cookie rejected,
#             PTY not spawned for unauth, ready frame received for auth,
#             disconnect cleans up PTY dict.

# Live test:
# Click TerminalLink pill → shell prompt appears → echo hello → "hello"
```

---

## Bug #2 — Vault-gated apps show useless lock screen

### Root Cause

`_renderVaultPrompt(app, container)` in `static/js/cyberapps/index.js` injected a static HTML message: "Enter your master password in the vault prompt to continue." There was no vault prompt anywhere on the page for vault-gated apps that are not CyberLab. The only unlock UI existed deep inside CyberLab's own module (`static/js/cyberapps/cyberlab/vault.js` using ES module `export`), making it inaccessible to the bootstrap IIFE.

### Fix

**New file:** `static/cyberapps/vault-gate.js` (served as `/static/cyberapps/vault-gate.js`)

Exposes `window.CyberAppsVaultGate.render(container, onUnlocked)`:

1. `GET /api/cyberapps/vault/status` — checks `initialized` field.
2. If `initialized=false` → renders setup form (confirm password, min 8 chars).
3. If `initialized=true` → renders unlock form.
4. On success: calls `onUnlocked()`, dispatches `cyberapp:vault-unlocked` event.
5. All other vault-gated apps immediately unlock via the existing event listener in the bootstrap.

**Modified:** `static/js/cyberapps/index.js`

`_renderVaultPrompt()` now calls `CyberAppsVaultGate.render(container, callback)` if available. On callback success: sets `_vaultUnlocked = true` and calls `_activate(app.id)` to mount the original app. Falls back to a static "reload the page" message if the helper is not yet loaded.

**Modified:** `static/index.html`

Added `<script src="/static/cyberapps/vault-gate.js"></script>` immediately before `<script type="module" src="/static/js/cyberapps/index.js"></script>` so the helper is always available when the bootstrap runs.

### UX Flow (as text)

```
User clicks CredVault pill
  → _renderVaultPrompt() called
  → CyberAppsVaultGate.render() fetches /api/cyberapps/vault/status
    → {initialized: false}  → Setup form shown inline:
         [Create Vault Password]  [===password input===]
         [Confirm Password]       [===password input===]
                                  [Create Vault]
    → Submit → POST /api/cyberapps/vault/setup → {session_token: ...}
    → onUnlocked() → _vaultUnlocked = true → _activate('credvault')
    → CredVault app mounts

User clicks CyberLab pill
  → _vaultUnlocked is already true
  → app.init() called directly (no gate)

Container restart → repeat from top (now initialized=true → unlock form)
```

---

## Bug #3 — Claude Subscription provider has endpoints but no UI

### Root Cause

The `feat/claude-subscription-provider` branch added the backend (`routes/claude_subscription_routes.py`, `src/claude_subscription.py`) and all 17 tests, but no Settings UI entry point. Users could not find or provision the provider from the interface.

### Fix

**Modified:** `static/index.html` — Added a "Claude (Subscription)" card inside the `data-settings-panel="services"` panel (Add Models tab), after the "Added Models" section:

- Shield icon + heading
- Description: "Local Claude Code subscription — uses your `claude` CLI OAuth. No API key required."
- Status area: shows preflight result inline (binary path, logged-in state, actionable error)
- Enable button: calls `POST /api/claude-subscription/provision` — disabled when preflight fails
- Remove button: calls `DELETE /api/claude-subscription/remove`
- "Provisioned" badge: shown when endpoint row exists

**Modified:** `static/js/admin.js` — Added `initClaudeSubscriptionCard()` function (wired into `initAll()`):

- On init: calls `GET /api/claude-subscription/status` to populate status and set button states
- Enable click: provisions endpoint, refreshes status + endpoint list (chat model picker updates automatically via `loadEndpoints()`)
- Remove click: removes endpoint row, refreshes both

**Modified:** `routes/claude_subscription_routes.py` — The `GET /api/claude-subscription/status` endpoint now returns two additional fields:
- `provisioned`: `true` if a Claude Subscription endpoint row exists for this user
- `logged_in`: mirrors `ok` for UI-readable display

### Provision Flow

```
Settings → Add Models → Claude (Subscription) card
  Status: "claude binary: /usr/local/bin/claude | logged in: yes"
  [Enable] button active

Click Enable
  → POST /api/claude-subscription/provision
  → ModelEndpoint row created with base_url="claude-subscription://local"
  → Badge: [Provisioned]  [Remove] button appears

Open chat → model picker → "Claude (Subscription)" present
  → send message → subprocess: claude -p --tools "" --output-format stream-json ...
  → response streams via SSE, renders normally
```

---

## Files Changed

| File | Change |
|------|--------|
| `routes/cyberapps_terminallink_routes.py` | Bug #1 fix — WS auth, shell resolution, error frames |
| `static/cyberapps/vault-gate.js` | Bug #2 — new shared vault gate UI module |
| `static/js/cyberapps/index.js` | Bug #2 — _renderVaultPrompt uses CyberAppsVaultGate |
| `static/index.html` | Bug #2 (script tag) + Bug #3 (subscription card HTML) |
| `static/js/admin.js` | Bug #3 — initClaudeSubscriptionCard() |
| `routes/claude_subscription_routes.py` | Bug #3 — status adds provisioned + logged_in fields |

## Test Results

```
tests/test_terminallink_auth.py — 5/5 PASSED
```
