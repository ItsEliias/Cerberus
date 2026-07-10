# Cerberus — Visual QA Defect Report

**Build:** v1.0.0 · **URL audited:** http://127.0.0.1:7000 · **Date:** 2026-06-22
**Test account:** `claude-test` / `Cerb3rus!QA2026` (fresh signup, 5-step onboarding completed with placeholder data)
**Scope:** Nexus dashboard + all 10 Command Center tabs + global UI. Findings-only; nothing was changed (one temporary diagnostic span was injected to confirm a font bug and removed immediately).

**Severity key:** `BROKEN` = doesn't work / looks broken · `VISUAL` = looks wrong · `MINOR` = polish

---

## Headline findings

1. **The bundled "Orbitron" font renders the numeral `0` as a slashed rounded-square glyph** — it looks identical to a broken-image placeholder. This single bug is the cause of every "broken image" square seen on the Dashboard, COMMAND (Swarm Health) and OBSERVE. Confirmed by rendering `Orb:0123A` vs `Mono:0123A` side by side: the Orbitron zero is a square-with-slash; the monospace zero is normal. `BROKEN`
2. **AGENTS tab action controls are badly broken** — the RUN button overlaps its own icon and run-count, the controls sit in the wrong place (far left, under the health dots, not in the ACTIONS column), and the ••• overflow menu clips its labels. `BROKEN`
3. **Systemic doubled `// //` section prefixes** appear on at least 6 panels across ASSISTANT, GATEWAY, ROOMS and COMPARE. `VISUAL`

---

## Global / cross-page

| # | Location | Defect | Severity |
|---|----------|--------|----------|
| G1 | Any Orbitron numeral showing `0` | "Orbitron" webfont renders `0` as a slashed rounded-square (looks like a broken-image icon). Affects Dashboard stats, COMMAND Swarm Health, OBSERVE counts, and the `$0.0000` cost figure. Real Orbitron should show a normal zero. | BROKEN |
| G2 | `localhost:7000` vs `127.0.0.1:7000` | `localhost:7000` serves a **green-on-black** themed login; `127.0.0.1:7000` serves the intended **crimson-on-void** theme. Two different builds/instances appear to answer on the same port depending on host. | VISUAL |
| G3 | Console (all pages) | No JavaScript errors. Only a benign warning `TTS: not available` (tts-ai.js:59) and an info log. | — (clean) |
| G4 | Network | `403 Forbidden` on `/api/cookbook/state`, `/api/cookbook/tasks/status`, and the Assistant contacts endpoint. Fonts (Orbitron, JetBrainsMono, FiraCode) all load 200. | MINOR |

---

## Nexus dashboard (`/home`)

| # | Location | Defect | Severity |
|---|----------|--------|----------|
| N1 | Globe node label "Settings" (left edge) | Label is clipped by the left viewport edge — renders as "ettings". (Globe rotates, so position is animation-dependent, but labels at the left extent run off-screen.) | VISUAL |
| N2 | Voice status bar | Renders correctly: Wake Listening / Passive Wake: ON / Conversation: OFF / Speak: OFF / Desktop Disabled / Last: —. | — (OK) |
| N3 | ASSISTANT node | Clicking opens the "// CERBERUS Assistant" command modal correctly (single `//`, Clear + Open Full Assistant work). | — (OK) |

---

## Dashboard / "Guardian" home (`/dashboard`)

| # | Location | Defect | Severity |
|---|----------|--------|----------|
| D1 | "TOTAL SESSIONS" & "TOTAL TOKENS" cards; "// SESSIONS 0" stat | Value `0` renders as the slashed-square glyph (see G1) — reads as a broken image. | BROKEN |
| D2 | Quick Access tiles "NEW CHAT" and "CERBERUS", and the "START YOUR FIRST CHAT →" button | Do nothing on click — no navigation, no feedback. (COMMAND CENTER and NEXUS tiles do work.) | BROKEN |
| D3 | "// TOKEN FLOW · LAST 24H" chart | Shows randomized data (full sine wave) despite 0 sessions / 0 tokens, and the shape changes on every load (sometimes a short rising stub, sometimes a full wave). Mock data, inconsistent with the empty account state. | MINOR |
| D4 | Cmd+K / Ctrl+K on this view | Does not open the search palette here (works in the chat shell — see U1). | MINOR |
| D5 | "// ACTIVITY · LAST 30 DAYS" heatmap | Empty grid — reads as an intentional empty state, OK. | — (OK) |

