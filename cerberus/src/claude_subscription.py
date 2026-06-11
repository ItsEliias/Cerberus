"""Claude (Subscription) provider — subprocess adapter backed by Claude Code CLI.

This module drives the Claude Code CLI (`claude -p`) in headless print mode,
authenticated via the user's existing Claude Max / Pro OAuth login.  It is
intentionally NOT an HTTP provider — there is no base URL to hit and no API
key field.  Authentication is handled entirely by the Claude Code binary
through its own credential store (``~/.claude/``).

Transport: subprocess.  The child process is spawned with a CLEANED
environment: ``ANTHROPIC_API_KEY`` and ``ANTHROPIC_AUTH_TOKEN`` are always
removed before exec so the CLI uses OAuth, never an API account key.  This is
the #1 safety requirement for this provider.

Constraints:
- Non-agentic: ``--tools ""`` disables all built-in tools.
- Interactive use only: do NOT wire this into swarm/automation lanes.
- No API key field in the provider configuration.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
from typing import Any, AsyncGenerator, Dict, List, Optional

logger = logging.getLogger(__name__)

CLAUDE_SUBSCRIPTION_PROVIDER = "claude-subscription"

# Sentinel URL that identifies this provider inside the Cerberus URL-based
# provider registry.  It carries no network meaning — it is parsed by
# is_claude_subscription_base() and _detect_provider() only.
CLAUDE_SUBSCRIPTION_SENTINEL_URL = "claude-subscription://local"

# Environment variable names that must be stripped before spawning the child
# process to ensure OAuth is used instead of an API key account.
_SCRUBBED_ENV_KEYS = frozenset({"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"})

# Claude Code flags used for headless operation.
# Verified against Claude Code 2.1.152.
_CLAUDE_FLAGS_STREAM = [
    "-p",
    "--tools", "",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--no-session-persistence",
]

_CLAUDE_FLAGS_SYNC = [
    "-p",
    "--tools", "",
    "--output-format", "json",
    "--no-session-persistence",
]

# Auth-check paths: Claude Code stores auth in the macOS keychain; the
# presence of ~/.claude/settings.json is a reliable proxy for "the user has
# completed `claude` setup and logged in at least once".  We also check the
# legacy credentials.json path used by older versions.
_CLAUDE_AUTH_PATHS = [
    os.path.expanduser("~/.claude/settings.json"),
    os.path.expanduser("~/.claude/credentials.json"),
    os.path.expanduser("~/.config/claude/credentials.json"),
]


class ClaudeSubscriptionError(RuntimeError):
    """Base error for Claude Subscription provider failures."""


class ClaudeSubscriptionNotInstalled(ClaudeSubscriptionError):
    """Claude Code CLI is not installed or not on PATH."""


class ClaudeSubscriptionNotLoggedIn(ClaudeSubscriptionError):
    """Claude Code CLI is installed but the user is not logged in."""


def resolve_claude_binary(binary_hint: Optional[str] = None) -> str:
    """Return path to the claude binary.

    Args:
        binary_hint: Override from provider config.  Falls back to PATH.

    Raises:
        ClaudeSubscriptionNotInstalled: if the binary cannot be found.
    """
    path = (binary_hint or "").strip() or shutil.which("claude") or ""
    if not path or not os.path.isfile(path):
        raise ClaudeSubscriptionNotInstalled(
            "Claude Code is not installed. Install it with: npm install -g @anthropic-ai/claude-code"
        )
    return path


def check_auth_present() -> bool:
    """Return True if a Claude subscription credentials file exists on disk."""
    return any(os.path.exists(p) for p in _CLAUDE_AUTH_PATHS)


def preflight_check(binary_hint: Optional[str] = None) -> Dict[str, Any]:
    """Run preflight checks and return a status dict.

    Returns:
        ``{"ok": True}`` on success.
        ``{"ok": False, "error": str, "action": str}`` on failure with a
        user-facing message and suggested remediation action.
    """
    try:
        binary = resolve_claude_binary(binary_hint)
    except ClaudeSubscriptionNotInstalled as exc:
        return {
            "ok": False,
            "error": str(exc),
            "action": "Install Claude Code: npm install -g @anthropic-ai/claude-code",
        }

    if not check_auth_present():
        return {
            "ok": False,
            "error": "Claude Code is installed but you are not logged in to your subscription.",
            "action": "Run `claude` in your terminal and use /login to authenticate.",
            "binary": binary,
        }

    return {"ok": True, "binary": binary}


def _scrub_env() -> Dict[str, str]:
    """Return a copy of os.environ with API key variables removed."""
    return {k: v for k, v in os.environ.items() if k not in _SCRUBBED_ENV_KEYS}


def _build_prompt(messages: List[Dict]) -> str:
    """Flatten an OpenAI-style message list into a single prompt string.

    System messages are prepended as an instruction block.  Tool and non-text
    messages are stripped to text content only.
    """
    parts: list[str] = []
    system_parts: list[str] = []

    for msg in messages or []:
        role = (msg.get("role") or "").strip()
        content = msg.get("content")

        if isinstance(content, list):
            text = "\n".join(
                str(p.get("text") or p.get("content") or "")
                for p in content
                if isinstance(p, dict)
            ).strip()
        elif content is None:
            text = ""
        else:
            text = str(content).strip()

        if not text:
            continue

        if role == "system":
            system_parts.append(text)
        elif role == "assistant":
            parts.append(f"Assistant: {text}")
        else:
            parts.append(f"Human: {text}")

    if system_parts:
        header = "[SYSTEM INSTRUCTIONS]\n" + "\n\n".join(system_parts) + "\n[/SYSTEM INSTRUCTIONS]\n"
    else:
        header = ""

    return header + "\n\n".join(parts) if parts else (header.strip() or "Hello")


def is_claude_subscription_base(url: str) -> bool:
    """True if the URL is the Claude Subscription sentinel."""
    return (url or "").strip().rstrip("/") == CLAUDE_SUBSCRIPTION_SENTINEL_URL.rstrip("/")


async def stream_completion(
    messages: List[Dict],
    model: Optional[str] = None,
    binary_hint: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Yield SSE-compatible chunks for a streaming completion.

    Yields the same SSE format as llm_core.stream_llm:
      - ``data: {"delta": "text"}`` for text chunks
      - ``event: error\\ndata: {"error": "...", "status": N}`` on failure
      - ``data: [DONE]`` at completion

    Args:
        messages:    OpenAI-style message list.
        model:       Ignored (Claude Code uses its configured default).
        binary_hint: Override path to the claude binary.
    """
    preflight = preflight_check(binary_hint)
    if not preflight["ok"]:
        error_msg = preflight["error"] + " — " + preflight.get("action", "")
        yield f'event: error\ndata: {json.dumps({"error": error_msg, "status": 503})}\n\n'
        return

    binary = preflight["binary"]
    prompt = _build_prompt(messages)
    env = _scrub_env()
    cmd = [binary] + _CLAUDE_FLAGS_STREAM

    logger.debug("claude-subscription: spawning %s", cmd)
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
    except Exception as exc:
        yield f'event: error\ndata: {json.dumps({"error": f"Failed to launch Claude Code: {exc}", "status": 503})}\n\n'
        return

    assert proc.stdin is not None
    assert proc.stdout is not None

    try:
        proc.stdin.write(prompt.encode("utf-8"))
        await proc.stdin.drain()
        proc.stdin.close()
    except Exception:
        pass

    try:
        async for raw_line in proc.stdout:
            line = raw_line.decode("utf-8", errors="replace").rstrip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            obj_type = obj.get("type")

            if obj_type == "stream_event":
                evt = obj.get("event") or {}
                if evt.get("type") == "content_block_delta":
                    delta_obj = evt.get("delta") or {}
                    if delta_obj.get("type") == "text_delta":
                        text = delta_obj.get("text") or ""
                        if text:
                            yield f'data: {json.dumps({"delta": text})}\n\n'

            elif obj_type == "result":
                if obj.get("is_error"):
                    api_status = obj.get("api_error_status") or 500
                    error_text = obj.get("result") or "Claude Subscription request failed"
                    yield f'event: error\ndata: {json.dumps({"error": error_text, "status": api_status})}\n\n'
                else:
                    yield "data: [DONE]\n\n"
                return

    except asyncio.CancelledError:
        try:
            proc.kill()
        except Exception:
            pass
        raise
    except Exception as exc:
        yield f'event: error\ndata: {json.dumps({"error": f"Claude Subscription stream error: {exc}", "status": 500})}\n\n'
    finally:
        try:
            await proc.wait()
        except Exception:
            pass


