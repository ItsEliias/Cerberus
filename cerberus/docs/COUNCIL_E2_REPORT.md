# COUNCIL Phase E2 Report — Per-Agent Message Drawer

**Branch:** `design/jarvis-cerberus-skilled`
**Author:** ItsEliias &lt;itseliiasstudy@gmail.com&gt;
**Base commit (E1):** `00299f4`

---

## Commits

| Hash | Message |
|------|---------|
| `3f5c465` | feat(agents): CerberusAgentMessage table + /api/agents/{id}/messages CRUD + streamed responses |
| `2ae3bfe` | feat(council): per-agent message drawer with persona context + TTS toggle |
| `c426c5d` | chore(sw): bump cache to v355-council-e2 |

**Push:** `git push origin design/jarvis-cerberus-skilled` — confirmed pushed to `00299f4..c426c5d`.

---

## Database Schema — `cerberus_agent_messages`

| Column | Type | Notes |
|--------|------|-------|
| `id` | String PK | UUID |
| `agent_id` | String FK | → `cerberus_agents.id` ON DELETE CASCADE |
| `owner` | String | Ownership scope (same as agents) |
| `role` | String | `'user'` or `'agent'` |
| `content` | Text | Message body |
| `created_at` | DateTime | Naive UTC via `utcnow_naive()` |

Composite index: `(agent_id, created_at)`.
`to_dict()` serializes all fields with ISO-8601 timestamp.
Auto-created by `Base.metadata.create_all` in `init_db()`.

---

## API Endpoints

### `GET /api/agents/{id}/messages?limit=100`
- 401 if unauthenticated, 403 if wrong owner, 404 if agent not found
- Returns `{ messages: [{ id, agent_id, owner, role, content, created_at }] }` in ASC order
- Capped to most-recent N via Python slice

### `POST /api/agents/{id}/messages`
- Body: `{ content: string }`
- Validates ownership, persists user message, builds conversation context (system prompt + last 60 messages = 30 turns), streams via `claude_subscription.stream_completion(messages, model=agent.model_alias)`
- After stream completes: persists full agent reply with `role='agent'`, stamps `last_active_at`, increments score
- On error: persists `[Stream error]` note, sets agent status to `alert`
- Returns `text/event-stream` SSE

### `DELETE /api/agents/{id}/messages`
- Clears all messages for that agent
- Returns `{ deleted: N }`

---

## Frontend

### `static/js/cyberapps/command-center/council-message-drawer.js`
Exports `openMessageDrawer(root, agent)` and `closeMessageDrawer(root)`.

**UI:**
- Fixed-right drawer, 420px wide, slides in/out via `translateX` + opacity (250ms ease)
- Header: 48x48 agent portrait (from `council-glyphs.js`), name, role, X close button
- Message list: scrollable, user bubbles right-aligned (accent tint), agent bubbles left-aligned (hairline border), `.streaming` pulse class while response streams
- Footer: TTS toggle, textarea (Enter=send, Shift+Enter=newline), SEND button
- On open: fetches GET history, renders all bubbles, scrolls to bottom
- TTS state persisted to `localStorage.cc_msg_tts_<agent_id>` (default off)
- When TTS on: `window.aiTTSManager.play(text)` called after full stream
- Esc key, backdrop click, or X closes the drawer

### `static/js/cyberapps/command-center/styles-e2.css`
All selectors theme-reactive via `var(--cc-accent)` and `rgba(var(--cc-accent-rgb), X)`.
`prefers-reduced-motion`: disables `translateX` slide-in and `.streaming` pulse animation.

### `static/js/cyberapps/command-center/council.js`
- Added import of `openMessageDrawer`
- MESSAGE button calls `openMessageDrawer(root, member)` instead of coming-soon toast
- CALL button retains `Coming soon — Phase E3` toast

---

## Service Worker
`CACHE_NAME` bumped from `cerberus-v354-council-e1` → `cerberus-v355-council-e2`.

---

## Test Results

File: `tests/test_council_e2_messages.py` — **7/7 passing**

| Test | Result |
|------|--------|
| `test_get_messages_empty` | PASS |
| `test_get_messages_401_unauth` | PASS |
| `test_get_messages_404_unknown_agent` | PASS |
| `test_get_messages_403_wrong_owner` | PASS |
| `test_delete_messages_clears` | PASS |
| `test_message_model_to_dict` | PASS |
| `test_get_messages_limit` | PASS |

No regressions in `test_task_chain_owner_scope.py` or `test_session_list_owner_scope.py`.

---

## Smoke Test Steps

1. `docker compose up -d --build --force-recreate cerberus` from project root
2. Open `http://127.0.0.1:7000`, log in
3. Command Center → COUNCIL → click `[ MESSAGE ]` on Daedalus
4. Drawer slides in from right with Daedalus portrait + name
5. Send "Hi, what should I think about for a microservices design?" — user bubble appears, agent streams response
6. Toggle TTS on → send another message → voice plays after stream
7. Close (X / Esc / backdrop) → reopen → conversation history persists
8. Open MESSAGE on Athena → fresh drawer, different persona persona context
9. `curl -s http://127.0.0.1:7000/api/agents/<id>/messages` without auth cookie → 401

---

## Phase E2 Acceptance Checklist

- [x] MESSAGE button opens working drawer
- [x] Conversations persist via `cerberus_agent_messages` table
- [x] Responses stream from Subscription provider with agent persona
- [x] TTS toggle works (localStorage persistence, `aiTTSManager.play`)
- [x] Theme-reactive (accents follow `--cc-accent`)
- [x] `prefers-reduced-motion` respected
- [x] Auth gate on all endpoints
- [x] SW cache bumped to v355
- [x] Committed + pushed to `design/jarvis-cerberus-skilled`
