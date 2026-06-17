# Sidebar Identity Proposals — Task 4 Step 1

Three directions for the Cerberus sidebar visual identity. Open the HTML files in a browser — they are fully self-contained and render without a server.

```
docs/sidebar-mockups/
  direction-1-conservative.html
  direction-2-moderate.html
  direction-3-bold.html
```

---

## Shared constraints (all three directions)

- **Route paths, view IDs, file names, and functions are unchanged** — only display labels and CSS are in scope.
- All three use the jarvis-v2 design token set (crimson spine, surface tiers, JetBrains Mono / Orbitron / IBM Plex Sans) inlined as `<style>`.
- All three keep the exact item order from the live sidebar.

---

## Direction 1 — Conservative ("Signal")

**File:** `direction-1-conservative.html`

**What changes:**
- jarvis-v2 tokens applied cleanly: `surface-raised` background, hairline crimson border on the right edge, `crimson-300` brand title in JetBrains Mono
- Section titles in JetBrains Mono, 10px, `fg-muted` — clear hierarchy, no jarring color
- List items use IBM Plex Sans at 13.5px with subtle hover tint
- Avatar initials in the user bar instead of empty circle
- Keyboard shortcut `⌃K` chip on Search

**What stays the same:** Every label, every section grouping, pixel-level layout.

**Best for:** Fastest path to ship. Purely additive CSS changes — no layout risk. Does not add strong product identity beyond "clean dark UI with crimson accents."

---

## Direction 2 — Moderate ("Operator")

**File:** `direction-2-moderate.html`

**What changes:**
- **Header** elevated with `surface-modal` (darker than body) + "Secure Workspace" subtitle line in small mono text
- **Live status dot** (green, pulsing) in the header signals system health at a glance
- **Section titles** are crimson-colored with `0.15em` tracking and a trailing hairline rule — strong hierarchy without heavy borders
- **Left-bar accent** on hover/active: 2px crimson left border replaces plain background tint
- **Avatar** uses square radius (operator ID card aesthetic) with square border, initials "IE"
- **Status line** "● ONLINE" under username in user bar in `status-active` green
- **KBD chip** styled with subtle border on Search

**What stays the same:** All item labels, section structure, routing.

**Best for:** Balanced pick. Adds recognizable Cerberus personality in ≤10 lines of new HTML. The "Secure Workspace" subtitle and status dot tell the product story in the header. Slightly more opinionated than Direction 1 but avoids the full HUD treatment.

---

## Direction 3 — Bold ("NEXUS HUD")

**File:** `direction-3-bold.html`

**What changes:**
- **Orbitron wordmark** `[CERBERUS]` with bracket notation, crimson-glowing first letter `C`, in the header
- **HUD status chips** under the wordmark: `ONLINE · 2 AGENTS · AUTH` — live system telemetry row (small mono chips, colored dots)
- **Scanline texture** CSS overlay on the sidebar body (semi-transparent repeating linear gradient) — subtle, 50% opacity
- **Header + user bar** share `surface-void` (deeper black than the scroll body) — three-layer depth: void → raised → modal
- **Section titles** use `// prefix` notation (e.g. `// Chats`, `// Tools`) with crimson glow text-shadow
- **Active items** get left-bar + inset glow + 1px outer ring — unambiguous selection state
- **User bar top edge**: gradient crimson line via `::before` pseudo-element — no separate border tag
- **All sidebar text** in JetBrains Mono — full HUD vocabulary, zero sans-serif

**What stays the same:** All item labels, section structure, routing.

**Best for:** Strongest Cerberus product identity. Immediately reads as a security-focused tool. Highest visual impact, moderately higher implementation effort (still CSS-only changes). The HUD chip row can optionally be made collapsible to reduce visual noise during long chat sessions.

---

## Recommendation

If minimizing risk is the priority: **Direction 1**.
If wanting a recognizable identity without aggressive HUD chrome: **Direction 2** (recommended starting point).
If the goal is maximum differentiation and the "security workspace" visual narrative: **Direction 3**.

Directions 2 and 3 can be composed — ship 2 first, add the HUD header elements from 3 as a follow-up.
