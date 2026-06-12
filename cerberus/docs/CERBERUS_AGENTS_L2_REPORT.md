# Cerberus Agents — Level 2 Implementation Report

**Branch:** `design/jarvis-cerberus-skilled`
**Author:** ItsEliias / itseliiasstudy@gmail.com
**Date:** 2026-06-12

---

## Table Schema — `cerberus_agents`

| Column | Type | Notes |
|--------|------|-------|
| `id` | String PK | UUID |
| `name` | String | Unique per owner (composite index) |
| `role` | String | architect / coder / tester / researcher / reviewer / security-auditor / custom |
| `agent_type` | String | Free-text agent class |
| `status` | String | active / idle / standby / alert |
| `current_action` | String (nullable) | Last or current task description |
| `score` | Integer | Default 0; incremented +1 per successful invocation |
| `system_prompt` | Text | The persona prompt sent as the system message |
| `model_alias` | String | Claude alias — sonnet / opus / haiku / fable |
| `owner` | String (FK-like) | Auth username |
| `created_at` | DateTime | Auto-set by TimestampMixin |
| `updated_at` | DateTime | Auto-updated by TimestampMixin |
| `last_active_at` | DateTime (nullable) | Set after each completed invocation |
| `metadata_json` | Text (nullable) | Extensible JSON blob |

**Table creation:** `Base.metadata.create_all(bind=engine)` in `init_db()` — runs at startup, creates the table if absent.

---

## Endpoint List

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents` | List current user's agents; lazy-seeds 6 defaults on first call |
| `POST` | `/api/agents` | Create an agent |
| `PATCH` | `/api/agents/{id}` | Update status / current_action / system_prompt / model_alias / score |
| `DELETE` | `/api/agents/{id}` | Delete |
| `POST` | `/api/agents/{id}/invoke` | Invoke via Claude Subscription (SSE stream) |

All routes auth-gated with `require_user`. Unauthenticated callers receive HTTP 401.

---

## Seed Behaviour

Triggered lazily on the first `GET /api/agents` when the user has zero agents. Seeds 6 default personas:

1. **ARCHITECT** — system-architect, sonnet
2. **CODER** — coder / backend-dev, sonnet
3. **TESTER** — tester, sonnet
4. **RESEARCHER** — researcher, sonnet
5. **REVIEWER** — reviewer, sonnet
6. **SECURITY** — security-auditor, sonnet (standby)

Each has a curated `system_prompt` tailored to its role. The seed is idempotent: it only creates agents that do not already exist by name for that owner.

---

## Invocation Flow

```
POST /api/agents/{id}/invoke  { "prompt": "..." }
  │
  ├── require_user() — 401 if not authenticated
  ├── require_user() + owner check — 403 if wrong owner
  ├── Read agent (system_prompt, name, id) from DB
  ├── Set agent.status = "active", agent.current_action = "Invoking: ..."
  ├── Return StreamingResponse (text/event-stream)
  │
  └── Stream via src.claude_subscription.stream_completion()
        messages = [
          {"role": "system", "content": agent.system_prompt},
          {"role": "user",   "content": user_prompt},
        ]
        │
        ├── Yields: data: {"delta": "text"}\n\n  (per chunk)
        ├── Yields: data: [DONE]\n\n             (on success)
        └── Yields: event: error\ndata: {...}    (on failure)

  After stream completes (_finalize_invocation):
    success → status = "idle", score += 1, last_active_at = now(), current_action = None
    error   → status = "alert", current_action = "Error — see response"
```

The `/api/agents` prefix is added to `_TIMEOUT_EXEMPT_PREFIXES` in `app.py` so the 45s hard timeout never kills an in-flight invocation.

---

## Frontend Changes (council.js)

- **Data source replaced**: `GET /api/agents` with `credentials: 'same-origin'` instead of the old `/api/cyberapps/operations/council` stub.
- **ACTIVATE/IDLE**: calls `PATCH /api/agents/{id}` with `{ status: "active" | "idle" }`. Updates local state on success.
- **INVOKE button**: opens an inline prompt input pane below each card. On SEND (or Enter), streams from `POST /api/agents/{id}/invoke` into a result pane.
- **DETAILS button**: opens a modal overlay showing role, status, model, score, and an editable `system_prompt` textarea with a SAVE button.
- **Demo fallback**: only triggers on HTTP 5xx / network errors. HTTP 401/403 shows an auth message instead of hiding the error behind demo data.
- **Score/status refresh**: after each invocation completes, re-fetches the agent list to update the score chip and status dot.

---

## Smoke Test Results

Manual steps for verification:

1. `docker compose up -d --build --force-recreate cerberus` from project root
2. Open Cerberus, log in, navigate to Command Center → Council
3. Verify 6 default agents appear (auto-seeded on first GET)
4. Click `[ IDLE ]` on an active agent → status flips, persists across page reload
5. Click `[ INVOKE ]` on ARCHITECT → enter "Describe a microservices architecture in one sentence" → response streams
6. Click `[ DETAILS ]` → overlay shows system_prompt + model_alias + score; SAVE PROMPT updates it
7. Hit `/api/agents` without cookie in a new browser tab → 401 JSON response

---

## Commits

1. `feat(agents): add CerberusAgent table + CRUD routes + seed defaults`
2. `feat(agents): wire /api/agents/{id}/invoke through Subscription provider`
3. `feat(command-center): COUNCIL now reads real agents + INVOKE button + DETAILS panel`
4. `chore(sw): bump cache to v349-jarvis-v2-agents-l2`
5. `docs(agents): level-2 implementation report`
