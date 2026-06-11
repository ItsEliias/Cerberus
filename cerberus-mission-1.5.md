# CERBERUS — Mission 1: Foundation & Hardening

**Format:** RuFlo swarm mission / Claude Code prompt
**Optimization criterion:** autonomy. Minimise human touchpoints. There is exactly **one mandatory human gate** (end of Phase 0). Everything else runs autonomously and surfaces a written summary at each phase boundary.

---

## 0. What we're building (read first)

**Cerberus** is a self-hosted, security-hardened AI workspace. Three pillars, one guardian:

- The **backbone** is `odysseus` — chat, deep research, docs, email, calendar, agent loop, and the web UI.
- Every agent action (shell, code execution, file ops) is routed through an **isolated sandbox** so it can never touch the host directly. The sandbox *is* the brand — Cerberus guards the gate.
- It's **reachable from anywhere** (Telegram / Discord / Slack / etc.) by harvesting the messaging gateway from `hermes-agent`.

All three source repos are **Python**. There is no cross-language bridge. `elizaOS` was evaluated and **dropped** for this build (hermes already covers connectivity natively; eliza's only unique value — Farcaster connector, trading examples — belongs to other projects, not here).

---

## 1. Source repos, roles & licenses

| Repo | Role in Cerberus | License | Take | Ignore |
|---|---|---|---|---|
| `pewdiepie-archdaemon/odysseus` | **Backbone** — product surface + core agent loop | MIT | Everything; this is the base | — |
| `NousResearch/hermes-agent` | **Connectivity** — messaging gateway + cron | MIT | `gateway/`, `cron/`, platform adapters | Its agent loop, learning loop, memory (Mission 2 only) |
| `opensandbox-group/OpenSandbox` | **Secure execution** — sandboxed shell/code | Apache-2.0 | `server/`, Python SDK, code-interpreter, MCP | K8s-scale orchestration (Docker runtime is enough for the home server) |

**License rule (non-negotiable):** all three are permissive — forking, rebranding, and relicensing Cerberus is fine. But preserve every upstream copyright/`NOTICE`. Maintain a `THIRD_PARTY_LICENSES.md` at the Cerberus root listing all three with their original notices. Apache-2.0 (OpenSandbox) requires the `NOTICE` file be carried forward. odysseus already ships `ACKNOWLEDGMENTS.md` — extend it, don't delete it.

---

## 2. Guardrails (apply to every phase)

1. **No live credentials or real data until the sandbox is live.** Phase 0 audit found two criticals (C1/C2 — unsanitised shell injection in the agent + shell routes). These are closed by the Phase 2 OpenSandbox integration. Until C1/C2 are closed and verified, Phases 1 and 2 run on **throwaway/empty config only** — no real API keys, no real email, no real tokens. Agents NEVER paste secrets into any file or terminal; the human enters all secrets themselves, and only after the sandbox boundary is proven.
2. **Localhost only for the entire mission.** Keep `APP_BIND=127.0.0.1`, `AUTH_ENABLED=true`, `LOCALHOST_BYPASS=false`. Do not bind `0.0.0.0`, do not expose any port to the LAN or internet.
3. **Branch discipline.** All work on a `cerberus` branch. Never force-push. Conventional commits. **Before the first commit, set the git identity explicitly** (`git config user.name` / `user.email` to your intended GitHub identity) — we've been bitten by wrong-author attribution before; do not skip this.
4. **Phase gates surface a summary.** At the end of each phase, write a short `PHASE_N_REPORT.md` (what changed, what passed, what's risky, what's next) so the human can glance and move on without re-deriving anything.
5. **Don't destabilise the brain.** This mission harvests *edge* and *boundary* modules only. Do NOT touch odysseus's core agent loop or ChromaDB memory internals — that's explicitly Mission 2.

---

## 3. Suggested swarm topology (RuFlo)

- **Orchestrator** — owns the branch, the phase reports, and the definition of done. Holds the hard gate.
- **Auditor** — Phase 0, runs solo and serial (it gates everything else).
- **Brand** — Phase 1.
- **Sandbox-integrator** — Phase 2 (the highest-skill role; this is the core integration).
- **Connectivity** — Phase 3.

Phase 0 is serial. Phases 1 and 2 can run in parallel after the gate (rebrand touches `static/`, sandbox touches `src/agent_tools` — minimal overlap). Phase 3 starts once Phase 2's execution path is stable.

---

## 4. Phases

### Phase 0 — Audit & vendor  ⛔ HARD HUMAN GATE AT END

The base repo is a young account marketing shell access, email creds, API tokens, and model downloads. Trust nothing until reviewed.

**Tasks**
- Clone all three repos into a working dir. Pin commits/tags; record them in `PROVENANCE.md`.
- Security-review odysseus before it ever runs with real data. At minimum read and summarise: `app.py`, `core/auth`, `core/middleware`, `src/agent_loop`, `src/agent_tools` (especially the shell tool), `routes/`, `docker-compose.yml`, `setup.py`, and `.env.example`.
- Grep the tree for outbound network calls, telemetry, hardcoded hosts/URLs, `eval`/`exec`, subprocess calls, and anything that reads `.env`/`data/` and sends it anywhere. Flag every finding.
- Stand it up on localhost with **no real keys** (empty/throwaway). Confirm it boots, the admin account + temp password flow works, and the UI loads at `127.0.0.1:7000`.
- Do the same read-through (lighter) for the slices of hermes and OpenSandbox we'll vendor.

**Acceptance criteria**
- `SECURITY_AUDIT.md` exists: findings ranked (critical/high/medium/low), each with file:line and a recommended action. Explicit verdict line: *safe to proceed / proceed with fixes / do not proceed*.
- odysseus runs clean on localhost with throwaway config; screenshot or log proof in the report.

**⛔ GATE:** Orchestrator stops here and surfaces `SECURITY_AUDIT.md` to the human. **No further phase begins until the human returns an explicit go.** This is the only mandatory stop in the mission.

---

### Phase 1 — Rebrand → Cerberus

**Tasks**
- Fork/rename the project to **Cerberus** end-to-end: package name, app title, service names (`odysseus-ui.service` → `cerberus.service`), env prefixes (`ODYSSEUS_*` → `CERBERUS_*`, keeping back-compat aliases so nothing silently breaks), Docker image/container names, and the landing page in `docs/`.
- Restyle the frontend in `static/` (`index.html`, `style.css`, `app.js`, `js/`): new name, new color identity, new logo/wordmark. Guardian/gatekeeper visual direction — dark, three-headed motif optional but on-brand. Keep the existing component structure; this is a reskin + rename, not a rewrite.
- New `README.md` describing Cerberus (not odysseus). Move upstream credit into `ACKNOWLEDGMENTS.md` + `THIRD_PARTY_LICENSES.md`.
- **Security hardening — fold in the cheap fixes from the Phase 0 audit** (these are one-file each; no reason to wait for Phase 2):
  - **C3** — in `routes/shell_routes.py` `_generate_tmux`, wrap the interpolated `cmd` in `shlex.quote()` so a crafted command can't escape the generated bash script.
  - **H2** — in `core/middleware.py`, stop reading `INTERNAL_TOOL_TOKEN` from `os.environ`. Generate it unconditionally at process start with `secrets.token_hex(32)` and remove the env override entirely — it's the closest thing in the tree to a backdoor shape, so close it now.
  - **H3** — remove `LOCALHOST_BYPASS` from the Cerberus fork: set it permanently `false` in `.env`/compose and delete the bypass branch in `app.py`. There's no legitimate use for it in a guardian build.

**Acceptance criteria**
- No user-visible "odysseus" string remains (grep clean, excluding license/attribution files).
- C3, H2, and H3 are fixed and noted in `PHASE_1_REPORT.md` with before/after file:line.
- App still boots and all existing features work post-rename (run the existing test suite in `tests/`).
- `PHASE_1_REPORT.md` written.

---

### Phase 2 — Secure execution layer (OpenSandbox)  ← the core integration

This is the differentiator. Today odysseus's agent runs shell/code tools more or less directly. We reroute that entire execution path through OpenSandbox so the agent operates inside an isolated boundary, never on the host.

**Tasks**
- Add an `opensandbox-server` service to the Cerberus `docker-compose.yml` (Docker runtime; gVisor/Kata/Firecracker isolation configurable, default to the strongest the host supports). Keep it internal-only.
- In `src/agent_tools`, replace the host execution backend for the shell tool and any code-interpreter/python tool with calls to the OpenSandbox Python SDK (`from opensandbox import Sandbox` → `Sandbox.create(...)`, `sandbox.commands.run(...)`, `sandbox.files.read_file/write_files`, `CodeInterpreter` for code). One sandbox session per agent task; tear down on completion.
- Wire egress controls so sandboxed commands hit only an allowlist, not the open internet by default.
- Preserve the existing tool *interface* the agent loop expects (same inputs/outputs) so the core loop is untouched — we're swapping the execution backend beneath it, not the contract.

**Acceptance criteria**
- **Escape test passes:** an agent shell command attempting to read a host-only path (e.g. the host `.env`, host `/etc/passwd`) sees only the sandbox filesystem, not the host. Document the test + result.
- **Egress test passes:** a command trying to reach a non-allowlisted host is blocked.
- Normal agent tasks (run a script, write+read a file, install a package inside the sandbox) still succeed end-to-end.
- `PHASE_2_REPORT.md` written, including the escape/egress test evidence.

---

### Phase 3 — Connectivity + cron (harvest from hermes)

These are edge modules — they bolt onto the side and talk to Cerberus's existing chat API; they do **not** need (or touch) hermes's agent loop.

**Tasks**
- Vendor hermes's `gateway/` and platform adapters. Replace the seam where the gateway calls *hermes's* agent with a call to **Cerberus's existing chat/session REST endpoint**. Run it as a `cerberus-gateway` compose service (internal; the human supplies bot tokens later, post-mission, themselves).
- Vendor hermes's `cron/` scheduler. **Reconcile with odysseus's existing scheduled-tasks + ntfy feature** — extend that rather than duplicating it; the value we want from hermes is *delivery to messaging platforms* and natural-language scheduling, layered onto what odysseus already has.
- Start with **one** platform wired fully (Telegram is the lowest-friction) as the proof; structure the adapter layer so adding Discord/Slack/etc. later is config, not code.

**Acceptance criteria**
- A message sent to the configured platform (using a throwaway bot, or a documented dry-run/mock) round-trips: in → Cerberus agent → reply out.
- A scheduled cron job fires and delivers to a platform (or the mock).
- Adapter layer is platform-pluggable (adding a second platform requires no core changes).
- `PHASE_3_REPORT.md` written.

---

## 5. Definition of done (Mission 1)

- [ ] `SECURITY_AUDIT.md` delivered; human gate passed.
- [ ] Project fully rebranded to Cerberus; existing tests green; no stray "odysseus" in user-facing surfaces.
- [ ] Agent shell + code execution runs inside OpenSandbox; escape + egress tests pass.
- [ ] One messaging platform round-trips through the gateway; cron delivers to a platform.
- [ ] `THIRD_PARTY_LICENSES.md` + `ACKNOWLEDGMENTS.md` carry all upstream attributions (incl. Apache-2.0 NOTICE).
- [ ] Per-phase reports + `PROVENANCE.md` (pinned source commits) committed on the `cerberus` branch.
- [ ] Final `MISSION_1_SUMMARY.md` with the state of the build and any carried-forward risks.

---

## 6. Mission 2 — scoped, DO NOT START

**Hermes self-improving learning loop + memory merge.** This is where hermes's closed loop (auto-creating and self-improving skills, agent-curated memory, FTS5 session search, cross-session user modeling) gets fused into Cerberus's core.

**Why it's deferred:** it reaches *into* the core agent loop and ChromaDB memory internals — the exact things Mission 1 deliberately leaves untouched. Doing it while rebranding and wiring the sandbox would mean destabilising the brain and the body at the same time. Isolate the risk.

**Entry criteria:** Mission 1 done-done and stable, all tests green, sandbox boundary proven.

---

## 7. Kickoff (give this to Claude Code / the RuFlo orchestrator)

> You are the orchestrator for Cerberus Mission 1. Read this entire mission file. Begin **Phase 0 only**. Clone the three pinned repos, perform the security audit of odysseus, stand it up on localhost with no real credentials, and produce `SECURITY_AUDIT.md` with an explicit go/no-go verdict. Then **stop and surface the audit to me** — do not begin Phase 1 until I give an explicit go. Obey all guardrails in §2; never enter real secrets; localhost only; work on the `cerberus` branch with the git identity set first.
