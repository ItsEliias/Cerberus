# Cerberus · Recon

A Cerberus module. An Electron app that wraps a real terminal (xterm.js + node-pty)
and launches **Claude Code** as its subprocess — pre-loaded with your recon/pentest
plugin stack instead of a generic shell — alongside a dashboard for tracking scope,
findings, and session history. Skinned to the OS shell: Orbitron/JetBrains Mono,
crimson-on-void, CRT scanlines, `// ` HUD headers, bracket-corner cards.

It's an **orchestration shell**, not a scanner. It runs no tools itself and ships no
exploits; it gives your existing Claude Code + plugin workflow a branded home with
persistent state. All active testing still happens inside Claude Code, under your
approval, on programs you're authorized on.

## Run it

**Easiest — double-click `run.command`.** First launch installs everything and opens
the app; every launch after that just opens it. (If macOS Gatekeeper blocks it the
first time: right-click → Open.)

**Or from a terminal:**

```bash
cd cerberus-recon
npm install     # installs deps, vendors xterm + fonts, rebuilds the terminal engine
npm start
```

You need **Node.js** (LTS) installed — that's the only prerequisite. `npm install`
handles the rest, including the native `node-pty` rebuild via the postinstall step.
If the terminal pane ever shows a "run npm run rebuild" error (usually after an
Electron upgrade), run `npm run rebuild` once.

## Using it

The left rail switches the top view between **Scope**, **Findings**, and **Sessions**;
the Claude Code terminal stays docked at the bottom the whole time. Drag the divider to
resize it.

- **Terminal (docked)** launches `claude` by default, straight into your Claude Code
  session with the plugin stack. If `claude` isn't on PATH it drops to a shell.
- **Workdir** sets the folder the session runs in (a target's engagement folder). This
  is also where findings are watched from — see below. **Restart session** relaunches it.
- **Scope** — assets you're cleared to touch. The green/grey dot toggles in-scope; the
  "in / scope" chip up top counts them.
- **Findings** — severity-sorted, and **live**: anything written to the workdir's
  findings folder appears automatically (no refresh). Expand a finding for its
  reproduction steps, a **Show how to reproduce** button, and its screenshot gallery.
- **Sessions** — every terminal session with start/end + workdir, so you can see old runs.

State: scope + sessions persist under Electron's `userData/cerberus-recon/`; findings
live in the workdir (below) so they travel with the engagement.

Override the launched command with `CERBERUS_SHELL=/bin/zsh` before `npm start`.

## Auto-logging findings (the folder convention)

When a Workdir is set, the app watches **`<workdir>/.cerberus/findings/`** and ingests
every finding live. To auto-log, the agent (claude-pentest, a hook, or you) drops one
JSON file per finding there:

```
<workdir>/.cerberus/findings/
├── a1b2c3d4.json          # the finding
└── a1b2c3d4/              # its screenshots (folder named by id)
    ├── step-1.png
    └── step-2.png
```

```json
{
  "id": "a1b2c3d4",
  "title": "Bonus claimable twice via race condition",
  "target": "app.example.com",
  "severity": "high",
  "note": "No idempotency key on /wallet/redeem",
  "steps": [
    "Log in and open the wallet page",
    "Send 20 parallel POST /wallet/redeem with the same code",
    "Observe balance credited 20x"
  ],
  "source": "agent",
  "ts": 1752000000000
}
```

`severity` ∈ `critical | high | medium | low | info`. Only `id` and `title` are strictly
required; everything else is optional.

**Show how to reproduce** types a retrace instruction into the live session, asking the
agent to walk the `steps` and save `step-<n>.png` into the finding's folder. As those
images land, the app picks them up and shows them in the gallery — that's the automatic
"screenshots on retrace" flow. (The agent needs a screenshot-capable tool, e.g. the
browser/Kali MCP, for the capture half.)

## Layout

```
cerberus-recon/
├── run.command           # double-click launcher (macOS)
├── package.json          # deps: electron, node-pty, @xterm/*
├── main.js               # Electron main — spawns the pty, persists state
├── preload.js            # locked-down IPC bridge (contextIsolation on)
├── scripts/vendor.js     # copies xterm bundles into renderer/vendor (postinstall)
└── renderer/
    ├── index.html
    ├── theme.css         # ported Cerberus tokens (crimson spine, void surfaces)
    ├── app.css           # this module's HUD layout
    ├── app.js            # dashboard + terminal wiring
    ├── glyph.svg         # three-headed shield
    └── vendor/fonts/     # Orbitron + JetBrains Mono (self-hosted, offline)
```

## Folding into the main Cerberus repo

Built standalone so it drops in cleanly. To make it a real module:

1. Replace `renderer/theme.css` with an import of your shared `jarvis-v2/tokens.css` +
   `command-center/styles.css` — the tokens here are a faithful port, so the swap is
   mechanical. Reuse the self-hosted fonts you already ship in `static/fonts/`.
2. Point the module loader at `renderer/index.html`.
3. Reuse the shield glyph from your shared asset set.

## Scope & safety — read before pointing anything at a target

This shell doesn't relax any rule that already applies to your workflow:

- **Authorized programs only.** Every Scope entry should map to a program whose rules
  you've read and that permits your testing.
- **Check each program's automated-scanning policy first.** Many bug bounty programs
  rate-limit or prohibit unthrottled scanning; violating that can get you removed even
  when the finding is valid.
- **Human-in-the-loop stays.** Keep active exploitation behind Claude Code's approval
  gates — the value here is recon/triage/hypothesis speed, not walk-away automation.
- **Vet third-party plugins.** claude-pentest, Kali MCP wrappers, etc. run with your
  shell permissions — review their hooks/config before trusting them (the plugin/hook
  RCE advisories you already flagged).
