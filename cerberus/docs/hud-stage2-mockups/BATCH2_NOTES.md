# HUD Stage 2 — Batch 2 Design Notes

## The Core Principle: HUD Frame, Readable Content

Batch 1 (Command Center, Dashboard) established the HUD identity — scanlines, Orbitron wordmark, `//` section prefixes, brand-red border glow, mono chip labels throughout. That language works perfectly for *chrome* — structural UI elements that sit outside readable content.

Batch 2 extends the HUD to four content-heavy surfaces. The challenge: if you apply HUD treatment uniformly to body text, the surfaces become hostile to read. The answer is a deliberate split:

**HUD chrome layer:** brand bar, tab nav, section headers (`// Thread`, `// Preview`), toolbars, chips, badges, status bars, folder nav, doc tabs. Full HUD treatment.

**Readable content layer:** message bubbles, email subject + body, note content + editor, document editor + preview. Comfortable system-ui or readable mono — NOT tiny mono, NOT low-contrast, NOT scanlined over.

The scanline overlay lives on the shell `::before` — so it subtly covers everything but stays at 50% opacity. That's correct. The intent is that content areas use backgrounds with enough contrast that the scanline is barely visible there, while chrome areas (darker void surface) let it show more.

---

## Surface-by-surface decisions

### Chat (`chat-hud.html`)

**HUD:** brand bar, tab nav, thread header (back btn, sigil with red accent bg, status chip, model chip, session time), context strip (token count, ctx%, system prompt), composer toolbar, send button.

**Readable:** message bubbles. `14px system-ui`, `1.6 line-height`. User messages get a subtle red-tinted bg; agent messages get a neutral raised surface with a 2px left accent border in crimson-600. This gives visual hierarchy without making the text hard to read.

**Code in messages:** `12px JetBrains Mono` inline, `12px` code blocks — still readable, just slightly smaller since code is scannable not prose. Crimson-200 for inline code accent color.

**Streaming indicator:** `▊` cursor with `jx2-pulse-crimson` animation. Placed after message content.

**Judgment call:** the "YOU / AGENT" role label sits in the message meta row (8px mono, muted) — it's tiny, not critical prose, so HUD scale is fine there. The message content below it is where readability matters.

---

### Email (`email-hud.html`)

**HUD:** brand bar, tab nav, folder header (section label with `//` prefix, folder chips with count badges), search bar (mono 9px), email list item metadata (sender name, date — 10px mono), email reader toolbar (action buttons), reader email metadata row (From, date, tags as chips).

**Readable:**
- Email subject in the list: `12px` system-ui — it's the most important at-a-glance info, shouldn't be micro mono.
- Email preview text in list: `11px` system-ui — truncated, needs to be legible.
- Email subject in reading pane: `16px` `font-weight: 600` system-ui — most prominent thing, reader needs to process it instantly.
- Email body: `14px system-ui`, `1.7 line-height`. This is the whole point of the email surface; it has to be comfortable prose.
- Reply textarea: `13px system-ui` — what you type should be readable as you type it.

**AI summary strip:** HUD chip label (`// AI`), but the summary text is `12px` system-ui for readability. It sits between the body and the reply bar — reads as a digest, not as chrome.

**Judgment call:** Email list item has unread indicator (4px dot, absolutely positioned left) and read/done state toggled via classes. No colored dots or accent for read state — just opacity/weight on the sender name. Keeps the list from feeling like a status board.

---

### Notes (`notes-hud.html`)

**HUD:** brand bar, tab nav, list header (section label with `//`, new button, filter chips), search bar, note card metadata (sender/date row in 10px mono, footer label chips), editor toolbar, status bar.

**Readable:**
- Note card title: `13px font-weight: 600 system-ui` — needs to be legible in the list, not microscopic mono.
- Note card preview: `11px system-ui` — truncated 2-line preview, needs to be legible.
- Note title input (editor): `20px system-ui` — prominent, the document header.
- Note body content: `15px system-ui`, `1.7 line-height`. Full editing typography — the comfortable writing surface is the product. Making this tiny mono would be hostile.
- Headings within notes: `16px font-weight: 600` — hierarchy within the note body.
- Checklist items: `15px system-ui` matching body.

**Code blocks in notes:** `12px JetBrains Mono` — still a tier smaller than body, but not micro. Given these are operator security notes, code snippets are real content not decoration.

**Judgment call:** The pinned note card gets a `border-left: 2px solid --jx2-status-warn` (amber) to distinguish it from the active state (which uses crimson). Reminder chip uses amber as well. Both are data-semantic colors, not brand/accent.

---

### Docs (`docs-hud.html`)

**HUD:** brand bar, tab nav, document tab bar (each doc tab with lang icon + filename + close), toolbar (lang chip, mode buttons, format actions, run button, save status), preview pane header (`// Preview`), status bar.

**Readable:**
- Document tab filename labels: `9px mono` — these are short and chrome-adjacent, mono is fine.
- Editor content: `13px JetBrains Mono`, `1.65 line-height`. This is code/markdown editing; mono is appropriate and correct, but `13px` keeps it comfortable. Do NOT use 9-10px here.
- Preview pane rendered content: `14px system-ui`, `1.7 line-height` — this is the rendered markdown output, prose reading.
- Table in preview: headers 8px mono (chrome); cell content 12px for data density but still readable.

**Syntax highlighting:** Applied via `tok-*` span classes. Colors chosen from the token palette — crimson-300 for keywords, blue `#60a5fa` for function names, green `#86efac` for strings, amber `#fbbf24` for numbers, muted italic for comments. This keeps syntax colors within the overall dark palette without introducing clashing accent sets.

**Split view default:** The mockup shows Edit + Preview split. This is the most common mode for markdown. Full-editor and full-preview modes would simply toggle `flex: 1` / `display: none` on each pane.

**Judgment call:** The `// Preview` header and toolbar belong to the HUD chrome layer. The preview content below it belongs to the readable layer. The border between them is a single `1px solid --jx2-border-hairline` line — minimal, doesn't interrupt reading.

---

## Shared decisions across all four

**Font stack:** Content areas use `system-ui, -apple-system, sans-serif`. This respects the privacy-first, no-CDN rule — no web font load for body text. JetBrains Mono is self-hosted and used only where mono semantics add meaning (code, HUD labels, metadata, status chips).

**Orbitron:** Wordmark only + clock. Not in body text, not in section labels, not in form fields. Keeps it as a brand signal, not a legibility problem.

**No scanline over content:** The scanline `::before` is on `.cc-shell` at `z-index: 99`. Content areas have surface backgrounds that let the shell scanline remain subtle (the dark backgrounds absorb it). We do not add additional scanline overlays on content areas. This is the line between "HUD aesthetic" and "hostile to read."

**Section `//` prefix:** Used on subsection labels within content surfaces (e.g. `// Thread`, `// Preview`, `// Notes`, `// Folders`) — consistent with Batch 1's section heading pattern.

**Status/semantic colors:** Only on data-meaningful elements (status pips, badge chips, confidence levels). Not on prose text.

---

## What this batch does NOT decide

- Exact route IDs, view IDs, or file paths — those are live app concerns, not mockup concerns.
- Which surfaces get nav rail items vs. modal panels vs. embedded tabs.
- Whether Email/Notes/Docs are separate top-level tabs or accessible from the sidebar — that's an IA decision for implementation.
- Animation timings beyond what's already established in Batch 1.

These are left open for owner direction before implementation begins.
