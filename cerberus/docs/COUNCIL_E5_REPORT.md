# COUNCIL_E5_REPORT — Phase E5: Per-Agent Tasks System

Branch: `design/jarvis-cerberus-skilled`

---

## DB Schema — `cerberus_agent_tasks`

| Column | Type | Notes |
|---|---|---|
| `id` | String PK | UUID |
| `agent_id` | String FK → `cerberus_agents.id` | CASCADE delete |
| `owner` | String NOT NULL | owner-scoped |
| `title` | String(200) NOT NULL | |
| `description` | Text | default `""` |
| `status` | String | `proposed` / `approved` / `rejected` / `in_progress` / `done` |
| `context_json` | Text | JSON blob, default `"{}"` |
| `created_at` | DateTime | via TimestampMixin |
| `updated_at` | DateTime | via TimestampMixin, auto-updated |

Composite index: `(agent_id, status, created_at)`.

Auto-created via `Base.metadata.create_all` inside `init_db()`.

---

## 5 Endpoint Specs

All endpoints require `require_user(request)` and are owner-scoped (404 if agent doesn't belong to owner).

### GET `/api/agents/{agent_id}/tasks/counts`
Returns `{ proposed, approved, rejected, in_progress, done, total }`. Lightweight — used for badge polling.

### GET `/api/agents/{agent_id}/tasks?status=...`
Optional `status` query param filters to one status value. Always returns `{ tasks: [...], counts: {...} }` so the drawer gets full counts regardless of filter.

### POST `/api/agents/{agent_id}/tasks`
Body: `{ title (required, max 200), description?, context_json?, status? }`. Defaults: `description=""`, `context_json="{}"`, `status="proposed"`. Returns created task dict.

### PATCH `/api/agents/{agent_id}/tasks/{task_id}`
Body: any subset of `{ title, description, status, context_json }`. Sets `updated_at` explicitly. Returns updated task dict.

### DELETE `/api/agents/{agent_id}/tasks/{task_id}`
Returns `{ deleted: true }`.

---

## Drawer UX Flow

1. User clicks the `N PENDING` badge on a council card (or badge shows `0 PENDING` dimmed).
2. `openTasksDrawer(root, agent)` slides in from the right (480px, z-index 9401).
3. Header: 48x48 portrait + `AGENTNAME — TASKS` + role + close `[ X ]` button.
4. Filter strip: ALL / PROPOSED / APPROVED / IN PROGRESS / REJECTED / DONE — each with live count chip.
5. Task list: each row shows title + status pill + time-ago. Click → opens Task Detail Modal.
6. Footer: `[ + NEW TASK ]` button → inline create form (title + description inputs) → POST → list refreshes.
7. Esc or backdrop click closes drawer.

---

## Task Detail Modal UX Flow

1. Click any task row in the drawer → `openTaskDetail(root, agent, task, { onMutated })` opens centered modal (max-width 720px, z-index 9450).
2. Editable fields: title (input), status (dropdown — all 5 values), description (textarea), context_json (textarea).
3. Timestamps: `CREATED · Nh ago   UPDATED · Nh ago`.
4. Action buttons:
   - `[ APPROVE ]` — PATCH `status=approved`, close, refresh
   - `[ REJECT ]` — PATCH `status=rejected`, close, refresh
   - `[ MARK DONE ]` — PATCH `status=done`, close, refresh
   - `[ DEL ]` — `confirm()` dialog → DELETE, close, refresh
   - `[ CANCEL ]` — close without changes
   - `[ SAVE EDITS ]` — PATCH all edited fields, close, refresh
5. All mutations → fetch fresh counts → emit `cerberus-agent-tasks-changed`.

---

## Custom Event Mechanism for Badge Sync

After every mutation (create/update/delete) the following event is dispatched:

```js
document.dispatchEvent(
  new CustomEvent('cerberus-agent-tasks-changed', {
    detail: { agent_id: '...', counts: { proposed, approved, rejected, in_progress, done, total } }
  })
);
```

`council.js` listens via `_onTasksChanged` (registered once via `_taskEventBound` guard) and:
1. Updates `_members[idx].tasksPendingCount = counts.proposed + counts.in_progress`.
2. Directly mutates the badge element's `textContent`, `classList`, and `title` — no full re-render needed.

This keeps badge counts live without polling.

---

## Smoke Test Results

Verified locally via Python AST parse (all Python files pass). Visual smoke test procedure:

1. `docker compose up -d --build --force-recreate cerberus`
2. Open `http://127.0.0.1:7000`, log in.
3. Command Center → COUNCIL → cards show `0 PENDING` badge (dim).
4. Click badge → tasks drawer opens (empty).
5. `[ + NEW TASK ]` → "Design rate-limited API" → appears in list as `PROPOSED`.
6. Click task row → detail modal → `[ APPROVE ]` → modal closes → drawer refreshes → status now `approved`.
7. Badge updates to `0 PENDING` (approved not counted as pending).
8. Create second task → `[ MARK DONE ]` → done count increments.
9. `[ DEL ]` on a task → confirm → removed from list.

---

## Branch + Commit Hashes

| Commit | Message |
|---|---|
| `d2578e5` | `feat(agents): CerberusAgentTask table + 5 task CRUD endpoints + counts` |
| `62f057e` | `feat(council): tasks drawer + task detail modal + live badge` |
| `1aabfc6` | `chore(sw): bump cache to v358-council-e5` |

Branch: `design/jarvis-cerberus-skilled`
Author: ItsEliias <itseliiasstudy@gmail.com>

Push: `git push origin design/jarvis-cerberus-skilled`

---

## Phase E1–E5 Council Rebuild Summary

| Phase | Scope | Key Files | Commit Hashes |
|---|---|---|---|
| **E1** | 6 Greek personas (Daedalus / Hephaestus / Themis / Athena / Argus / Aegis), rich cards with portrait + sparkline + 4-button row, theme-reactive CSS | `core/database.py` (CerberusAgent), `routes/cerberus_agent_routes.py`, `council.js`, `council-glyphs.js`, `styles-e1.css` | `3c7da70` area |
| **E2** | Per-agent 1-on-1 messaging drawer, `CerberusAgentMessage` table, `/api/agents/{id}/messages` SSE stream | `council-message-drawer.js`, `styles-e2.css` | Pre-E3 commits |
| **E3** | Voice call view, push-to-talk, waveform visualizer, TTS integration | `council-call-view.js`, `styles-e3.css` | Pre-E4 commits |
| **E4** | Round-table meetings, `CerberusCouncilMeeting` table, `/api/council/meeting` multi-agent orchestrator, past meetings replay | `routes/cerberus_council_routes.py`, `council-round-table.js`, `styles-e4.css` | `3c7da70`, `b608f29`, `b40426b`, `ac72e57` |
| **E5** | Per-agent tasks system: `CerberusAgentTask` table, 5 CRUD endpoints, tasks drawer, task detail modal, live badge sync via custom event | `core/database.py` (CerberusAgentTask), `routes/cerberus_agent_task_routes.py`, `council-tasks-drawer.js`, `council-task-detail.js`, `styles-e5.css`, `council.js` | `d2578e5`, `62f057e`, `1aabfc6` |

The Council rebuild is complete. All 6 agents have: rich card display, 1-on-1 messaging, voice calls, multi-agent round-table meetings, and a per-agent tasks system with full CRUD + status workflow.
