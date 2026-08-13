# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Electron app that wraps a real terminal (xterm.js + node-pty) and, by default, launches the `claude` CLI as its subprocess — so the whole app becomes a branded shell around a Claude Code session, alongside a Scope / Findings / Sessions dashboard. It runs no scanners or exploits itself; all active testing happens inside the embedded Claude Code process.

## Commands

```bash
npm install          # installs deps + runs scripts/vendor.js postinstall
npm start            # electron .
npm run rebuild      # electron-rebuild for node-pty (run after any Electron bump)
./run.command        # macOS double-click launcher (first-run installs + rebuilds)
```

There is no test suite and no lint config. Do not invent one.

Override the subprocess the terminal launches:

```bash
CERBERUS_SHELL=/bin/zsh npm start
```

## Architecture

Three-process Electron app with strict isolation:

- **`main.js`** — Electron main. Owns the pty (`node-pty`), all filesystem state, and every IPC handler. `node-pty` is required lazily; if it fails to load (ABI mismatch after an Electron upgrade) the window still opens and surfaces a "run `npm run rebuild`" message via the `pty:start` return value.
- **`preload.js`** — the only bridge. Exposes a narrow `window.cerberus` API via `contextBridge` under `contextIsolation: true`, `nodeIntegration: false`. Renderer has no direct Node access — every new capability must be plumbed through here.
- **`renderer/`** — plain HTML/CSS/JS (no framework, no bundler). `app.js` wires the terminal pane + dashboard; xterm is loaded from `renderer/vendor/` (not a CDN) so a strict `self` CSP is possible.
- **`scripts/vendor.js`** — postinstall hook. Copies xterm's browser bundles from `node_modules/@xterm/*` into `renderer/vendor/`. If you upgrade xterm, this is what makes the new version visible to the renderer.

### Terminal launch flow (`main.js:resolveLaunchCommand` / `spawnPty`)

The pty always spawns the user's `$SHELL`, then runs a bootstrap that `exec`s `claude` if it's on PATH and falls back to the shell otherwise. `CERBERUS_SHELL` short-circuits this and runs the override directly with no fallback. `restart session` from the UI calls `pty:start` again, which kills the existing pty first.

### State: two very different stores

- **Scope + sessions** live under Electron's `userData/cerberus-recon/` as `scope.json` / `sessions.json`. Global to the app — they don't move with the target.
- **Findings** live in the workdir: `<workdir>/.cerberus/findings/<id>.json`, with screenshots in a sibling folder `<workdir>/.cerberus/findings/<id>/`. They travel with the engagement, and the main process watches that folder with `fs.watch({recursive:true})`, debounced 150 ms, so agent-written files appear live in the UI with no refresh. If no workdir is set, findings fall back to `userData/cerberus-recon/findings/`.

Any code that touches findings must go through `findingsRoot()` so the workdir-vs-fallback rule stays in one place.

### Findings JSON contract

Only `id` and `title` are required. `severity ∈ critical|high|medium|low|info` drives sort order in the UI. Screenshots are read as base64 data URLs at IPC time (see `findingAssets`); anything the agent drops into `<id>/*.{png,jpg,jpeg,gif,webp}` shows up in the gallery.

### Reproduce flow

`findings:reproduce` IPC (`main.js:170`) writes a retrace prompt directly into the live pty asking the agent to save `step-<n>.png` under the finding's folder. Those files land in the watched folder → renderer picks them up automatically. This is the whole "screenshots on retrace" mechanism — there is no separate screenshot pipeline.

## Conventions to preserve

- Keep `contextIsolation: true` / `nodeIntegration: false`. Add new capabilities by extending `preload.js`, never by loosening the sandbox.
- Keep xterm and fonts vendored under `renderer/vendor/`. No CDN loads — the CSP story depends on it.
- The main process is the only writer for `.cerberus/findings/*.json` from within the app; agents write there too, and the file watcher is the reconciler. Don't add a second write path in the renderer.
- README's Layout section documents the intended file tree; if you add a top-level file or folder, update that section too.
