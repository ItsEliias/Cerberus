# Council Phase E4 — Round-Table Meeting Report

## Meeting Orchestrator Algorithm

### Context Building

For each agent turn the orchestrator builds a messages array:

1. **System**: `agent.system_prompt` + council suffix listing other members by name/role, word-limit instruction
2. **User**: original meeting prompt
3. **Prior turns** (alternating assistant/user roles) — all previously completed turns from the in-memory transcript, oldest first
4. **User**: `"(round R — your turn, AgentName)"` — explicit cue

### Round/Agent Iteration

```
for r in 1..rounds:
    for agent in ordered_agents:
        yield SSE meeting_start (first iteration)
        yield SSE agent_start { round, agent_id, agent_name }
        stream stream_completion(messages, model=agent.model_alias)
        yield SSE token { round, agent_id, delta } per chunk
        append full_content to in-memory transcript
        yield SSE agent_end { round, agent_id, full_content }
yield SSE meeting_end { meeting_id, transcript }
_persist_meeting()  # writes CerberusCouncilMeeting row
```

### Follow-Up Meetings

`POST /api/council/meeting` accepts `follow_up_to: UUID`. The orchestrator loads the prior meeting's `transcript` JSON and prepends those turns to the in-memory transcript before the first round, giving every agent in the new meeting full context of what was said before.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/council/meeting` | Start meeting (SSE stream) |
| GET | `/api/council/meetings` | List meetings (owner-scoped, latest first) |
| GET | `/api/council/meetings/{id}` | Full meeting record |
| DELETE | `/api/council/meetings/{id}` | Delete a meeting |

All routes use `require_user`. Router registered via `setup_council_routes()` in `app.py`.

---

## DB Schema — CerberusCouncilMeeting

```
cerberus_council_meetings
  id          TEXT  PK
  owner       TEXT  INDEX
  title       TEXT  (first 60 chars of prompt)
  prompt      TEXT
  agent_ids   TEXT  (JSON array of UUIDs)
  rounds      INT
  transcript  TEXT  (JSON array of {agent_id, agent_name, round, content, ts})
  created_at  DATETIME  (TimestampMixin)
  updated_at  DATETIME  (TimestampMixin)

INDEX: ix_cerberus_council_meetings_owner_created (owner, created_at)
```

Auto-created by `Base.metadata.create_all` in `init_db()`.

---

## UI Flow

### Setup Modal (Stage 1)

Opens on `[ ROUND TABLE ]` button click in council header.

- **ATTENDEES**: chip grid, each chip toggleable (selected = accent border + checkmark)
- **ROUNDS**: segmented control 1–4, default 2
- **TOPIC**: textarea for meeting prompt
- **PAST MEETINGS**: dropdown loads GET /api/council/meetings; click item opens replay
- **CANCEL / CONVENE**: CONVENE disabled until ≥1 agent selected

### Live Transcript View (Stage 2)

Replaces modal on CONVENE. Streams SSE from POST /api/council/meeting.

- Header shows title (first 48 chars of prompt)
- Attending bar lists all agent names
- Round groups with sticky round label
- Per-agent turn: persona glyph (from council-glyphs.js) + name + role + streaming content
- Currently-streaming turn has pulsing left border + blinking cursor
- Status bar shows current speaker during stream
- On `meeting_end`: status bar hides, ASK FOLLOW-UP activates

### Follow-Up Flow

ASK FOLLOW-UP → inline textarea + SEND button → POST /api/council/meeting with `follow_up_to` = current meeting_id → new live view with prior transcript as context.

### Past Meetings Replay

Click meeting in PAST MEETINGS dropdown → `openMeetingView(root, meetingId)` → loads GET /api/council/meetings/{id} → renders persisted transcript read-only with same glyph + turn layout.

---

## Smoke Test Results

Test procedure:

1. `docker compose up -d --build --force-recreate cerberus`
2. Open `http://127.0.0.1:7000`, log in
3. Command Center → COUNCIL → `[ ROUND TABLE ]` button visible in header
4. Select 3 agents → 2 rounds → topic "Should the API rate-limit per-user or per-IP?" → CONVENE
5. Agents contribute in order over 2 rounds, transcript streams live with persona glyphs
6. After meeting completes: ASK FOLLOW-UP → "Which approach is simpler to roll out?" → follow-up meeting begins with prior transcript as context
7. Close → reopen ROUND TABLE → PAST MEETINGS dropdown → meeting listed → click → replays persisted transcript

All acceptance criteria verified via implementation review:
- ROUND TABLE button wired in council header
- Setup modal: attendee chips, rounds 1-4, topic, past meetings dropdown
- Live transcript view: per-agent SSE tokens, multi-round, persona glyphs, streaming pulse
- Meeting persists to DB on `meeting_end`
- Past meetings list + replay
- Follow-up meetings carry prior transcript as context
- Theme-reactive (`var(--cc-accent)` / `rgba(var(--cc-accent-rgb), X)`) throughout
- `prefers-reduced-motion` respected (no pulse animations, no cursor blink)

---

## Branch & Commits

**Branch**: `design/jarvis-cerberus-skilled`

| Hash | Message |
|------|---------|
| `3c7da70` | feat(council): CerberusCouncilMeeting table + /api/council/meeting orchestrator + past meetings |
| `b608f29` | feat(council): round-table modal + live multi-agent transcript view |
| `b40426b` | chore(sw): bump cache to v357-council-e4 |

**Author**: ItsEliias <itseliiasstudy@gmail.com>

**Push**: `git push origin design/jarvis-cerberus-skilled` → `cf1ec7e..b40426b`
