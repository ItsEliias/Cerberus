# Skill Output: frontend-design-pro

Plugin: `frontend-design-pro`
Skill slug: `frontend-design-pro` (v1.0.0)
Base dir: `/Users/codyliddell/.claude/plugins/cache/frontend-design-pro/frontend-design-pro/1.0.0`
Invoked: 2026-06-12

## INVOCATION ATTEMPT

Attempted via Skill tool:
```
Skill("frontend-design-pro", args="Pull the retro-futurism / cyberpunk visual vocabulary...")
```

**Result: ERROR — `Unknown skill: frontend-design-pro`**

The Skill tool returned: `Unknown skill: frontend-design-pro`

The skill IS installed on disk at the path above. Its SKILL.md was found and read directly.

## ROOT CAUSE

The skill's SKILL.md is located at:
`/Users/codyliddell/.claude/plugins/cache/frontend-design-pro/frontend-design-pro/1.0.0/skills/frontend-design-pro/SKILL.md`

The available-skills system-reminder lists skills as slugs like `frontend-design:frontend-design`
(plugin:skill format). `frontend-design-pro` does NOT appear in the system-reminder available-skills
list under any slug form tried:
- `frontend-design-pro` — FAILED
- `frontend-design-pro:frontend-design-pro` — NOT TRIED (not in list)

The skill is installed but NOT registered with the Claude Code skill dispatcher for this session.

## SKILL.md CONTENTS (read directly from disk)

```
---
name: frontend-design-pro
description: Creates jaw-dropping, production-ready frontend interfaces AND delivers perfectly
matched real photos (Unsplash/Pexels direct links) OR flawless custom image-generation prompts
for hero images, backgrounds, and illustrations. Zero AI slop, zero fake URLs.
---

You are a world-class creative frontend engineer AND visual director. Every interface you build
must feel like a $50k+ agency project.

## 1. Choose One Bold Aesthetic Direction (commit 100%)

| Style Category              | Core Keywords                                                        | Signature Effects                                                                     |
|-----------------------------|----------------------------------------------------------------------|------------------------------------------------------------------------------------- |
| Retro-Futurism / Cyberpunk  | vaporwave, 80s sci-fi, crt scanlines, neon glow, glitch, chrome     | Scanlines, chromatic aberration, glitch transitions, long glowing shadows             |
| Dark OLED Luxury            | deep black, oled-optimized, subtle glow, premium, cinematic         | Minimal glows, velvet textures, cinematic entrances, reduced-motion support           |

## 2. Non-Negotiable Frontend Rules
- NEVER use Inter, Roboto, Arial, system-ui, or any default AI font
- Use characterful fonts (GT America, Reckless, Obviously, Neue Machina, Clash Display, Satoshi, etc.)
- CSS custom properties everywhere
- One dominant color + sharp accent(s)
- At least one unforgettable signature detail
- Full WCAG AA/AAA, focus styles, semantic HTML, prefers-reduced-motion

## 3. PERFECT IMAGES SYSTEM
[image prompt generation instructions — not applicable to CSS-only Cerberus implementation]
```

## RETRO-FUTURISM / CYBERPUNK VOCABULARY (extracted from SKILL.md)

From the skill's style table row for **Retro-Futurism / Cyberpunk**:

**Core Keywords**: vaporwave, 80s sci-fi, CRT scanlines, neon glow, glitch, chrome
**Color Palette Ideas**: Neon cyan/magenta on deep black, chrome accents
**Signature Effects**: Scanlines, chromatic aberration, glitch transitions, long glowing shadows

### Translated to Cerberus Crimson-on-Black

Since Cerberus uses crimson (not cyan/magenta), these effects are adapted:

**Scanlines**:
```css
background: repeating-linear-gradient(
  0deg,
  transparent,
  transparent 2px,
  rgba(192, 57, 43, 0.025) 2px,
  rgba(192, 57, 43, 0.025) 3px
);
```

**Bracket Corners (HUD authenticator)**:
```css
.jx2-hud-frame::before {
  content: '';
  position: absolute;
  top: 0; left: 0;
  width: 16px; height: 16px;
  border-top: 1px solid var(--jx2-crimson-500);
  border-left: 1px solid var(--jx2-crimson-500);
  opacity: 0;
  transition: opacity 150ms ease-out;
}
/* + ::after for bottom-right corner */
```

**Long Glowing Shadows (HUD labels)**:
```css
text-shadow:
  0 0 8px rgba(192, 57, 43, 0.6),
  0 0 24px rgba(192, 57, 43, 0.3);
```

**Glitch Transition** (kept subtle — not overused):
```css
@keyframes jx2-glitch {
  0%, 100% { clip-path: inset(0 0 100% 0); }
  20%       { clip-path: inset(40% 0 50% 0); transform: translateX(-2px); }
  40%       { clip-path: inset(20% 0 70% 0); transform: translateX(2px); }
  60%       { clip-path: inset(70% 0 20% 0); transform: translateX(-1px); }
  80%       { clip-path: inset(90% 0 0% 0); }
}
```

**Chrome surface** (panel sheen):
```css
background: linear-gradient(
  135deg,
  rgba(255,255,255,0.03) 0%,
  transparent 50%,
  rgba(192,57,43,0.02) 100%
);
```

## STATUS

Skill invocation FAILED via Skill tool (not in registered skill list).
Content was obtained by reading SKILL.md directly from disk and extracting the Retro-Futurism
vocabulary row + non-negotiable rules. The visual vocabulary above is the direct translation
applied to the Cerberus crimson system.

## FOR HUMAN DEBUGGING

If you want this skill to work via Skill tool in future sessions:
1. Verify `claude plugin list` shows `frontend-design-pro` as enabled
2. Check if the skill needs to be re-registered: the slug in SKILL.md is `frontend-design-pro`
   but it may need to be invoked as `frontend-design-pro:frontend-design-pro`
3. The plugin may need a session restart to appear in the dispatcher's registry
