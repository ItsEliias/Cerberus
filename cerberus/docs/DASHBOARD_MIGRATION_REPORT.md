# Dashboard Migration Report

**Branch**: `feat/cyberos-dashboard-native`
**Source**: `/Users/codyliddell/Documents/Claude/Projects/CyberOS/CyberOS Dashboard/`
**Target**: Cerberus native CyberOS app

---

## Widget Inventory

All widgets from the CyberOS Electron Dashboard are fully preserved.

### Dashboard View (main)

| Widget | Description | Data Source |
|--------|-------------|-------------|
| ActiveSessionBanner | Live lab session banner (lab, IP, host, playbook, elapsed timer) | `shared_context.json` via CyberLab |
| OperatorProfileCard | Hero card with SkillRadar (7-axis), operator name, labs/flags/creds/streak | `operator_profile.json` via CyberLab |
| EcosystemHealthBar | Segmented progress bar + per-app status dots with tooltips | Aggregated `status.json` files |
| AppStatusGrid | 4-column grid of 11 app cards (name, on/off, primary metric, sparkline, secondary metrics, last-active) | Aggregated `status.json` files |
| ActivityFeed | Deduped event feed (newest first), per-app filter dropdown, event count badge | Aggregated `events.json` files |

### Profile View

| Widget | Description | Data Source |
|--------|-------------|-------------|
| ProfileHeader | Avatar ring (rank gradient), operator name, rank badge, quick stats row | `operator_profile.json` |
| StatsRow | 4-cell grid: Labs Completed, Flags Captured, Credentials, Current Streak | `operator_profile.json` |
| StreakCalendar | 90-day activity heatmap, today highlight | `operator_profile.activityDates` |
| SkillRadarLarge | 7-axis radar (Web/Network/AD/Linux/Windows/Crypto/Forensics), 320px | `operator_profile.skillProgress` |
| OperatorStatsTable | Per-skill progress bars with percentage | `operator_profile.skillProgress` |

### Ecosystem View

| Widget | Description | Data Source |
|--------|-------------|-------------|
| EcosystemPageHeader | Title + apps/events count chips | Aggregated |
| SharedContextInspector | Key-value display of active lab/IP/target/playbook | `shared_context.json` |
| ConfigInspector | Ecosystem overview: health%, apps online/total, per-app active status | Aggregated |
| AppStatusTable | Full table: App, Status badge, Last Active, Key Metric, Last Event | Aggregated |
| EventLog | Searchable + filterable event log (by app, keyword); expandable rows showing raw JSON | Aggregated |

---

## Backend Architecture

**File**: `routes/cyberapps_dashboard_routes.py`

