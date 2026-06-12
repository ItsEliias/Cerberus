# Council Phase E1 Report

## Greek Persona Table

| Name | Role | Glyph Description | System Prompt (one-liner) |
|---|---|---|---|
| **Daedalus** | architect | Two angled wing chevrons pointing outward | Master architect — reason about system structure, module boundaries, data flow |
| **Hephaestus** | backend-dev | Hammer — vertical shaft + wide flat head | God of craft — implement clean code, prefer simplicity, ship working solutions |
| **Themis** | tester | Balance scales — center pivot, horizontal beam, two hanging triangles | Embodiment of order — identify edge cases, validate assumptions, enforce correctness |
| **Athena** | researcher | Stylized owl — round head circle + two large eyes + V beak | Wisdom incarnate — investigate prior art, gather context, synthesize findings |
| **Argus** | reviewer | Cluster of 5 eyes (center + 4 around) with pupils | Argus Panoptes — review code for bugs, style, security gaps |
| **Aegis** | security-auditor | Rounded-pentagon shield outline + crosshair guides | Shield of Zeus — audit for vulnerabilities, threat models, defensive measures |

Default fallback glyph: shield outline with center dot (for custom agents).

## Files Touched

### Modified
- `routes/cerberus_agent_routes.py` — Greek persona seed defaults; `_GREEK_RENAME_MAP`; `POST /api/agents/seed-greek` endpoint
- `static/js/cyberapps/command-center/council.js` — Rich E1 card UI; 4-button actions; MESSAGE/CALL toast; deterministic sparklines; `openNewAgentModal` refactored to import
- `static/js/cyberapps/command-center/styles.css` — Theme-reactive `--cc-accent`/`--cc-accent-rgb`/`--cc-accent-glow` tokens; all crimson references migrated; `@import ./styles-e1.css`
- `static/jarvis-v2/tokens.css` — `--jx2-crimson-500` now `var(--red, #c0392b)`; border tiers + glow tokens use `var(--red-rgb, 192, 57, 43)`
- `static/sw.js` — Cache bumped to `cerberus-v354-council-e1`

### Created
- `static/js/cyberapps/command-center/council-glyphs.js` — SVG portrait glyphs for all 6 Greek personas + default
- `static/js/cyberapps/command-center/council-new-agent.js` — Extracted new-agent modal (keeps council.js under 500 lines)
- `static/js/cyberapps/command-center/styles-e1.css` — Phase E1 card layout CSS (grid, portrait, metrics row, toast, hover glow)
- `tests/test_cerberus_agent_seed_greek.py` — 6 tests for seed data + seed-greek rename logic
- `tests/test_council_glyphs_js.py` — 8 tests for glyph file structure + exports

## Theme Audit Summary

### styles.css — What was crimson, what is var(--cc-accent) now

| Was | Now |
|---|---|
| `#c0392b` (globe particle) | `var(--cc-accent)` |
| `var(--cc-crimson)` (33 occurrences) | `var(--cc-accent)` |
| `var(--cc-crimson-glow)` (all uses outside :root) | `var(--cc-accent-glow)` |
| `rgba(192,57,43,X)` (28 occurrences) | `rgba(var(--cc-accent-rgb),X)` |
| `rgba(192,57,43,0.2)` in brand title text-shadow | `var(--cc-accent-glow)` |

New root variables added:
- `--cc-accent: var(--red, var(--cc-crimson, #c0392b))` — theme-reactive, triple fallback
- `--cc-accent-rgb: var(--red-rgb, 192, 57, 43)` — for alpha/rgba contexts
- `--cc-accent-glow: rgba(192,57,43,0.4)` — static fallback (theme overrides via --red-rgb)

### tokens.css (jarvis-v2)

| Was | Now |
|---|---|
| `--jx2-crimson-500: #c0392b` | `var(--red, #c0392b)` |
| `rgba(192, 57, 43, X)` in border tiers (4) | `rgba(var(--red-rgb, 192, 57, 43), X)` |
| `rgba(192, 57, 43, X)` in glow tokens (5) | `rgba(var(--red-rgb, 192, 57, 43), X)` |
| `rgba(192, 57, 43, X)` in jx2-glow-breathe keyframe | `rgba(var(--red-rgb, 192, 57, 43), X)` |

## Smoke Test Results

All tests passed:
- `tests/test_cerberus_agent_seed_greek.py` — 6/6 passed
- `tests/test_council_glyphs_js.py` — 8/8 passed
- `tests/test_security_regressions.py` + `tests/test_app_static_mime.py` + `tests/test_service_health.py` — 139/139 passed
- Python syntax check: `python3 -m py_compile routes/cerberus_agent_routes.py` — OK

## Phase E1 Acceptance Checklist

1. Council shows 6 Greek-themed cards with persona glyphs visible
2. Each card has portrait + name + role chip + status dot + currently: line + score + sparkline + 4 action buttons
3. MESSAGE and CALL buttons display "Coming soon — Phase E2/E3" toast on click
4. INVOKE and DETAILS work as before (pane toggle + stream / overlay)
5. Theme change sets `--red` → all Council accents follow via `--cc-accent`; no hardcoded red bleeds
6. `POST /api/agents/seed-greek` renames old default-named agents to Greek personas idempotently

## Branch + Commit Info

- Branch: `design/jarvis-cerberus-skilled`
- Author: ItsEliias <itseliiasstudy@gmail.com>
- SW cache: `cerberus-v354-council-e1`
- Push: `git push origin design/jarvis-cerberus-skilled`