async def call_completion(
    messages: List[Dict],
    model: Optional[str] = None,
    binary_hint: Optional[str] = None,
) -> str:
    """Run a non-streaming completion and return the full response text.

    Args:
        messages:    OpenAI-style message list.
        model:       Ignored (Claude Code uses its configured default).
        binary_hint: Override path to the claude binary.

    Raises:
        ClaudeSubscriptionNotInstalled: binary not found.
        ClaudeSubscriptionNotLoggedIn: not authenticated.
        ClaudeSubscriptionError: other runtime failure.
    """
    preflight = preflight_check(binary_hint)
    if not preflight["ok"]:
        action = preflight.get("action", "")
        raise ClaudeSubscriptionError(f"{preflight['error']} {action}")

    binary = preflight["binary"]
    prompt = _build_prompt(messages)
    env = _scrub_env()
    cmd = [binary] + _CLAUDE_FLAGS_SYNC

    logger.debug("claude-subscription: spawning %s", cmd)
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, stderr = await proc.communicate(input=prompt.encode("utf-8"))
    except Exception as exc:
        raise ClaudeSubscriptionError(f"Failed to launch Claude Code: {exc}") from exc

    raw = stdout.decode("utf-8", errors="replace").strip()
    if not raw:
        err = stderr.decode("utf-8", errors="replace")[:300]
        raise ClaudeSubscriptionError(f"Claude Code produced no output. stderr: {err}")

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ClaudeSubscriptionError(f"Claude Code returned invalid JSON: {raw[:200]}") from exc

    if data.get("is_error"):
        result_text = data.get("result") or "Claude Subscription request failed"
        api_status = data.get("api_error_status")
        if api_status == 401:
            raise ClaudeSubscriptionError(
                "Claude Subscription credentials were rejected. Run `claude` to log in."
            )
        raise ClaudeSubscriptionError(result_text)

    return data.get("result") or ""
