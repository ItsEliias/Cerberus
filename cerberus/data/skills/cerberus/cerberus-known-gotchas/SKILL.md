---
name: cerberus-known-gotchas
description: Running list of Cerberus-specific footguns that repeatedly cause wasted debugging time
version: 1.0.0
category: cerberus
tags: [debugging, gotchas, cerberus, footguns]
status: published
confidence: 1.0
source: authored
owner: itseliias
created: "2026-06-19T00:00:00Z"
---

## When to Use

Before starting debugging or when a change appears to have no effect — check this list first.

## Procedure

Check against this list before spending time on more complex diagnoses:

1. **Stale Docker container** — Docker `COPY` in the Dockerfile picks up whatever files were last built. If you edited a file but didn't commit AND rebuild, the running container has the old version. A change is done only when committed, pushed, AND the container was rebuilt (`docker compose up -d --build cerberus`). Never trust "it works locally but not in Docker" without a rebuild.

2. **CC iframe CSS isolation** — The Claude Code iframe (`/cc`) is a separate browsing context. CSS rules in the parent shell (`style.css`, `hud.css`) do not cross the iframe boundary. All styles needed inside the CC app must be linked inside `cc-app/index.html` or the Vite bundle. If your CSS change has no visual effect inside the CC panel, this is why.

3. **WebKit `appearance` override** — macOS Safari and WebKit-based browsers apply OS-level chrome to `<button>`, `<select>`, `<input>`, and `<textarea>` elements unless you explicitly set `-webkit-appearance: none; appearance: none`. Missing this makes HUD-styled elements render with the OS default look. Required on every custom-styled form element.

4. **JS cache in CC iframe** — After rebuilding the Vite bundle, the CC iframe often serves the old JS from the browser cache. Hard-refresh (`Cmd+Shift+R`) inside the CC panel, or add a cache-busting query string. Standard `Cmd+R` on the parent page does not clear the iframe cache.

5. **Auth cookie missing** — Every API call to `/api/*` requires the `cerberus_session` cookie. If an agent or script makes a direct HTTP request without the cookie, it gets a silent 401 (the API does not redirect to login). Verify cookie presence if an API call returns 401 unexpectedly.
