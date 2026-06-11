# Subscription Provider Spike — Report

## Step 0 Findings

### Provider Interface Contract

Cerberus uses a **URL-based provider registry**.  Providers are not classes or
objects — they are identified by `ModelEndpoint.base_url`, and the function
`_detect_provider(url)` in `src/llm_core.py` maps URLs to provider strings.

The two consumer functions the chat system calls are:

| Function | Signature | Purpose |
|----------|-----------|---------|
| `stream_llm` | `(url, model, messages, ...)` async generator | Streaming completions |
| `llm_call_async` | `(url, model, messages, ...)` async | Non-streaming completions |

Both branch on the `_detect_provider()` result.  A new provider must handle
its own branch in both functions and yield/return the standard SSE wire format.

### Registration Point

`core.database.ModelEndpoint` rows with `is_enabled=True` are returned by the
`/api/models` and `/api/model-endpoints` routes and appear in the picker.  A
provider registers itself by inserting a `ModelEndpoint` row with its sentinel
`base_url`.

### Hide-from-Menu Pattern

Feature visibility is controlled by `data/features.json` (managed via
`src/settings.py` → `save_features` / `load_features`).  The
`/api/auth/features` endpoint (GET public, POST admin-gated) exposes it.

The default feature set is in `src/settings.py::DEFAULT_FEATURES`.  Adding a
key there with `False` hides the feature by default; the admin can flip it via
Settings → Features.

**File paths:**
- `src/llm_core.py` — `_detect_provider`, `stream_llm`, `llm_call_async`
- `src/endpoint_resolver.py` — `build_chat_url`, `build_models_url`, `build_headers`
- `routes/model_routes.py` — picker, endpoint CRUD
- `src/settings.py` — `DEFAULT_FEATURES`, `load_features`, `save_features`
- `routes/auth_routes.py` — `/api/auth/features` endpoint

---

## Step 4 Validation Results

### Test 1: SUBSCRIPTION-NOT-KEY — PASS

**What was tested:** The parent Python process had `ANTHROPIC_API_KEY=sk-junk-key-should-fail-api`
set.  The provider was invoked.  The child subprocess completed successfully
with `is_error=False, api_error_status=None`.

**How this confirms the gate:** A junk `ANTHROPIC_API_KEY` causes Claude Code
to return `api_error_status=401` (verified independently by running with the
junk key NOT scrubbed — got `is_error=True, api_error_status=401`).  Success
with the junk key in the parent environment proves the key was not inherited
by the child.

**Assertion:** `"ANTHROPIC_API_KEY" not in scrubbed_env` (test
`test_scrub_env_removes_api_key_and_auth_token` and
`test_call_completion_uses_scrubbed_env`, both pass).

### Test 2: Normal Prompt — PASS

Prompt: `"Say exactly: CERBERUS_OK"`. Result: `"CERBERUS_OK"`.
Response rendered correctly.

### Test 3: Streaming — PASS

SSE chunks received from `stream_completion`:
```
data: {"delta": "STREAM_OK"}\n\n
data: [DONE]\n\n
```
Token chunks arrive via `stream_event.event.type == "content_block_delta"`,
forwarded as `data: {"delta": "..."}` — identical to the wire format of all
other streaming providers.

### Test 4: Tools-Disabled — PASS

Prompt: `"List the files in /etc. Just respond with the text NO_TOOLS and nothing else."`
Result: `"NO_TOOLS"` — no shell command was executed, no filesystem reads
occurred as a side effect.

Mechanism: `--tools ""` (verified in `test_flags_contain_tools_empty` — the
flag is present in both `_CLAUDE_FLAGS_SYNC` and `_CLAUDE_FLAGS_STREAM`).

### Test 5: Missing-Dependency / Logged-Out Graceful Messages — PASS

| Condition | Error message |
|-----------|--------------|
| Binary not found | "Claude Code is not installed. Install it with: npm install -g @anthropic-ai/claude-code" |
| Not logged in | "Claude Code is installed but you are not logged in to your subscription." + "Run `claude` in your terminal and use /login to authenticate." |

Neither state produces a stack trace or silent hang.

### Test 6: Provider Picker Integration — PASS

| Check | Result |
|-------|--------|
| `_detect_provider("claude-subscription://local")` | `"claude-subscription"` |
| `build_chat_url("claude-subscription://local")` | `"claude-subscription://local"` (passthrough) |
| `build_models_url("claude-subscription://local")` | `None` (no HTTP probe) |
| `build_headers(None, "claude-subscription://local")` | `{}` (no HTTP auth headers) |
| Existing providers unaffected | `api.anthropic.com` → `anthropic`, etc. — all correct |

### Test 7: Existing Providers / Running App Unaffected — PASS

All 3203 pre-existing tests still pass (3207 collected total, 4 skipped
unchanged).  17 new tests added, all pass.

---

## Claude Code Version and Flags

**Version:** `2.1.152 (Claude Code)` — confirmed via `claude --version`.

**Sync flags:**
```
claude -p --tools "" --output-format json --no-session-persistence
```

**Stream flags:**
```
claude -p --tools "" --output-format stream-json --verbose --include-partial-messages --no-session-persistence
```

**Why `--bare` is excluded:** The `--bare` flag disables OAuth login (keychain
reads) and requires `ANTHROPIC_API_KEY` via env — the opposite of what this
provider needs.

---

## Deviations from Existing Provider Pattern

| Aspect | Existing providers | Claude Subscription |
|--------|-------------------|---------------------|
| Transport | HTTP (httpx) | Subprocess (asyncio.create_subprocess_exec) |
| Auth | API key in `ModelEndpoint.api_key` | OAuth via Claude Code CLI; `api_key = None` |
| Setup flow | Admin enters base URL + key | POST `/api/claude-subscription/provision` |
| Model list | Fetched from `/models` endpoint | Static list (`_MODELS` in routes file) |
| Sentinel URL | Real HTTP URL | `claude-subscription://local` (non-routable) |
| `build_models_url` | Returns HTTP URL | Returns `None` |
| `_ping_endpoint` | Makes HTTP request | Runs `preflight_check()` instead |

The deviation is the minimum required to support a subprocess transport.  All
other integration points (ModelEndpoint row, picker, SSE wire format, chat
rendering) are identical to existing providers.

---

## Branch, Commit, and Author

```
Branch: feat/claude-subscription-provider
```

See `git log -1 --pretty=full` for the commit hash and author line after the
commit is created.

Author verified: `git config user.name = ItsEliias`, `git config user.email = itseliiasstudy@gmail.com`.
