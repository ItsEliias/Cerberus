# Cerberus — Visual QA Defect Report (Round 2: Hands-On Pass)

**Build:** v1.0.0 · **URL:** http://127.0.0.1:7000 (crimson build) · **Browser:** Google Chrome (confirmed via UA: `Chrome/148`, vendor "Google Inc." — not Vivaldi) · **Date:** 2026-06-22
**Account:** `claude-test` / `Cerb3rus!QA2026`
**Method:** This pass actually *exercised* controls — clicked buttons, typed into fields, submitted forms, opened every modal, created test data (a scheduled task, a room, a note), switched language, ran a comparison. DevTools console watched throughout.
**Safety:** Did not delete data, send emails, change the account password, set up 2FA, or run destructive actions. Those are listed under "Couldn't test."

---

## NEW defects found this pass (not in Round 1)

### BROKEN

**B1 — Opening Settings throws two JS errors every time.**
Location: Settings gear → modal open. Console (reproduced on every open):
`settings.js:853 Failed to load endpoints for TTS — TypeError: endpoints.forEach is not a function (initTtsSettings @ 848)` and the same for STT (`settings.js:1020 / initSttSettings @ 1017`). The TTS/STT voice settings fail to populate because the endpoints API returns a non-array. The rest of Settings still renders.

**B2 — AGENTS → INVOKE → Send is broken (ReferenceError).**
Location: AGENTS tab → expand any agent → INVOKE → type a prompt → Send. Console: `agents.js:694 ReferenceError: agent is not defined`. The invocation never runs; the panel stays "// NO INVOCATIONS YET" with no error shown to the user. (The model backend itself works — see COMPARE below — so this is a genuine code bug, not a missing model.)

**B3 — `agent is not defined` recurs as a background error.**
The same `agents.js:694` ReferenceError fires periodically (observed ~every 1–2 minutes) regardless of which view is open — it fired while I was in the chat shell with Gallery and Brain open, nowhere near the AGENTS tab. Suggests a polling/refresh timer in agents.js referencing an undefined `agent`.

**B4 — CC ASSISTANT directive send returns an API error.**
Location: Command Center → ASSISTANT tab → "Send directive to Cerberus…" → type "What is 2+2?" → SEND. The user message renders, then the assistant bubble shows: `Error: {"detail":"Message is required"}`. The message isn't being included in the request payload, so the operations-assistant chat is non-functional. (Again, the model works elsewhere — this is a payload bug specific to this composer.)

**B5 — WORKSPACE "+ NEW TASK" button does nothing.**
Location: WORKSPACE tab → "+ NEW TASK" (top-right, id `cc-sched-new-btn`). Clicking has no effect — no handler, zero DOM change (verified in code). The actual task-creation form is always rendered inline at the *bottom* of the tab, so the feature is reachable by scrolling, but the button that advertises it is dead.

### VISUAL

**V1 — Unstyled default buttons on creation forms.**
The "+ New Agent" form (Create / Cancel), the "+ New Room" form (Create / Cancel), and the resulting room card (Open / Delete) render as plain grey browser-default buttons with no crimson theme — they look out of place against the rest of the HUD.

**V2 — Another doubled `// //` prefix.**
AGENTS → INVOKE panel header reads "**// // RECENT INVOCATIONS**" — same systemic doubled-prefix bug catalogued in Round 1 (Memory Timeline, Compose Email, Message Log, Templates, My Presets, Select Agents).

### MINOR

**M1 — Partial i18n.** The language picker (EN → ES) translates the Command Center *tab labels* (COMANDO, CONSEJO, ESPACIO, FINANZAS, ASISTENTE, ENLACE, AGENTES, SALAS, COMPARAR, OBSERVAR) but **not** the panel headings ("// SWARM HEALTH", "// SYSTEM VITALS", etc.), panel content, or the left sidebar — those stay English. Inconsistent/incomplete translation.

**M2 — "+ Add Webhook" gives no feedback.** WORKSPACE → Git Changes → "+ ADD WEBHOOK" does nothing visible; the panel says "Admin access required" (the test account is a regular User), but the button gives no message when clicked.

**M3 — New scheduled task shows a full UUID.** After creating a task, COMMAND → Running Tasks shows my task with its full UUID (`8f37e69e-56e0-4705-…`) wrapping across 4 lines and misaligning the row, whereas built-in tasks show short 8-char IDs.

**M4 — AGENTS "ACTIVE" filter empty state is blank.** Selecting the ACTIVE chip (0 active agents) shows empty column headers with no "no active agents" message.

**M5 — Calendar Month view looks truncated.** The Month grid renders only ~2 week-rows (current week + next) rather than the full month; low confidence (may be panel-height clipping).

**M6 — Cookbook background 403s.** `/api/cookbook/state` and `/api/cookbook/tasks/status` return 403 (background polls); the Cookbook UI itself loads and works.

---

## Areas confirmed WORKING (exercised hands-on)

