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
| HUD status chips (ONLINE / AGENTS / AUTH) | Header | Vitals + agents count | `/api/cyberapps/operations/vitals`, `/api/agents` | ✅ live |
| Live clock | Header | `Date` client-side | — | ✅ live |
| Hero counter — total session count (count-up Orbitron, 52 px) | Hero | Fetched on open | `/api/sessions?limit=1000` | ✅ live |
| Hero counter — total token count (count-up Orbitron, 42 px) | Hero | Fetched on open | `/api/usage/tokens` | ✅ live |
| Hero delta — sessions today | Hero | Derived from `created_at` | `/api/sessions?limit=1000` | ✅ live |
| Hero delta — tokens today | Hero | Derived from `by_day[today]` | `/api/usage/tokens` | ✅ live |
| Date sub-text under sessions hero | Hero | `Date` client-side | — | ✅ live |
| Token flow graph (30-day area+line, canvas, draw-in animation) | Graph band | Fetched on open | `/api/usage/tokens` → `by_day` | ✅ live |
| Recent activity feed (last 8 sessions, click to load) | Activity | Fetched on open | `/api/sessions?limit=1000` | ✅ live |
| Vitals bars — CPU / RAM / DISK / LAT (semantic colours) | Vitals | Polled every 8 s | `/api/cyberapps/operations/vitals` | ✅ live |
| Quick Actions grid (Chat, Nexus, Cerberus, CC, Notes, Tasks, Theme) | Actions | Nav only | — | ✅ live |
| **Briefing feed** (last 3 notes/events) | Briefing (new) | Fetched on open | `/api/notes?limit=3` or `/api/sessions?limit=3` | 🔲 Phase B |

### CC widgets

| Widget | Tab | Data source | Backend endpoint | Status |
|--------|-----|-------------|-----------------|--------|
| Brand bar — `[C]ERBERUS` wordmark + COMMAND CENTER sub-label + HUD chips (ONLINE/AGENTS/AUTH) + 24h clock | Shell | `Date` client-side; agent count from `/api/agents` poll | — | ✅ live |
| Vitals **timeseries** charts | COMMAND | Polled | `/api/cyberapps/operations/vitals` | ✅ live |
| Swarm / agent orbit | COMMAND | Polled | `/api/agents` | ✅ live |
| Gateway health | COMMAND | Polled | `/api/cyberapps/gateway` | ✅ live |
| Agent count / agent list grid | COMMAND | Polled | `/api/agents` | ✅ live |
| **Live running tasks feed** | COMMAND (new) | Polled every 8 s | `/api/tasks/active` | ✅ live |
| **Model status panel** (loaded model, ctx usage) | COMMAND (new) | Polled every 8 s | `/api/model/status` | ✅ live |
| **COUNCIL two-mode graph** (HIERARCHY org-chart + SESSION REPLAY radial network) | COUNCIL | Hierarchy: `/api/agents` polled 5 s; Replay: `/api/rooms/{id}` polled 3 s | `/api/agents`, `/api/rooms`, `/api/rooms/{id}` | ✅ live |
| Workspace tab | WORKSPACE | Fetched on tab open | existing workspace API | ✅ live |
| Finance tab | FINANCE | Fetched on tab open | existing finance API | ✅ live |
| Assistant tab | ASSISTANT | Streaming | existing assistant API | ✅ live |
| Gateway tab | GATEWAY | Fetched on tab open | existing gateway API | ✅ live |
| **Agent roster + invoke** | AGENTS (new) | Fetched on tab open | `/api/agents`, `/api/agents/{id}/invoke` | ✅ live |
| **Agent create** (v3.1-A) | AGENTS | On form submit | `POST /api/agents` | ✅ live |
| **Agent edit** (v3.1-A) | AGENTS | On save | `PATCH /api/agents/{id}` (name/role/type/prompt/model/avatar) | ✅ live |
| **Agent delete** (v3.1-A) | AGENTS | On confirm | `DELETE /api/agents/{id}` (soft-suppress defaults; hard-delete custom) | ✅ live |
| **Token observability** (total, cost, 30d sparkline, split) | OBSERVE (new) | Fetched on tab open | `/api/usage/tokens` | ✅ live |
| **Conference Rooms** (Phase 3a) | ROOMS | CRUD + SSE | `/api/rooms`, `/api/rooms/{id}/send` | ✅ live |
| **Room transcript context** (Phase 3b) | ROOMS | Auto-injected per turn | Last 20 `RoomMessage` rows → system prompt | ✅ live |
| **Room mode toggle** (Phase 3b) | ROOMS | Click badge in chat header | `PATCH /api/rooms/{id}` `{mode: 'routed'\|'open'}` | ✅ live |
| **Room cap + continue-checkpoint** (Phase 3b) | ROOMS | Inline prompt after cap hit | `POST /api/rooms/{id}/continue` | ✅ live |
| **Room token meter** (Phase 3b) | ROOMS | Header display | `total_input_tokens + total_output_tokens` from room dict | ✅ live |
| **Agent voice call** (Phase 4a) | AGENTS / CHAT | Push-to-talk SSE pipeline | `POST /api/stt/transcribe`, `POST /api/agents/{id}/thread/send`, `POST /api/tts/synthesize`, `GET /api/tts/stats` | ✅ live |
| **Agent tts_voice field** (Phase 4a) | AGENTS edit form | On save | `PATCH /api/agents/{id}` `{tts_voice: str}` | ✅ live |
| **Room group voice call** (Phase 4b) | ROOMS chat header | 📞 Call button | `POST /api/rooms/{id}/send` + `POST /api/rooms/{id}/continue` SSE; `event: route` now includes `tts_voice` per agent | ✅ live |
| **Per-agent TTS voice in route events** (Phase 4b) | Engine | Auto-included | `event: route` data: `{agent, agent_id, tts_voice}` from `CerberusAgent.tts_voice` | ✅ live |
| **Floor control** (Phase 4b) | ROOMS voice panel | ✋ Floor button | Queues user-speak after current agent's TTS completes | ✅ live |

---

## Overlap Rules (strictly enforced)

- **Globe / orbit hero** → CC COMMAND tab only. Dashboard uses JARVIS-style hero counters instead.
- **Vitals bars** → DASHBOARD only. CC shows timeseries, not percentage bars.
- **Sessions list** → DASHBOARD only (activity feed). CC does not duplicate sessions.
- **Agents list detail** → CC AGENTS tab only. Dashboard shows roster count only (chip in header).
- **Token usage detail** → CC OBSERVE tab + DASHBOARD (summary only). CC shows full 30d breakdown; Dashboard shows total + cost + 30-day flow graph.
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
