# CyberOS-HTML Extraction — Inventory

Date: 2026-06-12

This document records every CyberApps file removed from Cerberus and moved to
`/Users/codyliddell/Documents/Claude/Projects/CyberOS-HTML/`.

## Route files deleted from `routes/`

| File | Sidecars |
|------|---------|
| cyberapps_cyberlab_routes.py | cyberapps_cyberlab_cheatsheets.py, cyberapps_cyberlab_models.py, cyberapps_cyberlab_vault.py |
| cyberapps_credvault_routes.py | cyberapps_credvault_models.py |
| cyberapps_dashboard_routes.py | — |
| cyberapps_ghostvault_routes.py | cyberapps_ghostvault_models.py, cyberapps_ghostvault_vault.py |
| cyberapps_launcher_routes.py | — |
| cyberapps_netlab_routes.py | — |
| cyberapps_networkmap_routes.py | — |
| cyberapps_operations_routes.py | — |
| cyberapps_playbookstudio_routes.py | — |
| cyberapps_recondesk_routes.py | cyberapps_recondesk_models.py, cyberapps_recondesk_schemas.py |
| cyberapps_reportforge_routes.py | cyberapps_reportforge_data.py |
| cyberapps_settings_routes.py | — |
| cyberapps_signalboard_routes.py | — |
| cyberapps_terminallink_routes.py | — |
| cyberapps_vaultcore_routes.py | cyberapps_vaultcore_models.py, cyberapps_vaultcore_vault.py |

## Static files deleted

- `static/cyberapps.css`
- `static/cyberapps/jarvis-effects.css`
- `static/cyberapps/jarvis-effects.js`
- `static/cyberapps/vault-gate.js`
- `static/js/cyberapps/` — entire directory except `command-center/` subdirectory
- `static/js/settings/cyberapps_section.js`

## app.py changes

Removed all `include_router(setup_cyberapps_*)` calls and their imports (lines 768–823).

## static/index.html changes

- Removed `<link rel="stylesheet" href="/static/cyberapps.css">`
- Removed `<link rel="stylesheet" href="/static/cyberapps/jarvis-effects.css">`
- Removed `<button id="rail-cyber-apps">` from icon rail
- Removed `<div id="sidebar-cyber-apps-btn">` from sidebar
- Removed `<div id="cyber-apps-panel">` overlay block (lines 1231–1251)
- Removed all cyberapps `<script>` tags (lines 2413, 2417–2418, 2423–2448)
- Removed TerminalLink xterm link/script tags

## static/js/settings.js changes

Removed `initCyberAppsSettings()` call.

## static/sw.js changes

Bumped CACHE_NAME from `cerberus-v337` to `cerberus-v338`.

## Preserved in Cerberus

- `static/js/cyberapps/command-center/` — JARVIS Command Center (Cerberus own state)
- `static/cc-app/` — React Command Center build
- `routes/claude_subscription_routes.py` + `src/claude_subscription.py`
- All non-CyberApps features (Notes, Tasks, Email, Calendar, Cookbook, etc.)

## CyberOS-HTML location

`/Users/codyliddell/Documents/Claude/Projects/CyberOS-HTML/`

Binds to `127.0.0.1:8088:8000`
