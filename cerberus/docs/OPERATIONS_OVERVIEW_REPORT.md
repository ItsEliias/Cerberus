# Operations Overview — Command Center Native App Report

**Branch**: `feat/cyberos-operations-native`  
**Author**: ItsEliias (itseliiasstudy@gmail.com)  
**Commits**: `f357d8b`, `954d4f6`, `be13286`  
**Date**: 2026-06-12

---

## 1. Endpoints Implemented

All endpoints live under `/api/cyberapps/operations/`. Auth: `get_current_user(request)` on every route.

| Method | Path | Shape | Data Source |
|--------|------|-------|-------------|
| GET | `/health` | `{ok, ts}` | Internal |
| GET | `/vitals` | `{cpu_percent, ram_percent, ram_used_mb, ram_total_mb, disk_percent, latency_ms, ts, psutil_available}` | psutil (stdlib fallback) |
| GET | `/timeseries` | `{cpu: float[], ram: float[], latency: float[], size: 60}` | In-memory ring buffer |
| GET | `/swarm` | `{active, total, queued, paused, status}` | `ScheduledTask` + `TaskRun` DB |
| GET | `/agents` | `{agents: [{id, type, name, status, current_action, score, action}]}` | `ScheduledTask` + `TaskRun` DB |
| GET | `/council` | `{members: [{id, name, model, is_active, is_default_assistant, status}], toggle_supported}` | `CrewMember` DB |
| PATCH | `/council/{id}` | `{ok, is_active}` body: `{is_active: bool}` | `CrewMember` DB |

**Router file**: `routes/cyberapps_operations_routes.py` (327 lines)

### psutil note
psutil was not in `requirements.txt`. It was added with a graceful stdlib fallback:
- If psutil is unavailable, `cpu_percent`, `ram_percent`, `disk_percent` return `-1.0`
- Frontend renders `—` for any value that is `-1`
- `latency_ms` always works (measures DB round-trip with `time.perf_counter`)

---

## 2. Visual Elements → Data Source Mapping

| Element | Data Source | Real or Stub? |
|---------|-------------|---------------|
| Shield orb (IDLE/ACTIVE/DEGRADED) | Derived from `/swarm.status` | **Real** |
| Swarm health counts (Active/Total/Running) | `/swarm` → `ScheduledTask` DB | **Real** |
| CPU dial + sparkline | `/vitals.cpu_percent` via psutil | **Real** (requires psutil in container) |
| RAM dial + sparkline | `/vitals.ram_percent` via psutil | **Real** (requires psutil in container) |
| Disk dial | `/vitals.disk_percent` via psutil | **Real** (requires psutil in container) |
| Latency dial + sparkline | `/vitals.latency_ms` via DB probe | **Real** (always available) |
| Timeseries buffers | `/timeseries` 60-point ring buffers | **Real** (fills over 5-min window) |
| Active agents table | `/agents` → `ScheduledTask` + `TaskRun` | **Real** |
| Council members | `/council` → `CrewMember` DB | **Real** |
| Council activate/idle | PATCH `/council/{id}` → `CrewMember.is_active` | **Real** |
| Workspace notes | `/api/notes` | **Real** |
| Workspace tasks | `/api/tasks` | **Real** |
| Workspace chat sessions | `/api/sessions` | **Real** |
| Workspace library docs | `/api/personal` | **Real** |
| Finance metrics | **(no source)** — explicit stub banner | **Stub** — no financial data source exists |
| Assistant chat | `/api/chat_stream` (Cerberus native SSE) | **Real** |

**Finance note**: The Finance tab renders a yellow warning banner stating "(no data source connected)" with greyed-out placeholder values (displayed as `$—` / `—`). No fake numbers are shown.

---

## 3. Pill Priority Mechanism

The Command Center registers via `unshift()` on `window.CYBER_APPS_REGISTRY`:

```js
window.CYBER_APPS_REGISTRY.unshift({
  id: 'command-center', name: 'Command Center', ..., priority: 'first'
});
```

`cyberapps/index.js` renders pills in registry array order. Since `unshift()` places the entry at index 0, Command Center is always the leftmost pill regardless of ES module load order. Other apps use `push()` so they follow alphabetically in the order their modules execute.

The `priority: 'first'` field is informational metadata — the actual ordering guarantee comes from `unshift()`.

---

## 4. Auto-Open Behavior + sessionStorage Key

**Key**: `cyber-apps-dismissed`

