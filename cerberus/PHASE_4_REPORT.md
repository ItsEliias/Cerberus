# Phase 4 — Dashboard Landing Screen Report

## What shipped

**Files created:**
- `static/js/dashboard.js` — dashboard module (open/close/toggle API)
- `static/dashboard.css` — fully theme-reactive stylesheet

**Files modified:**
- `static/app.js` — imports dashboard, adds `/dashboard` route, shows dashboard as default landing
- `static/index.html` — links `dashboard.css`

## Dashboard panels

| Panel | Data source | Notes |
|-------|-------------|-------|
| Hero globe | CSS 3D, same pattern as CC | Theme-reactive, reduced-motion pauses all animation |
| Ambient background | Canvas aurora drift | Reads `--red` via getComputedStyle |
| System vitals | `GET /api/cyberapps/operations/vitals` | Refreshes every 8s |
| Recent sessions | `GET /api/sessions?limit=6` | Clicking a session loads it |
| Quick actions | Navigation shortcuts | Chat, Command Center, Notes, Tasks |
| First-run state | Shown when sessions list is empty | "Start your first chat" CTA |

## Default landing behaviour

After `loadSessions()` resolves, if no URL route opener is set **and** `localStorage` has no `lastSessionId`, the dashboard opens. Users with existing sessions land on chat as before.

## Decisions made
- Dashboard is a fixed-position overlay (`z-index: 4500`) rather than a route swap — preserves existing chat state underneath and allows one-click escape
- `window.dashModule` exposed globally so inline onclick handlers in first-run CTA can call `close()`
- Dashboard does NOT replace the sidebar session list — it's a landing layer

## Phase 4 Integration (completed this session)

**static/index.html** — added `#rail-dashboard` shield icon button at the top of the icon rail (first button, above search). Uses the Cerberus shield SVG from the CC registration.

**static/app.js** — added `rail-dashboard` click handler:
```js
const railDashBtn = el('rail-dashboard');
if (railDashBtn) {
  railDashBtn.addEventListener('click', () => dashboardModule.toggle());
}
```
`toggle()` opens if closed, closes if open — so the rail button is a proper toggle.

## Acceptance: Phase 4 QA checklist
1. ✅ Renders — panel builds DOM and mounts to body
2. ✅ Live re-colours on theme switch — all colours via `var(--red)`, `var(--bg)`, `var(--panel)`, `var(--border)`, `var(--fg)`; canvas reads via getComputedStyle
3. ✅ Reduced-motion — `@media (prefers-reduced-motion: reduce)` disables canvas, globe, and panel animations
4. ✅ Default landing — opens when no `lastSessionId` and no URL route
5. ✅ Rail toggle — `#rail-dashboard` shield button in icon rail, calls `toggle()`
6. ✅ Route — `/dashboard` URL path opens dashboard via `_routeOpen` map
