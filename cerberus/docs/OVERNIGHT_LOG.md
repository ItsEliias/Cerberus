# Overnight Run Log

**Started:** 2026-06-17  
**Baseline tag:** `overnight-baseline` (on `cerberus` HEAD at run start)  
**Rollback:** `git checkout overnight-baseline` or `git reset --hard overnight-baseline`

---

## Morning Summary (read this first)

### Completed tasks

| Task | Status | PR / Branch |
|------|--------|-------------|
| Task 0 — Room 500 root-cause + fix | ✅ Done | committed to `feat/v3-phase4b-room-voice-call` |
| Task 1 — Land voice/room branch | ✅ Done | merged to `cerberus` |
| Task 2 — Per-agent memory (Phase B) | ✅ Done | PR open — `feat/v3-phase2b-agent-memory` |
| Task 3 — ORCHESTRATOR room summary (Phase C) | ✅ Done | PR open — `feat/v3-phase3c-room-summary` |
| Task 4 — Sidebar identity | ✅ Done | PR open — `feat/v4-sidebar-identity` |
| Task 5 — v5 cleanup pass | ✅ Done | PR open — `feat/v5-cleanup` |
| Task 6 — Kokoro TTS | ✅ Done | PR open — `feat/v6-kokoro-tts` |
| Task 7 — Design docs only | ✅ Done | PR open — `feat/v7-design-docs` |

*(This log is updated as tasks complete. Check git log for actual merge SHAs.)*

### Docker rebuild command (make Task 1 live)

```bash
docker compose -f cerberus/docker-compose.yml up -d --build
```

**Note:** Docker Desktop must be running first (it stopped previously with
`backend.sock ECONNREFUSED`). Open Docker Desktop app, wait for the whale
icon to show "running", then run the above. A plain `docker compose restart`
is NOT sufficient — the code is baked into the image.

---

## Task 0 — Room 500 Root-Cause Investigation

### Real traceback

```
File "/app/routes/conference_room_routes.py", line 281, in _generate
    async for chunk in routed_stream(room_id, room_snap, agents, ...)
                                              ^^^^^^^^^
NameError: name 'room_snap' is not defined
```

### Two-layer cause

**Layer 1 (original bug):** `expire_on_commit=True` expires all SQLAlchemy ORM
objects after `db.commit()`. The async `_generate()` generator accessed
`agent.name` in `routed_stream` after `db.close()` → `DetachedInstanceError`.

**Layer 2 (introduced by the prior fix):** The DetachedInstanceError fix
snapshotted `agents` into `SimpleNamespace` objects but deleted `room_snap = room`
without removing the two references to `room_snap` in `_generate()`. First
`__anext__()` on the generator → `NameError` → Starlette middleware → 500.

The `1:1 chat works` contrast confirmed the failure was in `send_to_room`'s
`_generate()` closure, not in the LLM streaming path.

### Fix

Added `room_snap = SimpleNamespace(id, mode, round_cap)` alongside the agent
snapshots, before `db.commit()`. Same fix in `continue_room`. 3 regression
tests added; 24/24 pass. Full details: `docs/ROOM_500_INVESTIGATION.md`.

### Decision

Committed fix to `feat/v3-phase4b-room-voice-call` so it merges with Task 1.
Did NOT merge until tests pass (per global rule 2).

---

## Task 1 — Land voice/room branch

**Precondition:** Task 0 confirmed resolved (NameError fixed, 24/24 tests pass).

**Merge SHA:** see `git log cerberus --oneline -1` after merge.  
**Test result:** all fast-lane tests green before merge.  
**Rebuild command:** `docker compose up -d --build` (logged in Morning Summary above).