**Model backend / COMPARE** — Typed "What is 2+2?", selected ARCHITECT + CODER, ran comparison; **both agents streamed real answers ("4")**. The LLM backend (llama-3.3-70b) is live and responding.

**Chat composer (shell)** — Message field accepts text; model picker opens and is searchable (Groq / Llama / Gemini groups); Agent/Chat toggle works (Agent mode adds a `>_` tool); the `^` menu opens (Attach files / Documents / TTS Mode / Prompt). Note: the model-name label is replaced by the send button once text is entered.

**Settings — every section opened and exercised:** Add Models (Local & API expanders reveal URL/Type/Scan/Test/Add); AI Defaults (default + utility model, Add fallback); Search (provider dropdown, results, URL, DuckDuckGo fallback, Test); Integrations (+ Add Integration → Type select); Email (writing-style textarea accepts input, Extract/Save); Reminders (Channel dropdown, **AI Synthesis toggle flips on/off correctly**, Public URL); Appearance (Reduce HUD, Session Header, Welcome, Incognito, Text-only Emojis, Thinking Process, Sensitive Blur toggles + Reset All); Shortcuts (full keymap); Account (**password validation works — empty submit shows "Fill in all fields"**, 2FA section present).

**WORKSPACE** — Filled the inline form (Name/Prompt/Schedule=Daily/Time/Agent) and **created "QA Test Task" → "// TASK CREATED"**; it then appeared in COMMAND→Running Tasks and the Tasks tool. Schedule dropdown (Once/Daily/Weekly/Monthly) and Agent dropdown (none + all 16 agents) populate correctly.

**AGENTS** — Row expands to show System Prompt, Health (Status OK / Errors 0), Reset Health, and Quick Actions (Chat/Invoke/Call/Memory/Edit/Del); EDIT opens a full editable form (Avatar/Name/Role/Type/Model alias/TTS voice/System prompt); filter chips switch the roster (ALL/ACTIVE/IDLE/STANDBY/READY); "+ New Agent" opens a creation form. (INVOKE Send is broken — B2.)

**ROOMS** — "+ New Room" form (name + 16 participant chips); **created "QA TEST ROOM" with ARCHITECT + CODER → shows as ROUTED.**

**ASSISTANT sub-nav** — PROFILE shows onboarding data; **NOTES: created & saved "QA Test Note"** with a live word/char counter (12 words · 64 chars); DOCS/CONTACTS/MEMORY/MORE all render (CONTACTS still 403 per Round 1).

**Global** — Cmd+K opens "Search conversations" palette (in chat shell); **REFRESH** updates the vitals; **language picker** switches EN/ES (partially, M1); the "?" button re-runs the guided tour.

**Sidebar tools — all open and function:** Brain (Memories/Skills/Add/Settings, shows operator_profile memory), Calendar (Week/Month/Year/Agenda, quick-add, event search), Compare, Cookbook (Download/Serve/Dependencies/Settings, HuggingFace download, hardware scan with model-fit table), Deep Research (query + Auto/Product/Compare/How-to/Fact-check modes, Rounds/Engine/Endpoint/Model settings), Gallery (Photos/Albums/Edit/Settings, upload empty state), Library (Chats/Documents/Research/Archive, Import/Create), Notes, Tasks (categorized: all 11 / calendar / email / etc., with RUN + ⋮), Theme (22 themes + Customize).

**Console** — Aside from B1–B4 above, the only other message is the benign `TTS: not available` warning. No other red errors during normal navigation.

---

## Couldn't test (by safety policy or environment)

- **Sending email** — GATEWAY compose-email form fills, but I did not click Send (no real outbound mail).
- **Deletions** — Delete on scheduled tasks, agents, rooms, memories, notes (the test data I created is left in place for you to inspect/remove).
- **Password change / 2FA enrolment** — would risk locking the test account; only validated the empty-submit error.
- **Voice / STT / TTS** — needs a microphone; TTS reports "not available" and its settings init errors (B1).
- **Add Webhook** — admin-gated for this account (M2).
- **Running a scheduled task** (the RUN button in Tasks) — would execute a live job; skipped.

---

## Test data created (for cleanup)
- Scheduled task **"QA Test Task"** (Daily 19:00) — WORKSPACE / Tasks
- Conference room **"QA TEST ROOM"** (ARCHITECT, CODER) — ROOMS
- Note **"QA Test Note"** — ASSISTANT → Notes
- An unsaved "QA test writing style sample." was typed into Settings → Email (not saved)

---

## Priority for developers
1. **B2/B3** `agents.js:694 agent is not defined` — breaks agent invocation and spams the console on a timer. Likely a single variable-scope bug.
2. **B4** ASSISTANT directive payload ("Message is required") — assistant chat is dead.
3. **B1** Settings TTS/STT `endpoints.forEach` — voice settings can't load.
4. **B5** dead "+ NEW TASK" button.
5. **V1/V2** unstyled creation-form buttons + the doubled `// //` prefixes (shared template fix).
6. Round 1 items still stand (Orbitron "0" glyph, AGENTS RUN-button overlap & clipped ••• menu, etc.).
