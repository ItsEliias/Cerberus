# VaultCore Migration Report

Branch: `feat/cyberos-vaultcore-native`
Commit: `3862fe9`
Date: 2026-06-12
Migrator: `vaultcore-migrator` agent

---

## What Was Built

VaultCore — the CYBERTOOLS vault orchestration and scraping engine — has been
migrated as a native Cerberus CyberApp following the NATIVE_APP_PATTERN.md
contract.

### Feature Inventory (from Electron source)

| Electron Feature | Cerberus Native Implementation |
|---|---|
| Source Library (CRUD) | Full CRUD at `/api/cyberapps/vaultcore/sources` |
| Scrape job queue | Job queue at `/api/cyberapps/vaultcore/jobs` |
| 11 source types | All types validated: website, github, obsidian-publish, youtube, pdf, reddit, twitter, notion, medium, cve, rss |
| Vault health stats | Aggregated stats at `/api/cyberapps/vaultcore/health` |
| Scrape logs | Log store at `/api/cyberapps/vaultcore/logs` with filter + clear |
| Settings | Vault path, conflict strategy, scrape defaults, post-processing flags |
| Schedule per source | Stored in source config (cron expression, enabled flag) |
| Conflict strategies | skip / overwrite / keepBoth validated at API boundary |
| Vault encryption gate | Shared CyberLab Fernet/PBKDF2-SHA256 vault (one password for all apps) |

**Features deferred** (require Node.js/Playwright runtime not available in Python/web):
- Live scraping execution (Playwright headless Chromium)
- Auto-tagging (200+ keyword scan of scraped markdown)
- Auto-wikilinks generation
- PDF text extraction
- Note splitter / duplicate detector / dead link finder

These are flagged as "queued" in the job system — the job record is created and
persisted, ready for a future scraping engine integration.

---

## Files Created

### Backend

| File | Lines | Purpose |
|---|---|---|
| `routes/cyberapps_vaultcore_vault.py` | 151 | Shared vault crypto, path constants, file I/O |
| `routes/cyberapps_vaultcore_models.py` | 58 | Pydantic request models |
| `routes/cyberapps_vaultcore_routes.py` | 344 | FastAPI router — all endpoints |

### Frontend

| File | Lines | Purpose |
|---|---|---|
| `static/js/cyberapps/vaultcore/index.js` | 273 | App shell, vault gate, tab router, registry registration |
| `static/js/cyberapps/vaultcore/vault.js` | 85 | Vault unlock form / CyberLab redirect |
| `static/js/cyberapps/vaultcore/sources.js` | 229 | Source library with CRUD modal and search |
| `static/js/cyberapps/vaultcore/scrape.js` | 270 | New job form + recent jobs list |
| `static/js/cyberapps/vaultcore/health.js` | 111 | Vault health stats grid |
| `static/js/cyberapps/vaultcore/logs.js` | 97 | Log viewer with filter |
| `static/js/cyberapps/vaultcore/settings.js` | 138 | Settings form |

All files under 500 lines. Zero external npm dependencies.

### Modified Files

| File | Change |
|---|---|
| `app.py` | Added `include_router(setup_cyberapps_vaultcore_routes())` |
| `static/index.html` | Added `<script type="module" src="/static/js/cyberapps/vaultcore/index.js">` |

---

## API Surface

### Vault (shared with CyberLab)

| Endpoint | Method | Description |
|---|---|---|
| `/api/cyberapps/vault/status` | GET | Vault initialized? locked? |
| `/api/cyberapps/vault/setup` | POST | Returns 501 — use CyberLab to initialize |
| `/api/cyberapps/vault/unlock` | POST | `{password}` → session token |
| `/api/cyberapps/vault/lock` | POST | Clear in-memory sessions |

### VaultCore

| Endpoint | Method | Description |
|---|---|---|
| `/api/cyberapps/vaultcore/sources` | GET | List sources (optional `?q=` search) |
| `/api/cyberapps/vaultcore/sources` | POST | Create source |
| `/api/cyberapps/vaultcore/sources/{id}` | PATCH | Update source |
| `/api/cyberapps/vaultcore/sources/{id}` | DELETE | Delete source |
| `/api/cyberapps/vaultcore/jobs` | GET | List jobs (optional `?limit=`) |
| `/api/cyberapps/vaultcore/jobs` | POST | Queue scrape job |
| `/api/cyberapps/vaultcore/jobs/{id}` | GET | Get job by ID |
| `/api/cyberapps/vaultcore/jobs/{id}` | DELETE | Remove job record |
| `/api/cyberapps/vaultcore/logs` | GET | List logs (optional filters) |
| `/api/cyberapps/vaultcore/logs` | DELETE | Clear all logs |
| `/api/cyberapps/vaultcore/health` | GET | Aggregate health stats |
| `/api/cyberapps/vaultcore/settings` | GET | Get settings |
| `/api/cyberapps/vaultcore/settings` | POST | Save settings |

---

## Data Storage

```
data/cyberapps/
  vault_salt.hex          — shared PBKDF2 salt (plaintext, 0o600)
  vault_sentinel.bin      — shared unlock verification block (0o600)
  vaultcore/
    vc_sources.json       — source library
    vc_jobs.json          — scrape job queue
    vc_logs.json          — scrape logs (capped at 1000 entries)
    vc_settings.json      — user settings
```

No cleartext secrets stored. Vault key is never written to disk.
All files chmod 0o600 on POSIX via `safe_chmod`.

---

## Compliance Checklist

- [x] Branch: `feat/cyberos-vaultcore-native` off `feat/cyber-apps-foundation`
- [x] Shared vault only (no duplicate crypto)
- [x] No cleartext storage of sensitive values
- [x] Additive only (no existing files modified except app.py + index.html)
- [x] Files under 500 lines each
- [x] Auth: `get_current_user(request)` in every route
- [x] Tables/paths prefixed `cyberapps_vaultcore_*` / `vc_*`
- [x] Script tag added before app.js in index.html
- [x] Registry self-push with `vault: true`
- [x] No Co-Authored-By trailer
- [x] No bundler — ES modules served directly
- [x] `python3 -m py_compile` passes all 3 Python files
- [x] `flake8` clean (no errors)
- [x] `python3 -m py_compile app.py` passes
