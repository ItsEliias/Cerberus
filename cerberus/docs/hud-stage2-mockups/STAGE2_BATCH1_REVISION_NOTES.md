# HUD Stage 2 — Batch 1 Revision Notes
## Dashboard hero split + two Dashboard variants

Branch: `feat/hud-stage2-batch1-mockups`
Status: **Mockups only — no live code touched**

---

## What changed from Batch 1

| File | Change |
|---|---|
| `command-center-hud.html` | **Unchanged** — globe stays as the CC operational centerpiece |
| `dashboard-hud.html` | Superseded by the two variants below; kept for reference |
| `dashboard-hud-variant-a-dense.html` | NEW — Variant A: Dense Cockpit |
| `dashboard-hud-variant-b-bold.html` | NEW — Variant B: Bold |
| `STAGE2_BATCH1_REVISION_NOTES.md` | NEW — this file |

**Why:** Globe appeared on both CC and Dashboard mockups (redundancy + CONTRACT.md duplication).
Decision: globe = Command Center only (operational core); Dashboard gets its own distinct JARVIS-style telemetry hero.

---

## Variant A — Dense Cockpit

**Concept:** maximal JARVIS-cockpit density. Every region shows live data. Suited to an operator who keeps the Dashboard open as a persistent ops panel.

**Layout:**
1. Brand bar — `[CERBERUS] DASHBOARD` wordmark + chips + live clock
2. Stat tiles row — 6 compact tiles: SESSIONS / TOKENS USED / AGENTS ONLINE / TASKS QUEUED / UPTIME / AVG LATENCY
3. Sparkline row — TOKEN FLOW (24H) · AGENT ACTIVITY (24H), side by side
4. Bottom row — SYSTEM VITALS (left) · RECENT ACTIVITY feed (right)

**Animations in mockup (live in the HTML):**
- Stat tile counters count up from 0 on load via rAF
- Canvas sparklines draw left→right over ~1.4s
- Vitals bars animate from 0 to target width via CSS transition

---

## Variant B — Bold

**Concept:** fewer elements, more impact. One or two dominant readouts that read at a glance from across the room. Suited to a reference view or a secondary monitor.

**Layout:**
1. Brand bar — `[CERBERUS] DASHBOARD` wordmark + chips
2. Hero counters — TWO large Orbitron numbers: TOTAL SESSIONS + TOTAL TOKENS PROCESSED, tick up on load
3. Token flow graph band — full-width canvas, 130px height, crimson line with glow halo, grid lines
4. Bottom two-col — RECENT ACTIVITY feed (left) · SYSTEM VITALS compact (right)

**Animations in mockup (live in the HTML):**
- Hero counters tick from 0 using a 4th-power ease-out for dramatic deceleration, over ~2.2s / ~2.6s
- Graph band draws in from left→right over ~1.8s
- Vitals bars animate via CSS transition

---

## Data sources (readout → API/endpoint)

| Readout | Source |
|---|---|
| Sessions count | `GET /api/sessions` → array length / today filter |
| Tokens used | `GET /api/stats/tokens` → `{ today, total, hourlyRate }` |
| Agents online | `GET /api/agents` → `data.agents` array, filter `status === 'online'` |
| Tasks queued | `GET /api/tasks` → filter `status === 'queued'` |
| Uptime | `GET /api/diagnostics/services` → derived from service start timestamps |
| Avg latency | `GET /api/stats/latency` → `{ p95 }` |
| CPU / MEM / DISK | `GET /api/diagnostics/vitals` → `{ cpu, mem, disk }` |
| LAT (vitals bar) | Same `p95` latency, normalized to a 200ms ceiling |
| Token flow 24H sparkline | `GET /api/stats/tokens/hourly?hours=24` → array of `{ hour, tokens }` |
| Agent activity 24H sparkline | `GET /api/agents/activity?hours=24` → array of `{ hour, count }` |
| Recent activity feed | `GET /api/events?limit=8&type=session,agent,alert,model` |

All readouts degrade gracefully: if a source is unreachable, the tile/panel shows `—` or the last known value, never fake/placeholder data.

---

## Performance guardrails

**Animation budget:**
- All animations use `transform`/`opacity` or canvas drawing only — no layout-triggering properties
- `requestAnimationFrame` (rAF) for all JS-driven animation loops
- Tab-hidden pause: `document.addEventListener('visibilitychange', ...)` suspends rAF loops when tab is hidden
- Canvas update cap: sparklines and graph redraw only during the draw-in phase; idle state requires no rAF

**Update polling (implementation phase):**
- Stat tiles: 10s polling interval with smooth counter transition (delta only, not full count-up)
- Vitals bars: 5s polling, CSS transition on width change
- Sparkline/graph: update hourly (data is hourly) — no continuous rAF in production
- Activity feed: SSE or 5s polling for new events

**Reduce HUD effects toggle (`body.reduce-hud`):**
- Suppresses scanline overlay (same as sidebar Stage 1 behavior)
- Suppresses chip row
- Stops sparkline/graph continuous animations (static last-frame only)
- Wordmark stays intact

**`prefers-reduced-motion`:**
- Both mockups check `matchMedia('(prefers-reduced-motion:reduce)')` at load
- If true: counters show final values immediately, sparklines/graphs render at full progress without rAF transition, bars set to target width instantly

---

## Pending for Step 2 (implementation)

1. Globe stays on Command Center only — `dashboard.html` gets the telemetry hero.
2. Choose one Dashboard variant; implement hero using the approved layout.
3. Wire readouts to real API endpoints (see data sources table above).
4. Scope all CSS to `#cerberus-dashboard` selector in `hud.css` Stage 2 block.
5. Replace static mock data in activity feed with SSE or `EventSource` from `/api/events`.
6. Apply `body.reduce-hud` and `prefers-reduced-motion` killswitches.
7. CONTRACT.md: register hero widget under dashboard surface only (resolve globe duplication).

**STOP — wait for variant selection before implementation.**
