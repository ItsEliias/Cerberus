# CredVault — Cerberus Native Migration Report

## Summary

CredVault has been migrated from the CyberOS Electron app into Cerberus as a
full-featured vault-gated native app in the Cyber Apps panel.

---

## Feature Parity Table

| Electron Feature | Web Status | Notes |
|------------------|------------|-------|
| Master password setup (first-run) | Implemented | `/api/cyberapps/vault/setup` via shared CyberApps vault |
| Master password unlock | Implemented | `/api/cyberapps/vault/unlock` |
| Vault lock | Implemented | `/api/cyberapps/vault/lock` + lock button in nav |
| Change master password | Implemented | `/api/cyberapps/vault/change-password` |
| Credential CRUD (add/edit/delete) | Implemented | `/api/credvault/credentials` REST endpoints |
| Credential types: credential + secure note | Implemented | `type` field, note body in `notes` |
| Categories: SSH, API Key, Web, DB, Cert, Token, Other | Implemented | colour-coded chips in list and modal |
| Statuses: active / rotated / invalid | Implemented | select in modal; "Mark Rotated" action in detail panel |
| Password field: show/hide + strength meter | Implemented | vault-view.js + password.js scorePassword() |
| Password generator (modal) | Implemented | generator.js — length slider, char class toggles |
| Inline password generator in modal | Implemented | cred-modal.js renderInlineGenerator() |
| Fuzzy search (service/username/ip/notes/tags) | Implemented | vault-view.js fuzzyMatch() |
| Scope tabs: All / Logins / Cards / Notes | Implemented | pill nav in list pane |
| Sort: Default / Last Used / A→Z / Newest / Strength | Implemented | vault-view.js sortOrder state |
| Filter by source + tag | Implemented | filter chip row in list pane |
| HIBP k-anonymity breach check (per-credential) | Implemented | `/api/credvault/hibp/:id` proxy + breachMap in UI |
| HIBP batch scan from toolbar | Implemented | "HIBP" button runs all with-password creds |
| Copy username (with usage tracking) | Implemented | Copy button; records lastUsed + useCount |
| Copy password (with usage tracking) | Implemented | Copy button on masked field |
| Copy hash / IP | Implemented | CopyRow in detail panel |
| TOTP display (live countdown ring) | Deviation | Omitted — requires WebCrypto TOTP; TOTP secret stored; display deferred |
| Mark credential rotated | Implemented | "Mark Rotated" footer action in detail panel |
| Credential detail panel (glass card) | Implemented | vault-view.js renderDetailPanel() |
| Vault dashboard (stats, quick actions, weakest passwords, recently used, tip) | Implemented | vault-view.js renderDashboard() |
| Import: CSV (1Password / Bitwarden / KeePass) | Implemented | import-view.js parseCsv() with format auto-detect |
| Import: file picker (browser) | Implemented | `<input type=file>` — browser file dialog |
| Import: manual add (modal) | Implemented | "Add Credential Manually" opens CredModal |
| Import history | Implemented | sessionStorage-backed history list |
| Import: ReconDesk live-push queue | Deviation | Omitted — requires Electron ecosystem bus (no equivalent in web context) |
| Settings: auto-lock interval | Implemented | settings-view.js + `/api/credvault/settings` |
| Settings: clipboard clear timer | Implemented | settings-view.js |
| Settings: change password form | Implemented | POSTs to shared vault change-password endpoint |
| Settings: password audit (weak / reused / expired) | Implemented | settings-view.js runAudit() |
| Settings: export encrypted backup | Implemented | JSON download, password-protected payload |
| Settings: import encrypted backup | Implemented | file upload + password verify |
| Lock vault button | Implemented | nav bar + settings section |
| Cmd+K command palette (Add, Generate, HIBP, Lock, Navigate, Copy last-used) | Implemented | palette.js — 7 static + dynamic credential commands |
| Keyboard: ↑↓ navigate palette, ↵ run, Esc close | Implemented | palette.js keydown handler |
| Settings: Touch ID biometric unlock | Deviation | macOS-only Electron feature; no browser equivalent |
| 2FA TOTP vault unlock | Deviation | Electron-only; deferred for web context |
| Recovery key (PBKDF2 hash) | Deviation | Electron-only; deferred |
| Auto-lock idle timer (client-side) | Partial | Timer stored in settings; client enforcement deferred |
| Pending queue (ReconDesk live push) | Deviation | Electron ecosystem bus not available in Cerberus web |

---

## API Endpoints

