# CyberOS-HTML Extraction Report

Date: 2026-06-12

## What was done

All 13 CyberApps (14 routers + Settings) were extracted from Cerberus into a
standalone project at `/Users/codyliddell/Documents/Claude/Projects/CyberOS-HTML/`.

## Inventory of deleted files

### Routes (26 files)
cyberapps_cyberlab_routes.py + cheatsheets + models + vault (4 files)
cyberapps_credvault_routes.py + models (2 files)
cyberapps_dashboard_routes.py (1 file)
cyberapps_ghostvault_routes.py + models + vault (3 files)
cyberapps_launcher_routes.py (1 file)
cyberapps_netlab_routes.py (1 file)
cyberapps_networkmap_routes.py (1 file)
cyberapps_operations_routes.py (1 file)
cyberapps_playbookstudio_routes.py (1 file)
cyberapps_recondesk_routes.py + models + schemas (3 files)
cyberapps_reportforge_routes.py + data (2 files)
cyberapps_settings_routes.py (1 file)
cyberapps_signalboard_routes.py (1 file)
cyberapps_terminallink_routes.py (1 file)
cyberapps_vaultcore_routes.py + models + vault (3 files)

### Static assets
static/cyberapps.css
static/cyberapps/jarvis-effects.css
static/cyberapps/jarvis-effects.js
static/cyberapps/vault-gate.js
static/js/cyberapps/{credvault,cyberlab,dashboard,ghostvault,launcher,netlab,
  networkmap,operations,playbookstudio,recondesk,reportforge,signalboard,
  terminallink,vaultcore}/ (14 app directories, ~130 files)
static/js/cyberapps/index.js
static/js/cyberapps/registry.js
static/js/settings/cyberapps_section.js

### Tests
tests/test_terminallink_auth.py (moved to CyberOS-HTML/tests/)

## app.py changes

Removed 57 lines (lines 767–823) containing all `from routes.cyberapps_*`
imports and `app.include_router(setup_cyberapps_*)` calls.

## static/index.html changes

Removed: cyberapps.css link, jarvis-effects.css link, rail-cyber-apps button,
sidebar-cyber-apps-btn, #cyber-apps-panel overlay block, cyberapps_section.js
script tag, all 14 app module script tags, jarvis-effects.js script, registry.js
script, vault-gate.js script, cyberapps/index.js bootstrap script,
TerminalLink xterm.js link/script tags.

## Preserved in Cerberus

- `static/js/cyberapps/command-center/` — 7 files (JARVIS Command Center)
- `static/cc-app/` — React Command Center build
- `routes/claude_subscription_routes.py` + `src/claude_subscription.py`
- All non-CyberApps features: Notes, Tasks, Email, Calendar, Cookbook, Tools,
  Brain, Gallery, Research, Admin, Settings, etc.

## Service worker

Bumped `CACHE_NAME` from `cerberus-v337` to `cerberus-v338` to evict stale
cyberapps assets from PWA cache.

## Cerberus boot verification

Build tested with `docker build -t cerberus-stripped:latest .`
Python import check confirmed: no cyberapps routes present after strip.
Existing running container (cerberus-cerberus-1) unaffected — still on old
image. Next `docker compose up -d --build` will pick up the stripped version.

## Branch and commit

Branch: `feat/revert-cyberapps`
Commit: `91a09f7`
149 files changed: 71 insertions, 30306 deletions.

## CyberOS-HTML status

Repo: `/Users/codyliddell/Documents/Claude/Projects/CyberOS-HTML/`
Port: `127.0.0.1:8088`
Initial commit: `1d3453e`
Docker image: `cyberos-html-cyberos:latest` (built and running)
Boot verification: HTTP 307/200 (auth redirect), login works, operations vitals
returns real system metrics, settings API returns correct structure.

## Old cyberos-cerberus-* containers (7001/8000/8001/8002)

Containers `cyberos-cerberus-cerberus-1`, `cyberos-cerberus-terminallink-1`,
`cyberos-cerberus-cyberlab-companion-1`, `cyberos-cerberus-chrome-1` are still
running as of this report. Their compose project working dir is
`/Users/codyliddell/Documents/Claude/Projects/CyberOS-Cerberus` (which only
has a `data/` dir, no compose file — the containers were started from a now-
deleted compose). They are safe to stop once CyberOS-HTML is proven working.
Stop with:

```bash
docker stop cyberos-cerberus-cerberus-1 cyberos-cerberus-terminallink-1 \
  cyberos-cerberus-cyberlab-companion-1 cyberos-cerberus-chrome-1
```
