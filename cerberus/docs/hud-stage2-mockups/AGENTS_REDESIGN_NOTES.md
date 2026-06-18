# AGENTS Tab Redesign — Mockup Notes

Two layout variants for CC › AGENTS. Neither touches the live tab yet.
Preview by opening the HTML files directly in a browser (self-hosted fonts load via relative path).

---

## Problems being solved

The current AGENTS tab has:
- Six equal-weight action buttons per agent (Chat, Call, Invoke, Mem, Edit, Del) all rendered at the same visual weight with semantic rainbow coloring — noisy and hard to scan.
- Card grid that is too uniform: every agent looks identical regardless of status or category.
- No visual hierarchy between primary use (chat with this agent) and maintenance operations (edit, delete).

---

## Variant A — Dense Roster Table (`agents-redesign-variant-a.html`)

**What it prioritizes:** information density and quick scanning across many agents.

### Layout
Compact table rows (not cards). One row per agent. Columns:
`[pip] [sigil] [Agent name + role] [Model] [Score] [Actions]`

Category groups (CORE / SECURITY / OPS / DATA / COMMS) are collapsible sections with sticky `// CATNAME · N` header rows.

### Action hierarchy
- **[Chat]** — always visible, brand-red tint (primary action)
- **[Run]** — always visible, neutral outline (secondary action)
- **[···]** — overflow button reveals dropdown: Call / Memory / Edit / Delete (maintenance ops hidden by default)

This collapses 6 buttons → 3, with 4 maintenance actions behind one click.

### Inline expand
Clicking a row reveals a detail panel directly beneath it (no modal): status badge, system-prompt snippet, quick invoke form with role-specific quick-action buttons. The ARCHITECT row is pre-expanded as the example.

### Trade-offs
| Advantage | Disadvantage |
|-----------|-------------|
| Shows all 16 agents without scrolling | More cognitive overhead per row — columns require eye-tracking |
| Filtering by status/category is fast | Expanded detail panel pushes rows down (layout shift) |
| Scales well as agent count grows | Less discoverable than cards for new users |
| Feels like a mission-control panel | Less visual breathing room |

**Best fit:** Power users who know their agents and want to act fast.

---

## Variant B — Hierarchical Card Grid (`agents-redesign-variant-b.html`)

**What it prioritizes:** visual clarity per agent and clear action hierarchy.

### Layout
2-column card grid. Cards grouped under `// CATEGORY  N` section headers.

### Card anatomy (top to bottom)
1. **Left rail** — 2px, `var(--cat-accent)` at 50% opacity (category identity without shouting)
2. **Head** — sigil emoji (28px, category-palette bg) + Orbitron name + semantic status badge
3. **Meta row** — role label + model chip
4. **Stat row** — score + token counts + `▼ Info` toggle
5. **Detail panel** (collapsed by default) — system-prompt snippet + inline invoke form
6. **Divider** (`<hr>`)
7. **Primary action** — `// CHAT ›` full-width row (brand-red tint, most discoverable)
8. **Secondary strip** — 5 uniform icon+label buttons: CALL / INVOKE / MEM / EDIT / DEL

Secondary buttons are intentionally all the same neutral style — no rainbow, no weight differentiation. The hierarchy comes from positioning (primary above, secondary strip below) and the full-width clickable area of the primary vs. smaller strip buttons.

### Trade-offs
| Advantage | Disadvantage |
|-----------|-------------|
| Clear visual hierarchy within each card | Fewer agents visible without scrolling |
| Category identity via left rail feels structured without being loud | At 16+ agents the grid gets long |
| Status badges are large enough to read at a glance | 2-column layout can feel uneven with odd agent counts |
| Matches the COUNCIL card aesthetic — feels intentional | Expand/collapse detail adds complexity vs. always-visible rows |

**Best fit:** Users who navigate by recognizing agents visually and want the primary action (chat) to be immediately obvious.

---

## Shared decisions (both variants)

- **No rainbow buttons.** Action color only carries meaning: brand-red = primary initiating action. All maintenance ops (edit, delete, memory) are neutral.
- **Category accent** is subtle — 50% opacity rail or 30% sigil background tint. It communicates grouping without competing with status colors.
- **Status colors are semantic**: green = active (working), amber = standby (paused), blue = ready (queued), dim = idle. Same scale as COUNCIL vitals.
- **Filter pills** (ALL / ACTIVE / IDLE / STANDBY / READY) are identical in both variants.
- **`+ New Agent`** button position: top-right of the AGENTS header, same as COUNCIL's `+ Add`.
- **`// AGENTS`** tab prefix and section titles follow the same HUD conventions as the rest of CC.
- **No live code was changed.** Routes, view IDs, file names, and function names are untouched.

---

## Recommendation

**Start with Variant B (Card Grid)** if the goal is visual parity with COUNCIL (which also uses cards). It is the more conservative path — lower risk of feeling like a data-table intruding into a command-console aesthetic.

**Choose Variant A (Roster Table)** if agent count is expected to grow past ~20 and density matters more than aesthetics. The overflow-menu action model also scales better to future actions without adding more buttons.

Hybrid option: implement Variant B now, add a density-toggle (`[≡]` icon) to switch to a compact-row view later — both views already have their CSS patterns defined in these mockups.