---

## Command Center — COMMAND tab

| # | Location | Defect | Severity |
|---|----------|--------|----------|
| C1 | "// SWARM HEALTH" — ACTIVE / TOTAL / RUNNING | All three values are `0` and render as the slashed-square glyph (G1) — look like 3 broken images. | BROKEN |
| C2 | "// TELEMETRY FEED" | CPU sparkline shows a waveform, but RAM and LATENCY render as flat horizontal lines (no waveform), so they look broken/empty next to CPU. | VISUAL |
| C3 | "// SYSTEM VITALS" gauges | Gauges render correctly but use yellow / blue / green / purple accents rather than the crimson theme. | MINOR |
| C4 | CERBERUS CORE / globe / Model Status / Gateway | Render correctly. | — (OK) |

---

## Command Center — COUNCIL tab

| # | Location | Defect | Severity |
|---|----------|--------|----------|
| CO1 | Hierarchy view | Orchestrator → tiers org-chart renders cleanly; status panel (0 active / 11 idle / 5 standby = 16) is consistent. | — (OK) |
| CO2 | "Session Replay" sub-tab | "// SELECT A ROOM TO REPLAY SESSION" with room dropdown — intentional empty state. | — (OK) |

---

## Command Center — WORKSPACE tab

| # | Location | Defect | Severity |
|---|----------|--------|----------|
| W1 | Panel headers: SCHEDULED TASKS, GIT CHANGES, WEBHOOKS, CRON JOBS | Each header has an **orphan `//`** label (no following text) pinned at the far left, in addition to the centered "// TITLE". | VISUAL |
| W2 | Scheduled tasks list | Renders fine; ACTIVE/PAUSED badges + Pause/Resume/Delete buttons present (not exercised to avoid state changes). | — (OK) |
| W3 | GIT CHANGES / WEBHOOKS body | "Admin access required." — permission empty state, OK. | — (OK) |

---

## Command Center — FINANCE tab

| # | Location | Defect | Severity |
|---|----------|--------|----------|
| F1 | "// DAILY TOKEN USAGE" & "// DAILY COST" charts | Render as a bare dashed baseline with no axis labels or empty-state text — inconsistent with the "// NO DATA" message used by the Cost-by-Agent / Cost-by-Model panels just below. | MINOR |
| F2 | Tokens this month / Free Tier badge | Render correctly. | — (OK) |

---

## Command Center — ASSISTANT tab

| # | Location | Defect | Severity |
|---|----------|--------|----------|
| A1 | Chat area (empty state) | The "Cerberus Operations Assistant ready…" greeting is pinned to the top, leaving ~600px of empty dead space above the composer. | VISUAL |
| A2 | Sub-nav → CONTACTS | Shows "// CONTACTS UNAVAILABLE — HTTP 403" — an error state (the contacts endpoint returns 403). | BROKEN |
| A3 | Sub-nav → MEMORY | Header reads "**// // MEMORY TIMELINE**" (doubled prefix). | VISUAL |
| A4 | Sub-nav → PROFILE / NOTES / DOCS / MORE | Render correctly (Profile shows onboarding data; Notes/Docs/Recent-searches show clean empty states). | — (OK) |

---

## Command Center — GATEWAY tab

| # | Location | Defect | Severity |
|---|----------|--------|----------|
| GW1 | Compose Email panel header | Reads "**// // COMPOSE EMAIL**" (doubled prefix). | VISUAL |
| GW2 | Message Log panel header | Reads "**// // MESSAGE LOG**" (doubled prefix). | VISUAL |
| GW3 | Cron Jobs panel header | Orphan `//` label at far left (as W1). | VISUAL |
| GW4 | "Gateway Status" vs "Platform Status" | Telegram / Discord / Slack status is listed twice on the same tab (redundant panels). | MINOR |
| GW5 | Compose Email "To" field | Pre-filled with `itseliias@proton.me`, which differs from the account email — verify this isn't a hard-coded address. | MINOR |

---

## Command Center — AGENTS tab

