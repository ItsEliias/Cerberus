# Room 500 Investigation

**Status:** RESOLVED  
**Date:** 2026-06-17  
**Branch:** feat/v3-phase4b-room-voice-call

---

## Traceback (from `docker logs cerberus-cerberus-1`)

```
INFO: 172.18.0.1:55256 - "POST /api/rooms/61e80b7d-0e1a-4e2a-9e1d-7f053473424f/send HTTP/1.1" 500 Internal Server Error
...
  File "/app/routes/conference_room_routes.py", line 281, in _generate
    async for chunk in routed_stream(room_id, room_snap, agents, text, owner, SessionLocal):
                                              ^^^^^^^^^
NameError: name 'room_snap' is not defined
```

---

## Root Causes (two, layered)

### Cause 1 — `DetachedInstanceError` (original 500, pre-Phase 4b commit)

`SQLAlchemy` defaults to `expire_on_commit=True`. After `db.commit()` in
`send_to_room`, all loaded ORM objects (the `agents` list) have their
attributes expired. After `db.close()`, the async `_generate()` generator
accessed `agent.name` inside `routed_stream` / `_route_message`, triggering
a lazy-reload attempt against the closed session → `DetachedInstanceError`.

**Partial fix applied:** agent objects were snapshotted into
`types.SimpleNamespace` before commit, so `DetachedInstanceError` was
eliminated.

### Cause 2 — `NameError: name 'room_snap' is not defined` (the actual surviving 500)

The `DetachedInstanceError` fix deleted the line `room_snap = room` but left
two references to `room_snap` in the `_generate()` closure (lines 278/281).
Python's async generator is lazy — the body executes on first `__anext__()`
call, which happens inside Starlette's `StreamingResponse.__call__` AFTER the
middleware has committed to proxying the response body. The Starlette
`BaseHTTPMiddleware` re-raises generator body exceptions through `call_next`,
which the error middleware converts to a 500 before any bytes reach the client.

This explains why both `routed` and `open` mode failed, with and without
ORCHESTRATOR, voice and text — the `NameError` fires on the first iteration
regardless of room configuration.

**The `1:1 chat works` contrast:** `POST /api/agents/{id}/thread/send`
uses a completely different handler (`cerberus_agent_thread_routes.py`) that
never references `room_snap` and never queries `ConferenceRoom`. The contrast
was the primary diagnostic clue.

---

## What Was NOT the Cause

- DB schema: all Phase 3b columns (`mode`, `round_cap`, `total_input_tokens`,
  `total_output_tokens`) present in the live `data/app.db` (same file Docker
  mounts via `./data:/app/data:z`).
- `_effective_cap`: called before commit/close, so agents are still valid.
- `build_context_messages`: never reached (error fires before any yield).
- `tts_voice` / `_agent_voice()`: handled safely via `getattr` with fallback.

---

## Fix Applied

**File:** `cerberus/routes/conference_room_routes.py`

Added `room_snap` as a `SimpleNamespace` snapshot alongside the agent
snapshots, before `db.commit()`:

```python
room_snap = _types.SimpleNamespace(
    id=room.id, mode=mode,
    round_cap=getattr(room, "round_cap", None),
)
agents = [
    _types.SimpleNamespace(
        id=a.id, name=a.name,
        model_alias=a.model_alias,
        system_prompt=a.system_prompt or "",
        tts_voice=getattr(a, "tts_voice", None) or "",
    )
    for a in agents
]
```

Same fix applied to `continue_room` handler.

---

## Regression Tests Added

Three tests in `tests/test_agent_phase4b_room_voice.py`:

1. `test_send_to_room_generate_works_with_simplenameespace_snapshots` — iterates
   `_generate()` closure with `SimpleNamespace` inputs, verifies it reaches `[DONE]`.
2. `test_send_to_room_generate_no_agents_emits_error_not_nameerror` — verifies
   empty-agents path emits the error event without touching `room_snap`.
3. `test_room_snap_is_defined_in_send_to_room_source` — structural guard: if
   `room_snap =` is ever deleted from `send_to_room`, this test fails immediately.

All 24 tests pass.

---

## Proof of Fix

After committing and rebuilding the Docker container
(`docker compose up -d --build`), room sends must work in all four
combinations:

| Mode | ORCHESTRATOR | Expected |
|------|------|------|
| routed | without | Agent reply streams, no 500 |
| routed | with | ORCHESTRATOR routes → agent reply |
| open | without | Round-robin agents reply up to cap |
| open | with | ORCHESTRATOR-conducted discussion |
