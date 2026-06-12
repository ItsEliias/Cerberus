# Native App Pattern — CyberOS Migration Recipe

This document is the canonical recipe for migrating a CyberOS Electron app
into Cerberus as a native same-origin app. Every migrator agent follows this
pattern so parallel migrations do not collide on `static/index.html`.

---

## 1. Existing Cerberus App Pattern

### 1.1 FastAPI Router

Each app lives in a dedicated route file under `routes/<feature>_routes.py`.
The pattern is a **setup function** that returns (or registers) an
`APIRouter`:

```python
# routes/myfeature_routes.py
from fastapi import APIRouter, Request, HTTPException
from core.database import SessionLocal
from src.auth_helpers import get_current_user

def setup_myfeature_routes() -> APIRouter:
    router = APIRouter(prefix="/api/myfeature", tags=["myfeature"])

    def _owner(request: Request):
        return get_current_user(request)

    @router.get("")
    def list_items(request: Request):
        user = _owner(request)
        # ...
        return {"items": []}

    return router
```

Registration in `app.py` (add after existing similar blocks — never inside
existing blocks):

```python
from routes.myfeature_routes import setup_myfeature_routes
app.include_router(setup_myfeature_routes())
```

**Do not** add a `_is_auth_exempt` override. All `/api/cyberapps/*` and
`/static/js/cyberapps/*` paths are same-origin and inherit the existing
Cerberus session-cookie auth automatically.

### 1.2 Auth Integration

`src/auth_helpers.py` exposes two helpers used by every route:

| Helper | Behaviour |
|--------|-----------|
| `get_current_user(request)` | Returns username string or `None` in single-user / auth-disabled mode. Never raises. |
| `require_user(request)` | Returns username or `""` in auth-disabled mode. Raises HTTP 401 in auth-enabled mode if no valid session cookie or API token is present. |

Auth-enabled deploys use an HTTP-only session cookie (`cerberus_session`).
The loopback bypass (`127.0.0.1` internal calls) stamps `request.state` with
an `internal-tool` identity and bypasses the cookie check — do **not** rely
on this in user-facing routes.

API tokens (`X-API-Key` header) are also accepted by `get_current_user`.
Scope validation happens inside the route if needed; see `vault_routes.py`
for the `require_admin` pattern.

### 1.3 Vanilla JS Module

Each feature has a matching ES module at `static/js/<feature>.js`.  The
module is loaded as `<script type="module" src="/static/js/<feature>.js">`.
Convention:

```js
// static/js/myfeature.js
import { fetchJSON } from './util/fetch.js';  // or inline

export async function init() { /* ... */ }
export function destroy() { /* ... */ }
```

Modules are **not** bundled — they are served directly as ES modules.  Use
`import` only for other `/static/js/` paths; do not import npm packages.

### 1.4 Sidebar Entry

Native feature entries in the sidebar are plain `div.list-item` elements:

```html
<div class="list-item" id="sidebar-myfeature-btn" title="My Feature">
  <svg class="sidebar-action-icon" width="14" height="14" ...></svg>
  <span class="grow" style="position:relative;left:-1px;">My Feature</span>
</div>
```

The icon-rail has a corresponding `button.icon-rail-btn`:

```html
<button class="icon-rail-btn" id="rail-myfeature" title="My Feature">
  <svg ...></svg>
</button>
```

> **CyberOS migrators: do NOT add individual sidebar entries or icon-rail
> buttons.** Your app registers via the Cyber Apps registry (section 2 below).
> The panel and pills are the entry point.

### 1.5 Feature Flags / Hide-from-Menu

There is no server-side feature-flag system; features are conditionally
hidden via JS at load time.  Example pattern from `admin.js`:

```js
const isAdmin = window.__CERBERUS_ADMIN__ === true;
document.getElementById('some-admin-btn').style.display = isAdmin ? '' : 'none';
```

`window.__CERBERUS_USER__` and `window.__CERBERUS_ADMIN__` are injected by
the server-side template render in `app.py` (search for `__CERBERUS_USER__`).

### 1.6 Theme Integration

Cerberus uses CSS custom properties on `:root`.  Use these variables — do
**not** hardcode hex values:

| Variable | Value (dark) | Usage |
|----------|-------------|-------|
| `--bg` | `#1a1d23` | Page / panel background |
| `--fg` | `#c5c9d0` | Body text, icons |
| `--red` | `#c0392b` | Crimson accent, active states |
| `--border` | `#3a2a2a` | Panel borders, dividers |
| `--panel` | near `--bg` | Inner panel surfaces |
| `--accent-primary` | set by theme.js | Dynamic accent (may differ from `--red`) |
| `--accent-error` | set by theme.js | Error states |

Light-theme overrides are under `:root.light { ... }`.  Your app's CSS
should always declare both `:root` and `:root.light` variants.

### 1.7 Storage Conventions

