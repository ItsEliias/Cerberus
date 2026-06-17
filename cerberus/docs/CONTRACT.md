# Mission 1.5 — Surface Contract

Maps every widget / data panel to exactly one surface. Prevents duplication.
After Phase B/C land, the diff against this doc is the acceptance test.

---

## Surface Definitions

| Surface | Purpose | Entry point |
|---------|---------|-------------|
| **DASHBOARD** | High-level, glanceable, mostly passive. Opened on login, closeable. | `static/js/dashboard.js` → `open()` |
| **CC** | Active operational controls — the cockpit. Opened via sidebar. | `static/js/cyberapps/command-center/index.js` |

---

## Widget Manifest

### DASHBOARD widgets

| Widget | Card | Data source | Backend endpoint | Status |
|--------|------|-------------|-----------------|--------|
| Product identity + status badge | Header | CPU % threshold (client logic) | `/api/cyberapps/operations/vitals` | ✅ live |
| Live clock | Header | `Date` client-side | — | ✅ live |
| Globe hero (CSS animated) | Hero | — | — | ✅ live |
| Date / greeting sub-text | Hero | `Date` client-side | — | ✅ live |
| Vitals bars — CPU / RAM / DISK / LAT | Vitals | Polled every 8 s | `/api/cyberapps/operations/vitals` | ✅ live |
| Recent sessions list (last 6) | Sessions | Fetched on open | `/api/sessions?limit=6` | ✅ live |
| Quick Actions grid (Chat, CC, Notes, Tasks) | Actions | Nav only | — | ✅ live |
| **Agent activity sparklines** | Agents (new) | Polled every 10 s | `/api/agents` (thin read) | 🔲 Phase B |
| **Token usage chart** | Usage (new) | Fetched on open | `/api/usage/tokens` | ✅ live |
| **Briefing feed** (last 3 notes/events) | Briefing (new) | Fetched on open | `/api/notes?limit=3` or `/api/sessions?limit=3` | 🔲 Phase B |
| **Animated counters** (sessions total, agents count) | Counters (new) | Fetched on open | `/api/sessions`, `/api/agents` | ✅ live |

### CC widgets

| Widget | Tab | Data source | Backend endpoint | Status |
|--------|-----|-------------|-----------------|--------|
| Brand bar + clock | Shell | `Date` client-side | — | ✅ live |
| Vitals **timeseries** charts | COMMAND | Polled | `/api/cyberapps/operations/vitals` | ✅ live |
| Swarm / agent orbit | COMMAND | Polled | `/api/agents` | ✅ live |
| Gateway health | COMMAND | Polled | `/api/cyberapps/gateway` | ✅ live |
| Agent count / agent list grid | COMMAND | Polled | `/api/agents` | ✅ live |
| **Live running tasks feed** | COMMAND (new) | Polled every 8 s | `/api/tasks/active` | ✅ live |
| **Model status panel** (loaded model, ctx usage) | COMMAND (new) | Polled every 8 s | `/api/model/status` | ✅ live |
| Council tab | COUNCIL | Fetched on tab open | existing council API | ✅ live |
| Workspace tab | WORKSPACE | Fetched on tab open | existing workspace API | ✅ live |
| Finance tab | FINANCE | Fetched on tab open | existing finance API | ✅ live |
| Assistant tab | ASSISTANT | Streaming | existing assistant API | ✅ live |
| Gateway tab | GATEWAY | Fetched on tab open | existing gateway API | ✅ live |
| **Agent roster + invoke** | AGENTS (new) | Fetched on tab open | `/api/agents`, `/api/agents/{id}/invoke` | ✅ live |
| **Token observability** (total, cost, 30d sparkline, split) | OBSERVE (new) | Fetched on tab open | `/api/usage/tokens` | ✅ live |

---

## Overlap Rules (strictly enforced)

- **Vitals bars** → DASHBOARD only. CC shows timeseries, not percentage bars.
- **Sessions list** → DASHBOARD only. CC does not duplicate sessions.
- **Agents list detail** → CC AGENTS tab only. Dashboard shows roster count only.
- **Token usage detail** → CC OBSERVE tab + DASHBOARD (summary only). CC shows full 30d breakdown; Dashboard shows total + cost.
- **Running tasks** → CC COMMAND tab only. Dashboard shows counter only (number of active tasks).
- **Notes/briefing** → DASHBOARD only (context at a glance). Full notes live in the Notes panel.

---

## Flagged Endpoints (needed for full live data; currently mocked)

| Flag | Endpoint | Used by | Notes |
|------|----------|---------|-------|
| 1 | `GET /api/usage/tokens` | Dashboard + CC OBSERVE tab | Returns `{ total_tokens: int, cost_usd: float, by_day: [{date, tokens}] }` | ✅ wired |
| 2 | `GET /api/tasks/active` | CC COMMAND tasks feed | Returns `{ tasks: [{ id, title, status, agent, started_at }] }` | ✅ wired |
| 3 | `GET /api/model/status` | CC COMMAND model status | Returns `{ model: str, ctx_used: int, ctx_limit: int }` | ✅ wired |

These are **thin read-only** views of data Cerberus already has internally.  
No writes, no new agent capability — just expose existing state.

---

## Phase Loading Spinner (Phase D)

Global replacement for `.spinner` and `.loading-dots`.  
Source: `static/js/cerberusGlobeSpinner.js` (canvas mini-globe).  
CSS override in `static/style.css` — works on all existing `<div class="spinner">` and `.loading-dots` elements with no JS changes.  
Theme-reactive: reads `--red` from computed style per frame.  
Reduced-motion: falls back to simple opacity pulse.

---

## Branch

`mission-1.5/look-and-feel` off `cerberus-os`  
HEAD at contract write: `a032caf`