**Design**: Read-only aggregation — Dashboard never writes data, it only reads.

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cyberapps/dashboard` | GET | Health check |
| `/api/cyberapps/dashboard/summary` | GET | Full snapshot: statuses + operator profile + shared context + health |
| `/api/cyberapps/dashboard/statuses` | GET | Per-app status objects only (lightweight) |
| `/api/cyberapps/dashboard/events` | GET | Merged event feed (?limit=, ?app= filters) |
| `/api/cyberapps/dashboard/operator-profile` | GET | Operator profile from CyberLab |
| `/api/cyberapps/dashboard/shared-context` | GET | Shared context from CyberLab |

### Data Contract (Cross-App)

Dashboard reads from the following file paths. Each Wave-2 app is responsible for writing these files.

```
data/cyberapps/<app_id>/<user>/status.json       — AppStatus shape (see below)
data/cyberapps/<app_id>/<user>/events.json        — List[EcosystemEvent] newest-first
data/cyberapps/cyberlab/<user>/operator_profile.json
data/cyberapps/cyberlab/<user>/shared_context.json
```

**AppStatus shape** (minimum required fields per app):
```json
{
  "active": true,
  "lastActive": "2026-06-12T00:00:00Z"
}
```

**App-specific status fields** (surfaced in metrics):

| App | Additional Status Fields |
|-----|--------------------------|
| cyberlab | `currentLab`, `findingsCount`, `sessionActive` |
| recondesk | `targetCount`, `cardCount`, `activeTarget` |
| credvault | `credentialCount`, `locked` |
| vaultcore | `vaultNoteCount`, `totalSources` |
| networkmap | `currentGraph`, `nodeCount` |
| terminallink | `commandCount`, `linkedSession` |
| signalboard | `unreadCount`, `lastRefresh` |
| ghostvault | `noteCount` |
| playbookstudio | `activePlaybook` |
| reportforge | `reportCount` |
| netlab | (active/lastActive only) |

**EcosystemEvent shape**:
```json
{
  "id": "uuid-or-random",
  "timestamp": "2026-06-12T00:00:00Z",
  "app": "CyberLab",
  "event": "session:started",
  "data": {}
}
```

Legacy schema variant (also supported): `appName` instead of `app`, `eventType` instead of `event`.

---

## Frontend Architecture

**Files**: `static/js/cyberapps/dashboard/`

| File | Lines | Purpose |
|------|-------|---------|
| `index.js` | 182 | App entry, shell render, nav wiring, data polling (10s interval), self-registration |
| `state.js` | 61 | Reactive key-value store with subscribe/notify |
| `api.js` | 27 | `fetchSummary()` + `fetchEvents()` — calls backend aggregation endpoints |
| `utils.js` | 197 | `timeAgo`, `humanizeEvent`, `appAccentColor`, `buildAppCards`, `normalizeEvent`, `esc`, `truncate`, `formatElapsed` |
| `view-dashboard.js` | 403 | Main dashboard view render + session banner + operator card + health bar + app grid + activity feed |
| `view-profile.js` | 205 | Profile view render + streak calendar + skill radar (large) + stats |
| `view-ecosystem.js` | 276 | Ecosystem view render + inspector pair + app status table + event log |
| `dashboard.css` | 382 | Core styles: layout, nav, session banner, operator card, health bar, app grid, activity feed |
| `dashboard-views.css` | 230 | Profile + ecosystem view styles, shared utilities, loading states, scrollbars |

---

## Self-Registration

```js
window.CYBER_APPS_REGISTRY.push({
  id: 'dashboard',
  name: 'Dashboard',
  icon: '<svg ...>',   // 4-quadrant grid icon
  init,
  destroy,
  vault: false,        // No vault required — public aggregation data
});
```

---

## Cross-App Data Contracts (Wave-2 Dependencies)

The Dashboard depends on the following Wave-2 apps writing their data files correctly:

| Dependency | Required For | Contract |
|------------|-------------|---------|
| CyberLab | `operator_profile.json`, `shared_context.json`, `status.json` | OperatorProfileCard, ActiveSessionBanner, skill radar |
| ReconDesk | `status.json` with `targetCount`, `cardCount` | AppStatusGrid ReconDesk card |
| CredVault | `status.json` with `credentialCount`, `locked` | AppStatusGrid CredVault card |
| VaultCore | `status.json` with `vaultNoteCount`, `totalSources` | AppStatusGrid VaultCore card |
| NetworkMap | `status.json` with `currentGraph`, `nodeCount` | AppStatusGrid NetworkMap card |
| NetLab | `status.json` (active/lastActive) | AppStatusGrid NetLab card |
| TerminalLink | `status.json` with `commandCount` | AppStatusGrid TerminalLink card |
| SignalBoard | `status.json` with `unreadCount` | AppStatusGrid SignalBoard card |
| All Wave-2 | `events.json` (list of EcosystemEvent) | ActivityFeed, EventLog |

**Graceful degradation**: If any app has not written its data files, Dashboard shows `active: false` and zeroed metrics for that app. The aggregation layer never raises on missing files.

---

## Notes

- **No SQLAlchemy models** — Dashboard is purely a read-only aggregation layer.
- **Polling interval**: 10 seconds (configurable in `index.js` `POLL_INTERVAL_MS`).
- **vault**: `false` — Dashboard data is not sensitive and does not require vault unlock.
- The `color-mix()` CSS function is used in `dashboard.css` for the segmented health bar fill. Safari 16.2+ and Chrome 111+ support this natively. Fallback: solid accent color.
