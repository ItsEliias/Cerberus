# PROVENANCE

Auditor: cerberus-phase0-auditor (Claude Sonnet 4.6)
Audit date: 2026-06-11

---

## Vendored Repositories

### 1. odysseus (backbone)

| Field | Value |
|-------|-------|
| Source | `https://github.com/pewdiepie-archdaemon/odysseus` |
| Role | Backbone — chat, agent loop, UI, email, calendar, memory |
| License | AGPL-3.0 |
| Pinned commit SHA | `d5603ee57551c00e59f9a6c7b4b07075fb66ef6f` |
| Tag | `d5603ee` (no release tag; HEAD of default branch) |
| Commit date | 2026-06-11 02:17:02 +0300 |
| Clone date | 2026-06-11 |
| Local path | `vendor/odysseus/` |

### 2. hermes-agent (connectivity)

| Field | Value |
|-------|-------|
| Source | `https://github.com/NousResearch/hermes-agent` |
| Role | Connectivity — messaging gateway, cron, platform adapters |
| License | MIT |
| Pinned commit SHA | `d1383a6b1450c6c139720b1b01f8b99cc130453f` |
| Tag | `v2026.6.5-572-gd1383a6b1` |
| Commit date | 2026-06-10 14:46:21 -0700 |
| Clone date | 2026-06-11 |
| Local path | `vendor/hermes-agent/` |
| Phase 0 scope | Skim only (`gateway/`, `cron/`, platform adapters) |

### 3. OpenSandbox (secure execution)

| Field | Value |
|-------|-------|
| Source | `https://github.com/opensandbox-group/OpenSandbox` |
| Role | Secure execution — sandboxed shell/code, MCP |
| License | Apache-2.0 |
| Pinned commit SHA | `476bb979cb46049e72ad231b25b1fac964ce95d0` |
| Tag | `java/code-interpreter/v1.0.12-22-g476bb979` |
| Commit date | 2026-06-09 23:35:33 +0800 |
| Clone date | 2026-06-11 |
| Local path | `vendor/OpenSandbox/` |
| Phase 0 scope | Skim only (`server/`, Python SDK, code-interpreter, MCP) |

---

## Notes

- All three repos are pinned to the SHAs above as **git submodule commits** under `vendor/`. The `.gitmodules` file at the repository root maps each path to its upstream URL, so the build is reproducible: `git clone --recurse-submodules` (or `git submodule update --init`) checks out exactly these commits.
- The Apache-2.0 NOTICE requirement for OpenSandbox is satisfied: no NOTICE file was present in the OpenSandbox repository at the pinned SHA, so there is nothing to carry forward. This is recorded in `THIRD_PARTY_LICENSES.md`.
- Full license texts for all three upstreams are in `cerberus/THIRD_PARTY_LICENSES.md`.
