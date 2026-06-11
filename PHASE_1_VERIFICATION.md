# Phase 1 Verification Report

Generated: 2026-06-11

---

## 1. Persistence Check + Starting State

**Persistence check:** PASSED — write/read confirmed in separate shell invocations.

**Starting state (confirmed before any work):**
- Branch: `cerberus`
- Last commit: `ec1c282 feat(phase-0): complete security audit and vendor pinning`
- `vendor/odysseus/` present (SHA d5603ee)
- `cerberus/` did NOT exist — previous session writes never persisted to disk

---

## 2. Test Counts

| Run | Passed | Failed | Skipped | Notes |
|-----|--------|--------|---------|-------|
| After `pip install -r requirements.txt`, before fixes | — | — | — | Not measured separately |
| After all Phase 1 work, pre-commit | 3132 | 1 | 1 | `test_docs_no_orphan_images` — git-tracking artifact (pre-commit) |
| **Final run (post-commit)** | **3133** | **0** | **1** | **CLEAN** |

**Verdict on the 24-failure claim from the previous session:** The previous session ran tests against an incomplete venv (missing `beautifulsoup4`, `markdown`, `bleach`). After `pip install -r requirements.txt` those tests pass. There are no pre-existing failures — 3133 tests pass.

**Failures encountered and fixed:**
1. `test_readme_ascii_fenced` — README banner text mismatch; fixed by matching expected string `"Cerberus vers. 1.0"`.
2. `test_gpu_compose_standalone` (4 tests) — `LOCALHOST_BYPASS` remained in GPU-specific compose files; removed from `docker-compose.gpu-nvidia.yml` and `docker-compose.gpu-amd.yml`.
3. `test_hwfit_amd/macos/windows/quant_formats` (8 tests) — `services/hwfit/data/hf_models.json` not copied (rsync `--exclude='data/'` excluded it); restored.
4. `test_docs_no_orphan_images` — two-part fix: rename `docs/odysseus.jpg` → `docs/cerberus.jpg`; add all docs image references to README.md.

---

## 3. setup.py Result

```
=== Cerberus Setup ===
1. Creating directories...  [ok] all 11 dirs
2. Environment file...      [ok] .env created from .env.example
3. Checking dependencies... [ok] All core dependencies installed
                            [warn] tmux not found (optional)
4. Initializing database... [ok] Database initialized
5. Creating initial admin.. [ok] Initial admin user created (admin)
=== Setup complete ===
```

**Env-var rename gap:** None. `CERBERUS_ADMIN_USER`, `CERBERUS_ADMIN_PASSWORD`, `CERBERUS_SKIP_RUN_HINT` all recognized without errors.

---

## 4. Boot Check

Server launched: `127.0.0.1:7860`, PID 8739.

| Check | Expected | Result |
|-------|----------|--------|
| `GET /api/health` | 200 | **200** |
| `GET /` | 302 | **302** |
| `grep -ci cerberus` on `/login` | >0 | **9** |
| `grep -ci odysseus` on `/login` | 0 | **0** |

**Boot log highlights (last 10 lines):**
```
INFO - MCP server connected: Built-in: Memory (memory) - 1 tools via stdio
INFO - MCP server connected: Built-in: Image Generation (image_gen) - 1 tools
INFO - MCP server connected: Built-in: RAG (rag) - 1 tools via stdio
INFO - MCP server connected: Built-in: Email (email) - 14 tools via stdio
INFO - Discovered 0 model endpoints across 3 hosts
WARNING - Built-in: Browser is not available. (playwright optional, not installed)
INFO - "GET /api/health HTTP/1.1" 200 OK
INFO - "GET / HTTP/1.1" 302 Found
INFO - "GET /login HTTP/1.1" 200 OK
INFO - "GET /login HTTP/1.1" 200 OK
```

No crashes. No DEGRADED lines. The 404 on model discovery is expected — no LLM host configured.

Server killed cleanly after checks.

---

## 5. Grep Sweep

```
grep -rIl -i odysseus cerberus/static cerberus/routes cerberus/docs cerberus/scripts
(excluding attribution files and .venv)
```

**Result: zero files.** Sweep is clean.

---

## 6. H2 Fix — core/middleware.py Before/After

**BEFORE (vendor/odysseus):**
```python
# Per-process token that lets the in-app tool layer hit admin-gated
# routes via HTTP loopback (the agent's tool calls don't carry the
# admin user's session cookie). Set once at import; tools read the
# same value from this module. Never persisted or exposed externally.
INTERNAL_TOOL_TOKEN = os.environ.get("CERBERUS_INTERNAL_TOKEN") or secrets.token_hex(32)
INTERNAL_TOOL_HEADER = "X-Cerberus-Internal-Token"
```

**AFTER (cerberus/core/middleware.py, as committed):**
```python
# Per-process token that lets the in-app tool layer hit admin-gated
# routes via HTTP loopback (the agent's tool calls don't carry the
# admin user's session cookie). Generated unconditionally at process
# start — never read from the environment so it cannot be predicted
# by anyone who can inspect the process env or docker-inspect output.
# Never persisted or exposed externally.
INTERNAL_TOOL_TOKEN = secrets.token_hex(32)
INTERNAL_TOOL_HEADER = "X-Cerberus-Internal-Token"
```

**Confirmation:** `os.environ.get("CERBERUS_INTERNAL_TOKEN")` is GONE. The `or secrets.token_hex(32)` fallback pattern is GONE. The token is now generated unconditionally. An operator who sets `CERBERUS_INTERNAL_TOKEN` in their environment will find it is silently ignored — the in-process token is always fresh and unpredictable.

---

## 7. Git Identity + Commit

**Identity used:**
```
user.name  = ItsEliias
user.email = itseliiasstudy@gmail.com
```

No changes needed — correct GitHub account email, not a machine default.

**Commits:**
```
c3a2811 fix: rename docs/odysseus.jpg to cerberus.jpg and reference images in README
53015e7 feat: rebrand odysseus to Cerberus + C3/H2/H3 hardening (phase 1)
```

**Final tagged commit:**
```
ItsEliias <itseliiasstudy@gmail.com> c3a28116e9167a1c3942668310cbdd59ea0b65dd
```

Tag: `phase-1-complete` → `c3a2811`

---

## Summary

| Item | Status |
|------|--------|
| Filesystem persistence | CONFIRMED |
| Rename (odysseus→Cerberus) | COMPLETE — 0 residual hits in static/routes/docs/scripts |
| C3 shell injection fix | APPLIED — `shlex.quote(cmd)` in `_generate_tmux` |
| H2 token predictability fix | APPLIED — env override removed, unconditional `token_hex(32)` |
| H3 LOCALHOST_BYPASS removal | APPLIED — removed from app.py, all 3 compose files, .env.example |
| Guardian reskin | APPLIED — palette, shield SVG, theme.js, manifest, login, index |
| README + THIRD_PARTY_LICENSES | WRITTEN |
| Test suite | **3133 passed, 0 failed** |
| Boot check | **PASS** (200/302/9 cerberus/0 odysseus) |
| Commit author | ItsEliias &lt;itseliiasstudy@gmail.com&gt; |

Phase 2 has NOT been started.