| Type | Location | Pattern |
|------|----------|---------|
| Relational data | `data/app.db` (SQLite via SQLAlchemy) | Add model to `core/database.py`, run `Base.metadata.create_all(engine)` at startup |
| Per-feature files | `data/<feature>/` | Use `src/constants.DATA_DIR` as base |
| Encrypted secrets | `data/<feature>/vault.json` (0o600) | See vault pattern below |
| Settings / prefs | `data/prefs_<user>.json` | Use `routes/prefs_routes._load_for_user` / `_save_for_user` |

---

## 2. Cyber Apps Registration Mechanism

### Design Decision: Client-Side Registry

CyberOS apps register via a client-side JS registry file:

```
static/js/cyberapps/registry.js
```

This file sets `window.CYBER_APPS_REGISTRY = []`.  Each migrator **pushes**
an entry to this array.  The bootstrap module (`static/js/cyberapps/index.js`)
reads the registry when the panel opens and renders pills accordingly.

**Rationale for client-side over server-side API:**

- Zero round-trips — panel opens instantly, no `/api/cyberapps/registry` call.
- No Python backend changes per migration — each migrator only touches their
  own JS and route files.
- Single collision-free merge point: parallel migrators each push one entry
  to the array; there is no shared mutable server state to race on.

### Registry Entry Shape

```js
{
  id:      string,    // unique slug, e.g. "cyberlab", "credvault", "netlab"
  name:    string,    // display name in pill nav, e.g. "CyberLab"
  icon:    string,    // inline SVG string (16x16)
  init:    function,  // (container: HTMLElement, ctx: CyberAppContext) => void
  destroy: function,  // () => void
  vault:   boolean,   // true if this app requires vault unlock before init
}
```

### CyberAppContext object

Passed as the second argument to `init(container, ctx)`:

```js
{
  user:          string | null,   // Cerberus username
  theme:         'dark' | 'light',
  onVaultUnlock: (cb: () => void) => void,  // fires when vault is unlocked
}
```

### How to Register Your App

1. Create `static/js/cyberapps/<id>/index.js` with `init` and `destroy`.
2. Load it via a `<script type="module">` tag **before** `app.js` in
   `static/index.html` (add your tag near the other feature modules).
3. Push your entry in your module's top-level code:

```js
// static/js/cyberapps/cyberlab/index.js
function init(container, ctx) { /* render your app */ }
function destroy() { /* cleanup */ }

// Self-register — runs when the module loads
if (window.CYBER_APPS_REGISTRY) {
  window.CYBER_APPS_REGISTRY.push({
    id: 'cyberlab',
    name: 'CyberLab',
    icon: '<svg ...></svg>',
    init,
    destroy,
    vault: true,
  });
}
```

> **Do NOT modify `static/index.html`'s sidebar HTML** (except adding your
> own `<script type="module">` tag for your module in the script block at the
> bottom). The overlay panel and sidebar button are already scaffolded by the
> foundation commit.

---

## 3. Top-Pill Panel UX Contract

### Panel Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  [CERBERUS shield] CYBER APPS  │ [Pill] [Pill] [Pill] ...  │ ✕  │  ← .cyber-apps-pill-nav-bar (sticky)
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    #cyber-apps-content                          │  ← active app mount point
│                    (flex: 1; overflow: auto)                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Pill Click → Mount

1. `_activate(id)` is called.
2. If a different app is currently active, its `destroy()` is called first.
3. The `#cyber-apps-content` div is cleared (`innerHTML = ''`).
4. If the new app has `vault: true` and the vault is not yet unlocked, a
   vault-gate placeholder is rendered instead of calling `init`.
5. Otherwise, `app.init(content, ctx)` is called.

**State across switches**: the content div is cleared on every switch.
Apps that need to preserve state must do so themselves (e.g. `sessionStorage`,
a module-level variable, or a hidden DOM subtree held outside `#cyber-apps-content`).

### Open / Close

- Sidebar button `#sidebar-cyber-apps-btn` toggles the panel.
- Icon-rail button `#rail-cyber-apps` is wired by the same JS pattern as
  other rail buttons (see `sidebar-layout.js`).
- `Esc` closes the panel (wired in `cyberapps/index.js`).
- Clicking any other sidebar item closes the panel (same pattern as
  Command Center and CyberLab).

### Sidebar Dismissal Sync

The panel hides `#chat-container` while open (matches Command Center /
CyberLab behaviour) and restores it on close.

---

## 4. Auth + Vault Contract for Cyber Apps

### Cerberus Session Auth

All Cyber Apps routes live under `/api/cyberapps/<id>/*`.  They are
same-origin, so the existing `cerberus_session` cookie is sent automatically.
Use `get_current_user(request)` in every route handler to scope data to the
authenticated user.  Never trust client-supplied owner identifiers.

### Vault Architecture: ONE Cerberus-Wide Vault

