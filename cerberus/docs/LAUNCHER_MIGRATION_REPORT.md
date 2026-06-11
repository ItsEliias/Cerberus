# Launcher Migration Report

Branch: `feat/cyberos-launcher-native`

## Source

`/Users/…/CyberOS/Cybertools Launcher/` — Electron app (React + TypeScript, Tailwind, Zustand).

## Feature Inventory

### NOT migrated — covered by existing Cerberus pill-nav

| Electron Feature | Reason skipped |
|---|---|
| App grid / pill navigation | The Cerberus Cyber Apps panel IS the launcher: pills at the top let users open any registered app. Duplicating this inside a Launcher app would create a confusing recursive structure. |
| System tray icon + context menu | Electron-specific. Cerberus is a web app. |
| Desktop notifications | Electron-specific. Not applicable. |
| Auto-updater / GitHub releases check | Electron-specific. Not applicable. |
| App install / build management (`AppManager`) | Cerberus native apps have Python backends registered directly; there is no app bundle to install. |
| VPN detection | `os.networkInterfaces()` is Node.js only. The equivalent in Cerberus lives in the Diagnostics panel. |
| Splash screen | Cerberus has its own loading state. |
| Frameless floating panel window | Cerberus is a web app; the Cyber Apps overlay replaces this. |
| Panel blur-to-hide / tray toggle | Not applicable in same-origin browser context. |

### Migrated — unique features not covered by pill-nav

| Feature | Backend | Frontend |
|---|---|---|
| **Global fuzzy search** across all registered Cyber Apps and custom shortcuts | No backend needed — queries `window.CYBER_APPS_REGISTRY` client-side | `_filterCommands()` in `index.js` with subsequence fuzzy scoring; activated via search input or `Cmd+F` |
| **Recent / most-launched apps** with launch-count display | `POST /api/cyberapps/launcher/launches` stores per-app count | App grid sorted by launch frequency; count shown on tile |
| **Pinned apps** (right-click any tile to toggle pin; star badge shown) | `PUT /api/cyberapps/launcher/pinned` | Star badge on pinned tiles; persisted per user |
| **Custom shortcut slots** — up to 8 user-defined shortcuts (name + URL + description) | Full CRUD: `/api/cyberapps/launcher/slots` | Modal-based add/edit/delete; "Open →" button opens URL in new tab |
| **Activity feed** — log of recent ecosystem events | `POST /api/cyberapps/launcher/activity`, `DELETE /api/cyberapps/launcher/activity` | Activity tab with app-coloured dots, event label, relative timestamp, and "Clear" button |
| **Stats strip** — live counts: total apps, total launches, pinned, activity events | Derived from registry + stored counts | Always-visible strip at top of Launcher panel |
| **App visibility prefs** — hide specific apps from the launcher view (hide/show toggle) | `PUT /api/cyberapps/launcher/prefs` | Stored per user; frontend reads on init |

## Files Created

- `routes/cyberapps_launcher_routes.py` — FastAPI router (`/api/cyberapps/launcher`)
- `static/js/cyberapps/launcher/index.js` — ES module; self-registers with `CYBER_APPS_REGISTRY`
- `static/js/cyberapps/launcher/launcher.css` — scoped styles using Cerberus CSS variables

## Files Modified

- `static/index.html` — added `<script type="module" src="/static/js/cyberapps/launcher/index.js">` before `app.js`
- `app.py` — added `setup_cyberapps_launcher_routes()` include

## Data Storage

All data stored under `data/cyberapps/launcher/<user>/`:

| File | Contents |
|---|---|
| `slots.json` | Custom shortcut slots (array) |
| `pinned.json` | Pinned app IDs (array) |
| `launches.json` | Per-app launch counts (object) |
| `activity.json` | Activity feed entries (array, capped at 100) |
| `prefs.json` | Visibility prefs `{ hidden: string[] }` |

## Design Decision: No Vault Flag

Launcher does not store secrets. `vault: false` in registry entry.

## Overlap Note

The Electron Launcher's primary purpose — a floating panel to launch any CYBERTOOLS app — is entirely replicated by the Cerberus Cyber Apps pill-nav panel. The pill-nav is more capable (same-origin, no IPC, instant mount/unmount). This migration focused exclusively on features the pill-nav does not provide: search, usage analytics, custom shortcuts, pinned apps, and the activity log.
