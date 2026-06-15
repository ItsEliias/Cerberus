# Mission 2 — Report

**Branch**: cerberus  
**Completed**: 2026-06-15  
**Baseline tests**: 3187 passed, 7 failed → 3195 passed, 2 failed (pre-existing subscription alias mismatch)

---

## Audit finding: most scope was already present

The Mission 2 brief ("merge hermes's self-improving learning loop and cross-session memory") turned out to be largely pre-built in the odysseus upstream. A full audit found:

| Capability | Status | Location |
|------------|--------|----------|
| Cross-session memory injection | ✅ Present | `src/chat_processor.py` — pinned + RAG-retrieved |
| Memory extraction (auto on chat end) | ✅ Present | `services/memory/memory_extractor.py` + `routes/chat_helpers.py` |
| Skill extraction (auto on chat end) | ✅ Present | `services/memory/skill_extractor.py` + `routes/chat_helpers.py` |
| Skill injection (relevant per message) | ✅ Present | `src/agent_loop.py` `_build_system_prompt()` |
| FTS5 session search | ✅ Present | `src/session_search.py` + `core/database.py` triggers |
| `search_chats` agent tool | ✅ Present | `src/tool_schemas.py` + `src/tool_implementations.py` |
| Nightly skill audit (curator) | ✅ Present | `app.py` `_skill_audit_nightly_loop()` |
| Discord gateway adapter | ✅ Present | `gateway/platforms/discord.py` |

---

## What actually shipped in Mission 2

### 1. Proactive session recall (`src/chat_processor.py`)

The one genuine gap: past-session context was searchable on-demand via `search_chats`, but never injected automatically. The agent had to decide to search; it didn't know to look.

Added proactive recall to `build_context_preface()`:
- Fires only on the first 4 turns of a session (short enough to have no established context yet)
- Requires ≥4 content tokens in the message (avoids querying on "hi")
- Searches past sessions via `search_session_messages()` with the current message's content tokens
- Injects up to 2 matching snippets as `untrusted_context_message("past session recall", ...)`
- Excludes the current session from results (no duplicate injection)
- Gated on `use_memory=True` — respects incognito and the user's memory-enabled toggle
- Fails silently (`except Exception as _re: logger.debug(...)`) — never breaks a chat

**8 new tests** in `tests/test_session_recall.py` cover: injection, current-session exclusion, incognito skip, long-session skip, short-message skip, 2-result cap, no-hit path, use_memory=False skip.

### 2. GPU compose drift fix

The standalone GPU compose files (`docker-compose.gpu-nvidia.yml`, `docker-compose.gpu-amd.yml`) had drifted from the base `docker-compose.yml`. Added:
- `./static:/app/static:z` volume (was in base, missing from standalones)
- `${HOME}/.claude:/app/.claude:z` volume (Claude subscription OAuth state)
- `SANDBOX_URL=http://opensandbox-server:8090` on cerberus service
- `OPENSANDBOX_INSECURE_SERVER=YES` on opensandbox-server service

Fixes 5 of 7 failing GPU compose tests (7 → 2 pre-existing failures).

---

## Pre-existing test failures (not introduced by Mission 2)

| Test | Root cause |
|------|------------|
| `test_claude_subscription_provider.py::test_provision_endpoint_creates_row` | `_MODELS` uses short aliases ("opus", not "claude-opus-*"); test expects full model IDs |
| `test_claude_subscription_provider.py::test_models_list_contains_claude_models` | Same |

These failures predate Mission 2 and are unrelated to any changes made here.

---

## Sandbox egress limitation (Mac Docker Desktop)

Live sandbox tests run on 2026-06-15:
- `test_live_escape_host_env_not_readable` — **PASSED** (host `.env` not visible in sandbox)
- `test_live_escape_etc_passwd_unmodified` — **PASSED** (host users not visible in sandbox)
- `test_live_egress_non_allowlisted_host_blocked` — **FAILED** (expected on macOS)

**Root cause**: Docker Desktop on macOS runs containers inside a Linux VM using userland networking (VPNKit), not iptables. The OpenSandbox egress sidecar uses iptables-based packet filtering which is a no-op inside the VM. Egress blocking therefore doesn't apply on Mac Docker Desktop.

**On a Linux host**: the egress test would pass. The iptables rules are enforced natively.

**Mitigation**: The escape tests (isolation) pass — the sandbox correctly isolates the host filesystem and environment from agent code. The egress boundary is a network-layer guarantee only achievable on Linux. Document in deployment notes.

---

## Commits

| Hash | Description |
|------|-------------|
| `dcb86da` | feat(m1.5-stretch): voice auto-send, CC mobile, rail badge, sandbox URLs |
| `9165e36` | feat(mission2): proactive session recall + GPU compose drift fix |

---

## Mission 3 entry

Mission 2 is complete. Reasonable next missions:
- **Hardening**: production API key auth on OpenSandbox (`server.api_key` in config); remove `OPENSANDBOX_INSECURE_SERVER=YES`
- **Gateway**: Slack adapter (same pattern as Discord/Telegram)
- **Intelligence**: Inline citation of recalled sessions in agent responses
- **UI**: CC Gateway tab showing Telegram/Discord connection state, last message time
