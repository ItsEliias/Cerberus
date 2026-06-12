# GhostVault Migration Report

**Branch:** `feat/cyberos-ghostvault-native`
**Foundation:** `feat/cyber-apps-foundation` (commit `368fefd`)
**Migrator:** `ghostvault-migrator` agent

---

## What GhostVault Is

GhostVault is the **AI-powered markdown note workspace** of the CYBERTOOLS
ecosystem — described in its own docs as "Obsidian fused with a tactical cyber
workspace." It is the knowledge-management pillar: a place where HTB session
logs, pentest notes, recon output, meeting records, and personal capture land,
get structured via a local AI engine, and are stored.

GhostVault is **distinct from CredVault and VaultCore** in both purpose and
data model:

| App | Data | Primary Purpose |
|-----|------|----------------|
| **CredVault** | Credentials: passwords, hashes, TOTP secrets | Password manager |
| **VaultCore** | Source library + scrape jobs + logs | External vault orchestration / web scraping |
| **GhostVault** | Markdown notes (plain text, structured via AI) | Note capture, editing, AI structuring |

All three share the same Cerberus-wide vault (one master password, one PBKDF2
salt, one Fernet sentinel at `data/cyberapps/vault_sentinel.bin`).

---

## Files Created

### Backend

| File | Lines | Purpose |
|------|-------|---------|
| `routes/cyberapps_ghostvault_vault.py` | 167 | Shared vault helpers (crypto, file I/O, session management). Uses the same salt/sentinel as CyberLab so users only manage ONE master password. Note content is encrypted with a domain-derived Fernet key (`ghostvault-notes-v1`). |
| `routes/cyberapps_ghostvault_models.py` | 40 | Pydantic request models: `NoteCreate`, `NoteUpdate`, `FolderCreate`, `SettingsUpdate`. |
| `routes/cyberapps_ghostvault_routes.py` | 344 | FastAPI router. Endpoints: vault status/unlock/lock (shared), notes CRUD, pin toggle, folders CRUD, stats, settings, health. |

### Frontend

| File | Lines | Purpose |
|------|-------|---------|
| `static/js/cyberapps/ghostvault/index.js` | 464 | App entry point. Vault gate check, app shell (header + tabs), notes tab layout (list + editor split), tab routing, self-registration. |
| `static/js/cyberapps/ghostvault/vault-gate.js` | 99 | Vault unlock / setup-redirect UI. |
| `static/js/cyberapps/ghostvault/note-list.js` | 158 | Searchable, folder-filterable note list with pin indicators and right-click context menu. |
| `static/js/cyberapps/ghostvault/editor.js` | 167 | Note editor: title, content textarea, folder selector, pin toggle, autosave (2s debounce), Cmd+S, word-count statusbar. |
| `static/js/cyberapps/ghostvault/templates.js` | 173 | 28-template library across Work / Cyber / Personal / Pentest / Cheatsheet groups. Clicking a template creates a new note via the API. |
| `static/js/cyberapps/ghostvault/settings-view.js` | 125 | Vault stats (note count, folder count, pinned, total words) + preferences form + lock button. |

### Modified Files

| File | Change |
|------|--------|
| `static/index.html` | Added `<script type="module" src="/static/js/cyberapps/ghostvault/index.js">` before `app.js` |
| `app.py` | Added `include_router(setup_cyberapps_ghostvault_routes())` after companion routes |

---

## API Endpoints

### Shared vault (mirrored in GhostVault router)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cyberapps/vault/status` | Is vault initialized? Locked? |
| POST | `/api/cyberapps/vault/setup` | Returns 501 — use CyberLab to set up |
| POST | `/api/cyberapps/vault/unlock` | Verify master password, return session token |
| POST | `/api/cyberapps/vault/lock` | Clear all session tokens |

### GhostVault-specific

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cyberapps/ghostvault/notes` | List notes (search, folder, tag, pinned filters). Content NOT returned in list. |
| GET | `/api/cyberapps/ghostvault/notes/{id}` | Get single note with full content |
| POST | `/api/cyberapps/ghostvault/notes` | Create note |
| PATCH | `/api/cyberapps/ghostvault/notes/{id}` | Update note |
| DELETE | `/api/cyberapps/ghostvault/notes/{id}` | Delete note |
| POST | `/api/cyberapps/ghostvault/notes/{id}/pin` | Toggle pin |
| GET | `/api/cyberapps/ghostvault/folders` | List folders |
| POST | `/api/cyberapps/ghostvault/folders` | Create folder |
| DELETE | `/api/cyberapps/ghostvault/folders/{name}` | Delete folder |
| GET | `/api/cyberapps/ghostvault/stats` | Note/folder/pinned/word counts |
| GET | `/api/cyberapps/ghostvault/settings` | User preferences |
| POST | `/api/cyberapps/ghostvault/settings` | Save preferences |
| GET | `/api/cyberapps/ghostvault/health` | Health check |

---

## Security Model

- All note *content* is Fernet-encrypted at rest in `data/cyberapps/ghostvault/notes.enc.json`.
- The encryption key is derived from `(vault_salt || "ghostvault-notes-v1")` via PBKDF2-SHA256
  (260,000 iterations, same as CyberLab). This means the key is stable across sessions and
  unique to GhostVault data, without requiring the master password on every read/write.
- The master password is never logged and never persisted to disk beyond the session token TTL.
- The vault session token (`X-Vault-Token` header) has a 15-minute TTL, refreshed on use.
- Content is never returned in list responses — only fetched per-note (minimises exposure).
- Folder names and note titles are stored unencrypted (metadata). Only content is encrypted.
- All routes call `get_current_user(request)` (Cerberus session-cookie auth).
- Vault-requiring routes additionally call `_require_vault(request)` (token check).
- Files: `notes.enc.json`, `folders.json`, `settings.json` stored at `data/cyberapps/ghostvault/`.

---

## Shared Vault Contract

GhostVault uses the **single Cerberus-wide vault**, not a second vault subsystem.
The shared files at `data/cyberapps/vault_salt.hex` and `data/cyberapps/vault_sentinel.bin`
are managed by CyberLab and used read-only by GhostVault (and CredVault, VaultCore).

If the user opens GhostVault before CyberLab has been set up, they see a redirect
message: "Open CyberLab to set up the shared vault first."

---

## Differences from Source Electron App

| Source Feature | Cerberus Implementation |
|---------------|------------------------|
| Vault directory (plain .md files) | JSON store, Fernet-encrypted note content |
| Note editor (textarea, autosave) | Web textarea with 2s autosave, Cmd+S |
| Note list with search | Searchable, folder-filtered note list |
| Folder management | Create/delete folders via API |
| Pin notes | Per-note pin toggle |
| 28 templates (work/cyber/personal/pentest/cheatsheet) | All 28 templates in `templates.js` |
| Vault stats (note count) | `/stats` endpoint + settings view |
| Ecosystem status | Cerberus health endpoint |
| Floating capture window | New note created via API (web context) |
| AI engine (local, offline) | Omitted in v1 — future enhancement via Cerberus model-routing |
| Ollama integration | Omitted in v1 (Cerberus already has a model-routing layer) |
| Theme system (8 themes) | Inherits Cerberus CSS custom properties |

---

## Smoke Test Results

```
python3 -m py_compile routes/cyberapps_ghostvault_vault.py   OK
python3 -m py_compile routes/cyberapps_ghostvault_models.py  OK
python3 -m py_compile routes/cyberapps_ghostvault_routes.py  OK
python3 -m py_compile app.py                                  OK
```