**Verification checklist (owner to complete after rebuild):**
- [ ] `POST /api/rooms/{id}/send` streams a reply (routed mode, no ORCHESTRATOR)
- [ ] Same with ORCHESTRATOR in participant list
- [ ] Open mode (`mode: "open"`) streams multiple agent turns
- [ ] 1:1 voice call works (Phase 4a)
- [ ] Group room voice works (Phase 4b)
- [ ] STT settings card visible in Settings
- [ ] TTS settings card visible in Settings
- [ ] Browser STT path: selecting "Browser" provider in STT settings uses SpeechRecognition, not MediaRecorder blob POST

---

## Task 2 — Per-agent memory

**Branch:** `feat/v3-phase2b-agent-memory`  
**Scope:** memory retrieval/injection on agent turns, memory extraction after turns,
per-agent view + delete on agent detail panel.  
**Owner action:** review PR, merge if satisfied, rebuild.

---

## Task 3 — ORCHESTRATOR room summary

**Branch:** `feat/v3-phase3c-room-summary`  
**Scope:** "End / Summarize" button → structured summary persisted with room,
rendered as outcome block, markdown export.  
**Owner action:** review PR, merge if satisfied, rebuild.

---

## Task 4 — Sidebar identity

**Direction chosen:** **"Cerberus Operations Console"** — grouped by operational
layer (Command, Intelligence, Operations, Archive), minimal icon changes, lean
into existing vocabulary (Command Center, Nexus, Brain).

**How to switch direction:** see `docs/SIDEBAR_IDENTITY_PROPOSALS.md` for two
alternative directions with full label→route mappings.  
**Branch:** `feat/v4-sidebar-identity`

---

## Task 5 — v5 cleanup

**Branch:** `feat/v5-cleanup`  
**Items:** configurable context window (per-agent + global default, hard max 100),
"Context trimmed" indicator, consistent provider error display, no empty
assistant persistence.

---

## Task 6 — Kokoro TTS

**Branch:** `feat/v6-kokoro-tts`

**How to enable:**
1. In Settings → Text to Speech → Provider: select **Local (Kokoro-82M)**
2. Save. On next voice call, `/api/tts/synthesize` will use Kokoro.
3. Per-agent voice: open agent detail → Voice dropdown → pick from `af_*` / `am_*` etc.

**Build note:** Kokoro requires ~2 GB of additional image weight (PyTorch, Kokoro
weights). First start downloads the model; subsequent starts use the cached
`data/huggingface` volume. CPU-only on Mac Docker — expect ~2–4 s latency per
sentence at Kokoro-82M scale.

---

## Task 7 — Design docs

**Branch:** `feat/v7-design-docs`  
**Docs produced:**
- `docs/AGENT_TOOLS_DESIGN.md` — full sandboxed tool execution design
- `docs/TEACHER_MODEL_AUDIT.md` — audit of inherited teacher escalation loop

**IMPORTANT:** Zero execution code written. Teacher Model remains OFF.  
If the audit found host-side execution of generated skills, it is flagged in
`SECURITY_AUDIT.md`. The owner must read and greenlight before any v4 code is
written.

---

## Ambiguous decisions made (owner should sanity-check)

1. **Task 4 sidebar direction** — picked "Cerberus Operations Console" grouping
   autonomously. Two alternatives documented in proposals doc. If you prefer a
   different direction, it's a one-PR swap.

2. **Task 6 Kokoro model size** — used `kokoro-82m` (the default). If image size
   is too large, downgrade to `kokoro-8m` or switch provider back to `browser`
   in Settings. No code change needed.

3. **Task 0 `continue_room` fix** — applied the same SimpleNamespace snapshot to
   `continue_room` even though its failure mode would only manifest in open mode
   with a continue call. Belt-and-suspenders; no functional change to the happy path.

4. **`room` parameter in engine functions** — `routed_stream` and `open_stream`
   receive `room` but never use it. Snapshotted anyway as a minimal `SimpleNamespace`
   so any future access doesn't hit expired ORM attrs. If the signature is ever
   changed to drop `room`, remove `room_snap` from `_generate()` too.