**Decision: a single Cerberus-wide vault, not per-app vaults.**

Rationale:

- Users should not manage multiple master passwords — one password gates all
  apps that need encrypted storage.
- The CyberLab vault (Fernet + PBKDF2-SHA256, 260,000 iterations) is the
  proven reference implementation. Adopt it as-is rather than reinventing
  per-app crypto.

### Vault Unlock Flow

1. On first use, CyberLab (the vault owner) prompts for master-password setup.
2. On subsequent uses, CyberLab (or any vault-gated app) shows an unlock modal.
3. After successful unlock, the app calls:
   ```js
   window.CyberApps.notifyVaultUnlocked();
   // which dispatches: new CustomEvent('cyberapp:vault-unlocked')
   ```
4. `cyberapps/index.js` handles this event: sets `_vaultUnlocked = true` and
   calls all pending `onVaultUnlock` callbacks registered by apps via `ctx.onVaultUnlock`.
5. Apps that were vault-gated and waiting re-mount themselves.

### Vault Backend Endpoint

The vault route lives at `/api/cyberapps/vault/` (to be created by the
CyberLab migrator based on `CyberOS-Cerberus/apps/cyberlab-companion/app.py`):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cyberapps/vault/status` | GET | Is vault initialized? |
| `/api/cyberapps/vault/setup` | POST | First-run: `{password}` → creates salt + sentinel |
| `/api/cyberapps/vault/unlock` | POST | `{password}` → returns short-lived session token |
| `/api/cyberapps/vault/lock` | POST | Clear server-side session token |

**Vault session token**: store server-side in `request.app.state` or a
short-lived in-memory cache keyed by `(user, token_hash)`.  Do NOT persist
the derived Fernet key to disk.  The raw master password never leaves the
client request body and is never logged.

### Storage for Vault-Encrypted Data

```
data/cyberapps/<id>/vault_data.json  — Fernet-encrypted JSON blob
data/cyberapps/vault_salt.hex        — shared PBKDF2 salt (plaintext)
data/cyberapps/vault_sentinel.bin    — known-plaintext block for unlock verification
```

All files chmod 0o600 on POSIX.  Use `src/platform_compat.safe_chmod`.

---

## 5. Build + Test Contract

Before committing, every migrator runs:

```bash
# From Cerberus repo root
python -m py_compile routes/cyberapps_<id>_routes.py
python -m flake8 routes/cyberapps_<id>_routes.py --max-line-length=120 --ignore=E501,W503
# If you added a new SQLAlchemy model:
python -c "from core.database import Base, engine; Base.metadata.create_all(engine)"
# Smoke test — check the server starts:
python app.py &
sleep 3 && curl -s http://127.0.0.1:7000/api/cyberapps/<id> && kill %1
```

JS:

- No bundler — files are served directly. Validate that the module loads
  without console errors in a browser connected to the running Cerberus.
- ES module lint: `npx eslint static/js/cyberapps/<id>/index.js` (if eslint
  is available; not required to block commit).

---

## 6. Branching Contract

| Branch | Purpose |
|--------|---------|
| `feat/cyber-apps-foundation` | Panel scaffold, registry, CSS, SW bump (this commit) |
| `feat/cyberos-<appname>-native` | Per-app migration (one branch per app) |
| `main` | Merge target — single PR per app, approved before merge |

**Consolidation**: after all 13 apps are on their own `feat/cyberos-*`
branches, a final consolidation PR merges them all into a single
`feat/cyberos-all-native` branch before the merge-to-main.

**Collision avoidance**:

- Each migrator only touches:
  - `routes/cyberapps_<id>_routes.py` (new file)
  - `static/js/cyberapps/<id>/index.js` (new file)
  - `static/js/cyberapps/registry.js` (push one entry — single-line append)
  - `static/index.html` (add one `<script type="module">` tag only)
  - `app.py` (add one `include_router` line only)
- Foundation files (`static/js/cyberapps/index.js`, `static/cyberapps.css`,
  `static/index.html` panel HTML) are owned by the foundation branch and
  must not be modified by migrators.

---

## Appendix: Reference Files

| File | Purpose |
|------|---------|
| `routes/note_routes.py` | Notes app — canonical CRUD router pattern |
| `routes/task_routes.py` | Tasks app — canonical pattern with scheduler injection |
| `routes/vault_routes.py` | Vault (Bitwarden CLI) — pattern for encrypted config + `require_admin` |
| `static/js/cyberapps/registry.js` | Empty registry; migrators push entries |
| `static/js/cyberapps/index.js` | Bootstrap: reads registry, renders pills, wires lifecycle |
| `static/cyberapps.css` | Panel + pill styles (Guardian palette) |
| `CyberOS-Cerberus/apps/cyberlab-companion/app.py` | Vault crypto reference (PBKDF2 + Fernet) — READ ONLY, do not modify |
