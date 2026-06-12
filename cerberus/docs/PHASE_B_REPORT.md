# JARVIS v2 — Phase B Report

Branch: `design/jarvis-cerberus-skilled`
Author: ItsEliias <itseliiasstudy@gmail.com>
Date: 2026-06-12

## Commits

| Hash | Message |
|------|---------|
| `d73227b` | feat(design/jarvis-v2): extend surfaces — email, brain, calendar, compare, cookbook, deep-research, gallery, notes, tasks, theme, search + empty/loading/404 hero states |
| `2daeae9` | chore(design/jarvis-v2): SW cache bump v344 -> v345 for phase B |

## Surfaces Covered

| Surface | Selectors Targeted | Treatment Applied |
|---------|-------------------|------------------|
| **Email** | `.email-item`, `#email-section`, `#email-folder-select`, `.email-loading` | Glass chrome on modal (Phase A). List rows: hairline bottom border + crimson left-edge on hover. Unread items get permanent crimson left-edge. Empty/loading: mono HUD label. |
| **Brain / Memory** | `.memory-item`, `.memory-cat-chip`, `.memory-empty`, `.memory-item-editing` | List rows: 2px left-edge accent on hover/edit. Category chips: pill style with hairline + crimson active ring. Empty: HUD mono label. |
| **Calendar** | `.cal-toolbar`, `.cal-nav`, `.cal-today-btn`, `.cal-add-btn`, `.cal-view-btn`, `.cal-grid`, `.cal-day-cell`, `.cal-empty-state`, `.cal-btn-primary` | Toolbar: raised surface + hairline bottom. Nav/action buttons: bordered mono chrome. Grid cells: hairline only (no scanlines — dense data). Today cell: crimson border. Empty state: HUD frame + display font title + crimson primary CTA. |
| **Compare** | `.compare-active`, `.compare-header-bar`, `.compare-pane`, `.pane-header`, `.pane-title`, `.pane-action-btn` | Header bar: raised chrome. Each pane: glass panel (frosted, blur 8px) + hairline crimson top border. Pane headers: raised surface + hairline. Action buttons: ghost with hover glow. |
| **Cookbook** | `.cookbook-tab`, `.hwfit-row`, `.cookbook-dep-tag`, `.cookbook-dep-installed`, `.cookbook-dep-install` | Tabs: mono font, crimson underline active. Model rows: 2px left-edge + hairline bottom. Dep tags: pill style; installed = green tint, install = bordered. |
| **Deep Research** | `#research-overlay .modal-content`, `.research-job-card`, `.research-job-header`, `.research-jobs-list:empty::after`, `.research-job-action-btn` | Research panel: glass chrome with glow top border. Job cards: 2px left-edge + hairline bottom. Empty state: CSS-generated mono HUD label. Action buttons: ghost with hover glow. |
| **Gallery** | `.gallery-toolbar`, `.gallery-chip`, `.gallery-search`, `.gallery-tile`, `.gallery-empty` | Toolbar: raised chrome. Chips: pill hairline + crimson active. Search: void background + focus glow. Image tiles: hairline + crimson glow on hover only (no scanlines — dense data). Empty: HUD frame. |
| **Library (modal)** | Already covered by Phase A `.modal-content` rule. Phase B verifies `.memory-item` hover on library session rows works too. | Inherits Phase A glass chrome. |
| **Notes** | `#notes-pane`, `.notes-pane-header`, `.notes-pane-title`, `.note-card`, `.notes-header-text-btn` | Pane: base surface + hairline left border. Header: raised + display title. Note cards: raised surface + 2px transparent left-edge that glows crimson on hover. Reminder states: idle (amber) / fired (green) left edges. |
| **Tasks** | `.task-card`, `.task-active-badge`, `.task-paused-badge` | Cards: 2px left-edge + hairline bottom. Active badge: green status tint + ring. Paused badge: amber status tint + ring. |
| **Theme** | `#theme-popup`, `#theme-tabs button`, `.theme-swatch` | Popup: glass chrome + ambient glow. Tabs: mono font, crimson underline active. Swatches: hairline + crimson glow ring on active. |
| **Search** | `#search-overlay`, `#search-overlay .search-panel`, `#search-input`, `.search-result-item`, `.search-group-header`, `.search-highlight`, `.search-empty` | Overlay: 72% void scrim. Panel: glass chrome + glow top border. Input: full input-glow treatment (caret crimson, focus ring). Result rows: 2px left-edge + hover glow. Highlights: crimson tint. Empty: HUD mono label. |
| **New Chat (hero)** | `.new-chat-hero`, `.welcome-view`, `.chat-welcome` | Full hero: ambient glow radial behind content (jx2-glow-breathe animation), subtle scanlines overlay. Content sits at z-index 1. Bracket corners wired by JX2.init() MutationObserver. |

## New Components Added