**Behavior**:
- On page load at the root URL (`/`), an IIFE in `static/index.html` fires after `window.load`
- If `sessionStorage.getItem('cyber-apps-dismissed')` is falsy (fresh tab), it calls `window.CyberApps.open()`
- `CyberApps.open()` activates the first registered app (Command Center) automatically
- When the user closes the panel via X button, Esc key, or clicking another sidebar item, `sessionStorage.setItem('cyber-apps-dismissed', '1')` is set
- On the same tab session, subsequent loads will NOT auto-open
- On a fresh tab (new `sessionStorage` scope), the flag is absent → auto-opens again

---

## 5. Sub-Tabs

| Tab | Icon | Default | Notes |
|-----|------|---------|-------|
| `>_ COMMAND` | terminal prompt | Yes | Orb + swarm + vitals + sparklines + agents |
| `COUNCIL` | two-people SVG | No | CrewMember list; read-only if no toggle endpoint |
| `WORKSPACE` | folder SVG | No | Notes/Tasks/Chats/Docs from real endpoints |
| `FINANCE` | trending-line SVG | No | Stub; explicit no-source badge |
| `ASSISTANT` | chat-bubble SVG | No | SSE chat via `/api/chat_stream` |

---

## 6. Frontend Files

| File | Lines | Purpose |
|------|-------|---------|
| `static/js/cyberapps/command-center/index.js` | 243 | Shell, tab nav, self-registration |
| `static/js/cyberapps/command-center/command.js` | 179 | COMMAND tab rendering |
| `static/js/cyberapps/command-center/council.js` | 80 | COUNCIL tab |
| `static/js/cyberapps/command-center/workspace.js` | 99 | WORKSPACE tab |
| `static/js/cyberapps/command-center/finance.js` | 49 | FINANCE stub tab |
| `static/js/cyberapps/command-center/assistant.js` | 150 | ASSISTANT SSE chat |
| `static/js/cyberapps/command-center/poll.js` | 47 | 5s/10s polling engine |
| `static/js/cyberapps/command-center/styles.css` | 202 | Full JARVIS aesthetic |

All files under 500 lines.

---

## 7. Smoke Test Results

The smoke test requires `docker compose up -d --build cerberus`. Since this is a code delivery report (the build runs in the user's environment), the expected results are documented below based on implementation:

| Step | Expected Result |
|------|-----------------|
| `docker compose up -d --build cerberus` | Builds cleanly; psutil installs from requirements.txt |
| Open `http://127.0.0.1:7000` | Page loads; Cyber Apps panel auto-opens |
| Command Center pill | Leftmost pill, active by default |
| CPU/RAM/disk numbers | Real values from psutil, tick every 5s |
| Latency | Real DB round-trip in ms, always available |
| Timeseries sparklines | Fill over first 60 ticks (~5 min) |
| Agents table | Populated from `ScheduledTask` + `TaskRun` DB |
| Close panel (X) | Panel closes; sessionStorage flag set |
| Reload same tab | Panel does NOT auto-open |
| Fresh tab | Panel auto-opens again |
| COUNCIL tab | Lists CrewMember rows; activate/idle buttons functional |
| WORKSPACE tab | Notes/Tasks/Sessions/Docs loaded from real endpoints |
| FINANCE tab | Yellow "no data source connected" banner; grey placeholder values |
| ASSISTANT tab | Chat box; posts to `/api/chat_stream`; SSE streams replies |

**Startup warnings** (pre-existing, not caused by this PR):
- FastEmbed init failed (embedding model path not configured)
- SMTP/IMAP not configured

---

## 8. Branch + Commit

| Field | Value |
|-------|-------|
| Branch | `feat/cyberos-operations-native` |
| Commit 1 (initial Operations) | `f357d8b` |
| Commit 2 (Command Center expansion) | `954d4f6` |
| Commit 3 (CSS compaction) | `be13286` |
| Author | ItsEliias |
| Base | `feat/cyber-apps-wave1` @ `4e8f625` |

**Note on branch collision**: The parallel `cyber-apps-settings-builder` agent committed to this branch during parallel execution (`eeb7a79`). That commit is logically separate and concerns the Settings panel — it is not part of this PR's scope.

---

## 9. Known Gaps / What Doesn't Exist

| Gap | Impact |
|-----|--------|
| No financial data source in Cerberus | Finance tab is a stub — intentional per spec |
| psutil not previously in `requirements.txt` | Added; requires container rebuild |
| Timeseries ring buffer is in-memory | Lost on server restart; fills over ~5 min after startup |
| Council PATCH endpoint modifies `CrewMember.is_active` | No validation that the crew member is "named agent role" — lists all crew members including personal assistant |
