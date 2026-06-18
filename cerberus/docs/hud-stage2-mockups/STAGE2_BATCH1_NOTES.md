# HUD Stage 2 — Batch 1 Notes
## Command Center + Dashboard

Branch: `feat/hud-stage2-batch1-mockups`
Status: **Mockups only — no live code touched**

---

## How to view

Open either HTML file directly in a browser (no server needed). The `@font-face`
declarations reference `../../static/fonts/` — relative to this directory that
resolves to `cerberus/static/fonts/`, where the self-hosted woff2 files already
live from Stage 1.

---

## Shared HUD treatment (both surfaces)

Both mockups apply the same token language approved in Stage 1, sourced verbatim
from the live `static/jarvis-v2/hud.css`:

| Token | Value |
|---|---|
| Wordmark size | 17px (desktop-readability bump from original 16px) |
| Wordmark tracking | 0.15em |
| Surface (header/brand bar) | `#09090a` (void) |
| Surface (content) | `#0d0d0f` (base) |
| Active glow | `inset 0 0 16px rgba(192,57,43,0.10), 0 0 0 1px rgba(192,57,43,0.12)` |
| Section prefix | `// ` in `#c0392b` with 12px crimson glow |
| Scanlines | 4px gap, 0.07 opacity color, 0.5 layer opacity |
| Chip row | Same component as sidebar (ONLINE / N AGENTS / AUTH) |

---

## Command Center — judgment calls

**What changed:**

- **Brand bar** gets the `[CERBERUS] COMMAND` wordmark in 17px Orbitron (same
  bracket treatment as sidebar). The existing plain `CERBERUS COMMAND` title in
  11px Orbitron becomes a two-part identity: wordmark + `// COMMAND` sub-label.
- **HUD chip row** added to the brand bar (reuses the same components as the
  sidebar chips).
- **Tab nav** buttons converted to JetBrains Mono. Active tab gets the `//`
  prefix + crimson border-left glow matching the sidebar active-item pattern.
- **Section/card titles** (`cc-card-title`, `cc-section-header`) get the `//`
  prefix treatment in JetBrains Mono, replacing the existing Orbitron uppercase
  labels. The underlying Orbitron label text is retained but the decorative
  prefix is now CSS-generated (`::before`).
- **Shell surface**: brand bar and tab nav use `#09090a` (void); content area
  uses `#0d0d0f` (base). Matches sidebar header/body depth separation.
- **Scanline overlay** applied at the shell level (same parameters as sidebar).

**What did NOT change:**

- Existing panel internals: dials, sparklines, globe sphere, swarm numbers,
  agent/task rows, model status. These are already HUD-appropriate. Chrome is
  applied at the container layer only.
- Colour semantics: CPU (yellow), RAM (blue), DISK (green), LAT (purple),
  status-active (green), status-processing (blue). Crimson is reserved for
  brand/active state, not overloaded onto data.
- Existing globe animation and particle system — kept as-is.

---

## Dashboard — judgment calls

**What changed:**

- **Header** replaces the existing `CERBERUS` text + SVG shield logo with the
  full `[CERBERUS]` wordmark in 17px Orbitron, matching the sidebar. The HUD
  chip row is added beside the wordmark. The top crimson gradient edge (from
  `--jx2-hud-userbar-edge`) is applied to mirror the sidebar user-bar separator.
- **Card section titles** (`dash-card-title`) get the `//` prefix, replacing
  the bare uppercase Orbitron labels. The `.dash-mock-badge` on PREVIEW/7D
  labels is retained.
- **Quick Access buttons** — primary button (NEW CHAT) uses
  `--jx2-hud-active-bg/border/glow` for prominence. Secondary buttons get the
  left-bar hover pattern consistent with sidebar nav items.
- **Shell border** uses `--jx2-border-glow` (vs the existing opaque border).
- **Scanline overlay** applied at shell level.
- **Vitals bars**: kept at 3px height with semantic fill colors (yellow/blue/
  green/purple) — changing them to crimson would destroy the multi-metric
  readability. Only bar background/track uses void-level opacity.

**What did NOT change:**

- Globe sphere rendering and animation.
- Counter values and layout.
- Session/agent list structure.
- Chart canvas areas (token usage bar chart, activity line chart) — same data
  shape, styled with the HUD border/background tokens at the container level.
- The PREVIEW and 7D mock-badges.

---

## Pending for Step 2 (implementation)

Once approved, implementation will:

1. Extend `hud.css` with new surface-specific custom properties (e.g.
   `--jx2-hud-cc-*`, `--jx2-hud-dash-*`) rather than hardcoding values
   in per-surface stylesheets.
2. Scope all overrides to `.cc-shell` and `#cerberus-dashboard` selectors so
   hud.css tokens remain the single source of truth.
3. Wire the `body.reduce-hud` toggle to suppress scanlines and chip rows on
   these surfaces too.
4. Honour `prefers-reduced-motion` for all HUD animations.
5. Touch only presentation (CSS + minimal HTML label changes) — no route,
   ID, or function changes.