| Class | File | Description |
|-------|------|-------------|
| `.jx2-empty-hud` | `surfaces-phase-b2.css` | Small HUD frame for empty list states. Background: surface-raised, border-top: border-default, subtle scanlines via ::after. Children should use `.jx2-empty-hud__label`. |
| `.jx2-empty-hud__label` | `surfaces-phase-b2.css` | Mono uppercase label inside an empty-hud. |
| `.jx2-error-hud` | `surfaces-phase-b2.css` | Error/404 HUD frame. Top border: 2px status-alert, crimson glow ring. Children: `.jx2-error-hud__code` (display font, alert color) and `.jx2-error-hud__message` (mono, muted). |
| `.jx2-spinner` | `surfaces-phase-b2.css` | Inline loading dial: 18px circle, border-top crimson, spins via jx2-spin keyframe. Stops (no animation) under prefers-reduced-motion. |
| `.jx2-section-header` | `surfaces-phase-b2.css` | Uppercase mono section divider. Hairline bottom border. Used to label surface sections. |

## Init Hooks (JX2 calls)

All bracket corner wiring is handled globally by `JX2.init()` (called once in `index.html`) via MutationObserver on `.jx2-hud-frame` elements. No per-surface `bracketCorners()` calls are needed because the hero/empty states are triggered by CSS classes (`.new-chat-hero`, `.chat-welcome`, `.jx2-empty-hud`) — these use `::before`/`::after` pseudo-elements for the ambient glow and scanlines directly in CSS, requiring no JS.

The `JX2.staggerReveal()` call is available for welcome view content if a surface JS module chooses to call it when mounting the new-chat hero. The CSS is wired and ready.

| JX2 call | Where | Status |
|----------|-------|--------|
| `JX2.init()` | `index.html` inline script | Active — wires body.jx2-active + MutationObserver |
| `JX2.staggerReveal(els)` | Caller's choice on `.welcome-view > *` | Optional; CSS handles fallback visibility |
| `JX2.bracketCorners(el)` | On any `.jx2-hud-frame` element | Auto-wired by MutationObserver in init() |

## File Structure

```
static/jarvis-v2/
  tokens.css               — design tokens (Phase A, unchanged)
  components.css           — reusable .jx2-* classes (Phase A)
  surfaces.css             — shell chrome, chat view, workspace (Phase A)
  surfaces-phase-b.css     — Email, Brain, Calendar, Compare, Cookbook (379 lines)
  surfaces-phase-b2.css    — Research, Gallery, Notes, Tasks, Theme, Search,
                             New-Chat hero, global empty/error primitives (494 lines)
  effects.js               — window.JX2 API (Phase A, unchanged)
```

## SW Cache

`cerberus-v344-jarvis-v2` → `cerberus-v345-jarvis-v2-phase-b`

## Smoke Test Plan

1. `docker compose up -d --build --force-recreate cerberus` from `/Users/codyliddell/Documents/Claude/Projects/Cerberus/cerberus/`
2. Hard-refresh `http://127.0.0.1:7000` in Safari (Cmd+Shift+R) to pick up new SW
3. Click each left-rail entry and verify:

| Surface | Expected |
|---------|---------|
| Email | Email list rows have hairline separator; unread items get crimson left-edge; empty state is a mono HUD label |
| Brain | Memory items hover with crimson left-edge; category chips have pill style; empty shows HUD mono label |
| Calendar | Toolbar has raised chrome; nav buttons have bordered mono style; grid cells are clean (no scanlines); today cell has crimson border; empty state has HUD frame with display title |
| Compare | Header bar has raised chrome; each pane has glass panel + glow top border; pane action buttons ghost style |
| Cookbook | Tabs have crimson underline on active; model rows have hairline; dep tags are pill-styled |
| Deep Research | Research panel has glass chrome; job cards have hairline; empty list shows HUD label |
| Gallery | Toolbar raised; chips pill-styled; tiles hover with crimson glow but no scanlines; empty is HUD frame |
| Library | Modal chrome from Phase A; session list rows hover with left-edge glow |
| Notes | Pane has raised header with display title; note cards have raised surface + crimson hover edge; reminder states show amber/green edges |
| Tasks | Task cards have hairline; active badge is green tint; paused badge is amber tint |
| Theme | Popup has glass chrome + ambient glow; swatches have hairline + crimson active ring |
| Search | Overlay scrim at 72% void; input has full focus-glow; results have 2px left-edge hover |
| New Chat | Hero view has ambient glow + subtle scanlines behind centered content |

4. Verify no surface is stuck in plain dark theme
5. Verify popups/modals still close cleanly (no right-shift drag bug)
6. Verify drag on modals is still smooth (no transform-transition interference)

## Open Questions for Phase C

1. **Library sessions UI** — The `.doclib-card` and `.doclib-card-expanded` selectors inside `#email-lib-modal` were not explicitly targeted in Phase B. A Phase C pass could add hairline + hover glow to library document cards.
2. **RAG upload zone** (`#rag-upload-zone`) — Only a file upload zone, no rich panel. Phase C could apply `jx2-hud-frame` treatment when the zone is drag-hovered.
3. **Cookbook running/serving panel** — `.cookbookRunning` state has inline status. Phase C could add `.jx2-stat-chip` styling to the progress badges.
4. **Admin panel** — Not yet visited. Phase C should audit `static/js/admin.js` selectors.
5. **Settings panel** — Not yet visited. Phase C should audit settings overlay selectors.