| # | Location | Defect | Severity |
|---|----------|--------|----------|
| AG1 | Every agent row — RUN button | The button's label, its up-arrow icon and the run-count `0` are all stacked on top of each other ("RUN↑0" colliding). | BROKEN |
| AG2 | Every agent row — action controls | RUN / ••• render at the **far left, beneath the health dots**, not in the right-hand ACTIONS column (which only shows "—"). They crowd into the group-divider rows (e.g. overlap near "// CORE"). | BROKEN |
| AG3 | ••• overflow menu | Menu items are clipped — they read "ALL / MORY / IT / LETE" instead of the full words (MEMORY / EDIT / DELETE). Menu is too narrow / mis-positioned at the viewport edge. | BROKEN |
| AG4 | Column grid | AGENT / ROLE / MODEL / SCORE / ACTIONS headers don't line up with where the row content actually renders (agent name, emoji icon, badges float at varying x positions). | VISUAL |
| AG5 | Health dots | Two-dot indicators per row render without collision. | — (OK) |

---

## Command Center — ROOMS tab

| # | Location | Defect | Severity |
|---|----------|--------|----------|
| R1 | Templates section header | Reads "**// // TEMPLATES**" (doubled prefix). | VISUAL |
| R2 | My Presets section header | Reads "**// // MY PRESETS**" (doubled prefix). | VISUAL |
| R3 | Template cards | 7 cards (Ship a Feature, Security Audit, Research & Plan, Debug & Fix, Data Sprint, Design Review, Optimise) render correctly with emoji icons. | — (OK) |

---

## Command Center — COMPARE tab

| # | Location | Defect | Severity |
|---|----------|--------|----------|
| CM1 | Select-agents section header | Reads "**// // SELECT AGENTS (MAX 4)**" (doubled prefix). | VISUAL |
| CM2 | Agent selection → RUN | Selecting ≥2 agents correctly updates the counter ("2/4 … ready") and enables "// RUN COMPARISON". | — (OK) |

---

## Command Center — OBSERVE tab

| # | Location | Defect | Severity |
|---|----------|--------|----------|
| O1 | "TOTAL TOKENS" & "SESSIONS" cards | Values are `0` and render as the slashed-square glyph (G1) — look like broken images. | BROKEN |
| O2 | "DAILY USAGE" & "DAILY COST" charts | Flat empty baseline (see F1). | MINOR |
| O3 | Section labels | Inconsistent prefixing — "// TOKEN OBSERVABILITY", "// SYSTEM DIAGNOSTICS", "// DATABASE" have the `//` prefix, but "DAILY USAGE…" and "PER-AGENT BREAKDOWN…" do not. | MINOR |
| O4 | System Diagnostics / Database / Bus Trees | All three show "// UNAVAILABLE" (likely backend not running locally; flagged in case it should degrade more gracefully). | MINOR |

---

## Global UI controls (tested)

| # | Control | Result | Severity |
|---|---------|--------|----------|
| U1 | Cmd+K / Ctrl+K palette | Opens "Search conversations…" overlay correctly **in the chat shell**; does nothing on the Dashboard view (D4). | MINOR |
| U2 | Settings gear (top-right) | Opens the Settings modal correctly (Add Models / AI Defaults / Search / Integrations / Email / Reminders / Appearance / Shortcuts / Account). | — (OK) |
| U3 | "?" help button | Re-launches the guided tour correctly (steps through tabs with Skip/Next). Note: tour shows ~8 step dots for 10 tabs. | MINOR |
| U4 | Comma key | Per the Shortcuts panel, `Ctrl+,` is bound to "Toggle Window", **not** Settings — so the comma key does not open Settings. | MINOR (note) |
| U5 | Guided tour (auto-play on first CC visit) | Works; Skip Tour and Next function. | — (OK) |

---

## Suggested fix priority

1. **Replace/repair the Orbitron font file** (G1) — fixes the "broken image" squares on Dashboard, COMMAND and OBSERVE in one change.
2. **AGENTS tab action controls** (AG1–AG4) — overlap, mis-placement and clipped overflow menu.
3. **Doubled `// //` prefixes** (A3, GW1, GW2, R1, R2, CM1) and **orphan `//`** headers (W1, GW3) — almost certainly one shared label/`::before` template bug.
4. Dead Dashboard CTAs (D2) and the Contacts 403 (A2).
5. Polish: telemetry flat sparklines (C2), empty-chart inconsistency (F1/O2), ASSISTANT dead space (A1), label-prefix inconsistency (O3), theme-colour drift (C3, G2).
