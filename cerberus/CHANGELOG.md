# Changelog

All notable changes to Cerberus. Pairs with the CC changelog panel (PR #81).

## [Unreleased]

### Added

#### Command Center
- Council presets — save/load named agent routing configurations
- Changelog panel in the COUNCIL tab — in-app release notes (PR #81)
- i18n foundation — locale switching (EN/ES), `setLocale()` in `i18n.js` (PR #81)
- Memory Timeline sub-panel in the ASSISTANT tab
- Custom-persona badge on agent cards
- Wake-word activation — configurable phrase, `cerberus.wake_word_enabled` pref
- Agent skill assignment from the CC AGENTS tab
- Agent health monitor — per-agent up/down status strip with auto-recovery reset endpoint
- DOCUMENTS sub-panel in the ASSISTANT tab — list, view, import, new, delete
- NOTES sub-panel in the ASSISTANT tab — search, pin, Markdown preview, word count
- CONTACTS sub-panel in the ASSISTANT tab
- CC RESEARCH sub-panel — saved searches + history
- COMPARE tab — fan one prompt to up to 4 agents in parallel, blind-score
- OBSERVE tab — per-agent / per-model token breakdown, sparklines, session history
- System diagnostics strip in the OBSERVE tab (CPU, memory, uptime)
- GATEWAY tab — approval cards for high-risk agent tool calls
- Email composer panel in the CC GATEWAY tab
- Webhook manager panel in the CC WORKSPACE tab
- Scheduled-task manager panel in the CC WORKSPACE tab
- COMMAND tab — replaced placeholder mocks with live task + model data
- Keyboard shortcuts overlay (`?`) + quick-search overlay
- Expanded keyboard shortcuts: `r`, `t`, `p`, `g`, `Shift+R`, `Cmd+Enter`, `Cmd+/`
- Browser notifications for agent and room completion events
- Per-agent invocation-count chip (telemetry) on agent cards
- Memory viewer with search, count, and fallback in the AGENTS tab
- Prompt-testing panel on agent cards — history, diff, export
- Activity heatmap — last 30 days of agent invocations + streak chips on the dashboard
- Gateway status endpoint + CC HUD panel + GATEWAY tab badge

#### Voice
- Kokoro TTS offline neural voice engine
- Wake-word hands-free activation
- Transcript auto-save as note
- Recent-sessions strip in the VOICE panel

#### Gateway
- Discord platform adapter
- Per-platform tool tiers (scoped allowlists)
- Approval gate queue — high-risk actions require operator sign-off
- Email allowlisting — inbound gateway users filtered by domain/address

#### Documents & Research
- MarkItDown import: `.docx`, `.xlsx`, `.pptx`, `.pdf`, YouTube URLs
- Deep Research multi-step gather + synthesise → visual report

#### Agents
- 16 V4 tool-using agents: ARCHITECT, CODER, TESTER, RESEARCHER, REVIEWER, SECURITY, ORCHESTRATOR, DEVOPS, DATA-ANALYST, SCRIBE, DESIGNER, DEBUGGER, PLANNER, LIBRARIAN, OPTIMIZER, PROMPTSMITH
- Per-agent invocation telemetry (`invocation_count`)
- Git change summariser — auto-summarises commits on push
- Thread summariser — condenses long agent threads on demand

#### Mobile
- `GET /api/mobile` — session summary, thread list, paginated thread messages
- Push-token registration for browser + mobile notifications

#### Profile & Onboarding
- Operator profile — name, preferred model, notification prefs
- First-login onboarding wizard

#### Cyber Apps (native app panel)
- CyberLab Companion
- NetLab — packet/protocol playground
- NetworkMap — force-directed network topology visualiser
- ReconDesk — recon dashboard
- VaultCore
- CredVault
- GhostVault
- Dashboard — activity widgets
- ReportForge
- PlaybookStudio
- SignalBoard
- TerminalLink — Python PTY WebSocket bridge

#### Infrastructure
- OpenSandbox integration — every agent shell/code action isolated from host, fails closed
- Messaging gateway and cron scheduler (Phase 3)
- Claude Subscription subprocess provider
- Contacts API and CC panel

### Fixed

- Renamed `docs/odysseus.jpg` → `docs/cerberus.jpg`; updated all README references
- Revert/re-apply PlaybookStudio migration (clean consolidation)

### Changed

- Rebrand: odysseus → Cerberus; C3/H2/H3 hardening applied (Phase 1)
- Security audit Phase 0: `AUTH_ENABLED` hardcoded, `LOCALHOST_BYPASS` removed, internal token unpredictable, `shlex.quote()` on tmux `cmd`
- Vendor pins locked in `PROVENANCE.md`
- `dashboard.css` split to keep files under 500 lines
- Wave-1 cyber-app consolidation — all native apps ported to unified panel pattern
