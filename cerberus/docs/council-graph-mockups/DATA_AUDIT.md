# COUNCIL Graph — Data Audit Report

**Branch:** `feat/council-graph`  
**Date:** 2026-06-19  
**Scope:** §1 of the COUNCIL master prompt — investigate what routing/hand-off data currently exists before designing or building anything.

---

## Executive Summary

**The short answer: real-time live animation from actual hand-off data does NOT exist today.** The routing decision is made in Python, emitted as a transient SSE event, and discarded — nothing is written to the database. What IS available is a post-hoc transcript of which agents spoke in what order, queryable from the existing `room_messages` table.

This means v1 of the graph has three honest options (detailed in §5 below).

---

## §1 — Does routed-mode record agent-to-agent hand-offs?

### Finding: No persistent routing log exists.

Traced through both routing paths:

**Path A — `routed_stream()` in `conference_room_engine.py:276-296`:**
```python
target, _ = await _route_message(agents, user_text, owner)
# ...
yield f'event: route\ndata: {json.dumps({"agent": target.name, "agent_id": target.id, ...})}\n\n'
# Then streams the agent's response — which IS persisted via _persist_turn()
```
The `route` SSE event is emitted but **never written to any table**. `_persist_turn()` (line 128-151) only writes the agent's final response text + token counts to `room_messages`.

**Path B — `open_stream()` in `conference_room_engine.py:299-354`:**
```python
agent, converged = await _conduct_next_speaker(orchestrator, others, ...)
# ...
yield f'event: route\ndata: {json.dumps({"agent": agent.name, ...})}\n\n'
# _conduct_next_speaker() reads transcript, sends ORCHESTRATOR an LLM call,
# parses "ROUTE:<NAME>" or "ROUTE:DONE" — none of this is persisted.
```
Same pattern: routing decision is ephemeral. `_conduct_next_speaker()` (line 203-273) performs a full LLM inference call to ask ORCHESTRATOR who speaks next, gets back `ROUTE:CODER`, and discards it after yielding the SSE event.

**What IS in the database after a room session:**

`room_messages` table (per `core/database.py:792-804`):
```
id          | UUID
room_id     | FK to conference_rooms.id
role        | "user" | "agent"
sender_id   | agent UUID (NULL for user messages)
sender_name | "USER" | "CODER" | "ARCHITECT" etc.
content     | full text response
timestamp   | when _persist_turn() committed
```

From this you can reconstruct **who spoke in what order** — that's it. You cannot distinguish "ORCHESTRATOR routed to CODER" vs. "round-robin landed on CODER" from the DB alone. There is no `routed_by` column, no `routing_event` row.

---

## §2 — Is it live-streamable?

### Finding: No. SSE streams are one-shot, single-consumer; no broadcast bus exists.

The `/api/rooms/{id}/send` endpoint (conference_room_routes.py:230-292) returns a `StreamingResponse`. The client that POSTed the message consumes the stream. No other process can tap it.

There is no:
- WebSocket per room
- asyncio pub/sub or event queue that multiple consumers can subscribe to  
- Server-Sent Events broadcast endpoint that a graph could independently subscribe to

The graph UI in the COUNCIL tab would have **no way to observe an active room stream** unless it was the initiating client — and rooms are driven from the Rooms tab, not COUNCIL.

For the eventual live build, a broadcast mechanism would need to be added. The lightest option would be an in-memory `asyncio.Queue` per room (populated when `event: route` is emitted) with a dedicated SSE endpoint the graph subscribes to.

---

## §3 — What is available per hand-off?

### From the transient SSE `event: route` (only during active stream):
| Field | Value | Example |
|---|---|---|
| `agent` | name string | `"CODER"` |
| `agent_id` | agent UUID | `"abc-123"` |
| `tts_voice` | voice string | `"nova"` |

**Not available:** source agent, ORCHESTRATOR's reasoning, which candidates were considered, confidence, task/subtask context, or anything about why this agent was chosen.

### From the persistent `room_messages` table (always queryable):
| Field | Value |
|---|---|
| `sender_name` | Who spoke (e.g. `"CODER"`) |
| `sender_id` | Agent UUID |
| `room_id` | Which room |
| `timestamp` | When the turn completed |
| `content` | Full response text |
| `role` | Always `"agent"` for non-user rows |

The sequence of `room_messages` ordered by `timestamp` within a `room_id` gives you the **edge sequence** (user→ORCHESTRATOR→CODER→REVIEWER→…) post-hoc.

---

## §4 — What would need to be added for a real live graph?

A minimal event logging layer, as a **separate future step**:

**1. New DB table: `routing_events`**
```sql
CREATE TABLE routing_events (
    id          TEXT PRIMARY KEY,
    room_id     TEXT NOT NULL,
    timestamp   DATETIME NOT NULL,
    from_agent  TEXT NOT NULL,  -- "ORCHESTRATOR" or "round-robin"
    to_agent    TEXT NOT NULL,  -- name of chosen agent
    mode        TEXT,           -- "routed" | "open"
    decision    TEXT            -- raw "ROUTE:CODER" string
);
```
Written inside `routed_stream()` and `open_stream()` just before each `yield route` event. Adds one synchronous DB write per routing step (minimal overhead).

**2. Broadcast SSE endpoint: `GET /api/rooms/{id}/graph-stream`**
An SSE endpoint the COUNCIL graph subscribes to. Uses an asyncio Queue (one per room_id, room in process memory). `open_stream()` and `routed_stream()` push routing events onto the queue; this endpoint drains it. Cleans up on client disconnect.

**3. Optional: Graph-state REST endpoint: `GET /api/rooms/graph-state`**
Returns the last N routing events per active room — for cold-start rendering without waiting for a routing event.

---

## §5 — What can v1 honestly show?

Three options, ordered by data authenticity:

### Option A — Static roster graph (no routing data at all)
- Source: `GET /api/agents` (already used by `council.js`)
- Show: ORCHESTRATOR centered, all agents as nodes, static edges to each specialist (the structural "org chart" view)
- Live element: node status dots (`active`/`idle`/`standby`) polled every ~5s
- Honest about what it is: a topology map, not a live activity feed
- **Verdict: Low-risk, always works, genuinely useful as the structural view**

### Option B — Transcript replay (real data, not live)
- Source: `GET /api/rooms/{id}` → `messages` array
- When a room is selected, fetch its transcript, infer the speaker sequence, animate edges in timestamp order (1s per step)
- Real data, real sequences — just a replay of what happened, not what's happening now
- Could auto-refresh every 3s: new messages appear as new edge pulses
- **Verdict: Real data, polling-based "near-live," no backend changes needed**

### Option C — Live graph with routing events (requires backend addition)
- Requires: `routing_events` table + broadcast SSE endpoint (§4 above)
- Graph subscribes to `/api/rooms/{id}/graph-stream`; edges light up in real time as ORCHESTRATOR routes
- True live animated graph
- **Verdict: The target vision, but needs new infrastructure first**

---

## Recommendation for v1

Build **Option A + B** together — the two views the master prompt already envisions:
- **Structural/hierarchy view** = Option A (static roster, always visible, status-polled)
- **Activity/network view** = Option B (transcript replay for selected room, edges sequence-animated from real message data, polling-refreshed)

Label Option B clearly as "session replay" not "live feed" — honest about what it is. When Option C infrastructure is added later, the activity view seamlessly upgrades from replay to live.

The mockups should show both modes and the toggle between them.

---

**STOP — awaiting owner review before proceeding to mockups.**