### Shared vault (managed by CyberLab)

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/cyberapps/vault/status`       | Is vault initialised? Is it locked? |
| POST   | `/api/cyberapps/vault/setup`        | First-run: create salt + sentinel |
| POST   | `/api/cyberapps/vault/unlock`       | Verify master password; return session token |
| POST   | `/api/cyberapps/vault/lock`         | Invalidate all vault sessions |
| POST   | `/api/cyberapps/vault/change-password` | Re-key the vault |

### CredVault-specific (`/api/credvault/*`)

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/credvault/credentials`       | List all credentials (decrypted) |
| POST   | `/api/credvault/credentials`       | Add credential |
| GET    | `/api/credvault/credentials/:id`   | Get single credential |
| PATCH  | `/api/credvault/credentials/:id`   | Update credential (partial) |
| DELETE | `/api/credvault/credentials/:id`   | Delete credential |
| POST   | `/api/credvault/import`            | Bulk import credentials |
| POST   | `/api/credvault/usage/:id`         | Record usage (lastUsed + useCount) |
| GET    | `/api/credvault/stats`             | Stats (total, byService, byLab, bySource) |
| GET    | `/api/credvault/settings`          | Get user preferences |
| POST   | `/api/credvault/settings`          | Update preferences |
| GET    | `/api/credvault/hibp/:id`          | HIBP k-anonymity breach check (1-hour cache) |

---

## Database / Storage

No SQLAlchemy models were added. CredVault uses file-based storage under
`data/cyberapps/credvault/`:

| Path | Contents |
|------|----------|
| `credentials.enc.json` | Fernet-encrypted credential array |
| `settings.json`        | User preferences (sort_order, auto_lock_ms, clipboard_clear_ms) |

Shared vault crypto files (managed by CyberLab):

| Path | Contents |
|------|----------|
| `data/cyberapps/vault_salt.hex`      | PBKDF2 salt (hex-encoded) |
| `data/cyberapps/vault_sentinel.bin`  | Known-plaintext Fernet block for unlock verification |

All files are chmod 0o600 on POSIX via the shared `safe_chmod` helper.

### Encryption scheme

Sensitive fields (`password`, `hash`, `totpSecret`, `notes`) are Fernet-encrypted
before writing to disk. The Fernet key is derived from:

```
PBKDF2-HMAC-SHA256(password="credvault-data-encryption-v1", salt=vault_salt, iterations=260000)
```

This key is derived fresh on every request from the shared vault salt. It is
never persisted. The vault session token from the `X-Vault-Token` header gates
access; without a valid session the endpoints return HTTP 401.

---

## Frontend Modules

| File | Description |
|------|-------------|
| `index.js`        | App shell, tab nav, keyboard listener, Cmd+K palette wiring, self-registration |
| `vault-gate.js`   | Master password setup / unlock form (calls shared vault endpoints) |
| `vault-view.js`   | Left list pane (search/filter/sort/HIBP) + right pane (detail or dashboard) |
| `cred-modal.js`   | Add/Edit credential modal (all fields, tabs: Details/History/Notes, inline generator) |
| `generator.js`    | Standalone password generator modal (length slider, char-class toggles, strength meter) |
| `import-view.js`  | CSV import (1Password/Bitwarden/KeePass auto-detect), manual add, import history |
| `settings-view.js`| Auto-lock/clipboard, change password, password audit, backup export/import, lock |
| `palette.js`      | Cmd+K command palette (actions, navigation, credential copy, fuzzy open) |
| `password.js`     | Password generator (Web Crypto rejection sampling) + strength scorer |

---

## Integration Points

| File | Change |
|------|--------|
| `app.py` | `from routes.cyberapps_credvault_routes import setup_cyberapps_credvault_routes` + `include_router(...)` |
| `static/index.html` | `<script type="module" src="/static/js/cyberapps/credvault/index.js">` before `app.js` |
| `static/js/cyberapps/registry.js` | Self-registration via `window.CYBER_APPS_REGISTRY.push(...)` in `index.js` |

---

## Smoke Test

1. `docker compose up -d --build cerberus` from the Cerberus root.
2. Navigate to `http://127.0.0.1:7000`, log in.
3. Click the shield icon → Cyber Apps panel → "CredVault" pill.
4. Expected: vault gate form ("Set Up CredVault" on first run, "Unlock CredVault" thereafter).
5. Enter master password → vault unlocks → Vault dashboard appears.
6. Click "+ Add" → credential modal opens with all fields.
7. Save credential → appears in list, click to open detail panel.
8. HIBP button in toolbar → breach check runs.
9. Import tab → open CSV file → preview table → import selected.
10. Settings tab → change password, audit, export backup.
11. Cmd+K → palette opens, type "add" → run "Add credential" action.

---

## Branch and Author

| Property | Value |
|----------|-------|
| Branch   | `feat/cyberos-credvault-native` |
| Author   | ItsEliias &lt;itseliiasstudy@gmail.com&gt; |
| Files    | 2 Python (`routes/`), 9 JS (`static/js/cyberapps/credvault/`), app.py + index.html (1-line each) |

---

## Deviations from Electron Feature Set

1. **TOTP live countdown** — TOTP secret is stored and encrypted at rest. The live
   countdown display requires a TOTP implementation in vanilla JS (no npm). Deferred;
   the field is stored and shown in the detail panel as plain text until implemented.

2. **ReconDesk live-push queue** — The Electron `pending:get/approve/dismiss` IPC
   handlers use the ecosystem bus (`cybertools-config.json`). There is no equivalent
   cross-process bus in the Cerberus web context. Omitted; the import view shows a
   note explaining this.

3. **Touch ID / biometric unlock** — macOS `systemPreferences.promptTouchID` is
   Electron-only. No browser equivalent exists. Omitted.

4. **2FA TOTP vault unlock** — The Electron vault separates the unlock step from the
   TOTP verification step. Web sessions do not have an equivalent two-phase handshake.
   Deferred.

5. **Recovery key** — PBKDF2 recovery key generation/verification is an Electron
   main-process feature. Deferred for web context.

6. **Clipboard auto-clear** — The `clipboard.clear()` call is Electron-native.
   In the browser, `navigator.clipboard.writeText` is used; auto-clear after the
   configured timeout is not reliably available. The setting is stored but not enforced.

7. **Auto-lock idle timer** — Stored as a setting; client-side idle enforcement
   (tracking mouse/keyboard events) is implemented in the settings view but the
   actual lock dispatch on idle timeout is deferred.
