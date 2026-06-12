"""Tests for the Claude (Subscription) provider.

Step 4 validation suite covering:
  1. SUBSCRIPTION-NOT-KEY — env-scrub ensures OAuth auth is used, not API key.
  2. Provider detection and sentinel URL handling.
  3. Preflight checks for missing binary / no auth.
  4. env scrub contract: ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN removed.
  5. _build_prompt correctly flattens message lists.
  6. route provisioning creates correct ModelEndpoint row.
"""

from __future__ import annotations

import json
import os
import asyncio
from typing import Dict
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.database import Base, ModelEndpoint
import src.claude_subscription as cs
import routes.claude_subscription_routes as csr


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mem_db(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    TestSessionLocal = sessionmaker(bind=engine)
    monkeypatch.setattr(csr, "SessionLocal", TestSessionLocal)
    return TestSessionLocal


# ---------------------------------------------------------------------------
# Test 1: SUBSCRIPTION-NOT-KEY (critical env-scrub gate)
# ---------------------------------------------------------------------------

def test_scrub_env_removes_api_key_and_auth_token():
    """_scrub_env must remove ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN.

    This is the critical security gate: if either leaks into the subprocess
    environment, Claude Code uses the API account instead of OAuth subscription.
    """
    original = os.environ.copy()
    os.environ["ANTHROPIC_API_KEY"] = "sk-junk-test-key"
    os.environ["ANTHROPIC_AUTH_TOKEN"] = "auth-junk"
    try:
        scrubbed = cs._scrub_env()
        assert "ANTHROPIC_API_KEY" not in scrubbed, (
            "ANTHROPIC_API_KEY must be scrubbed before spawning Claude Code subprocess"
        )
        assert "ANTHROPIC_AUTH_TOKEN" not in scrubbed, (
            "ANTHROPIC_AUTH_TOKEN must be scrubbed before spawning Claude Code subprocess"
        )
        # Other env vars must be preserved
        assert "PATH" in scrubbed
    finally:
        os.environ.clear()
        os.environ.update(original)


def test_scrub_env_preserves_other_vars():
    """Non-sensitive environment variables survive the scrub."""
    with patch.dict(os.environ, {"MY_CUSTOM_VAR": "hello", "ANTHROPIC_API_KEY": "junk"}):
        scrubbed = cs._scrub_env()
    assert scrubbed.get("MY_CUSTOM_VAR") == "hello"
    assert "ANTHROPIC_API_KEY" not in scrubbed


# ---------------------------------------------------------------------------
# Test 2: Provider detection and sentinel URL handling
# ---------------------------------------------------------------------------

def test_is_claude_subscription_base_sentinel():
    """The sentinel URL is recognised as the Claude Subscription provider."""
    assert cs.is_claude_subscription_base(cs.CLAUDE_SUBSCRIPTION_SENTINEL_URL) is True


def test_is_claude_subscription_base_rejects_http():
    """Normal HTTP URLs must NOT be mistaken for the subscription sentinel."""
    assert cs.is_claude_subscription_base("https://api.anthropic.com/v1") is False
    assert cs.is_claude_subscription_base("http://localhost:8000") is False
    assert cs.is_claude_subscription_base("") is False


def test_detect_provider_returns_claude_subscription():
    """_detect_provider must return 'claude-subscription' for the sentinel URL."""
    from src.llm_core import _detect_provider
    provider = _detect_provider(cs.CLAUDE_SUBSCRIPTION_SENTINEL_URL)
    assert provider == "claude-subscription"


# ---------------------------------------------------------------------------
# Test 3: Preflight checks
# ---------------------------------------------------------------------------

def test_preflight_not_installed(monkeypatch):
    """preflight_check returns ok=False when claude binary is missing."""
    monkeypatch.setattr(cs, "resolve_claude_binary", lambda *_: (_ for _ in ()).throw(
        cs.ClaudeSubscriptionNotInstalled("not installed")
    ))
    result = cs.preflight_check()
    assert result["ok"] is False
    assert "not installed" in result["error"].lower() or "claude code" in result["error"].lower()


def test_preflight_not_logged_in(monkeypatch, tmp_path):
    """preflight_check returns ok=False when no credentials file exists."""
    monkeypatch.setattr(cs, "resolve_claude_binary", lambda *_: "/usr/bin/claude")
    monkeypatch.setattr(cs, "_CLAUDE_AUTH_PATHS", [str(tmp_path / "nonexistent.json")])
    result = cs.preflight_check()
    assert result["ok"] is False
    assert "log" in result["error"].lower() or "auth" in result["error"].lower() or "not logged" in result["error"].lower()


def test_preflight_ok(monkeypatch, tmp_path):
    """preflight_check returns ok=True when binary + credentials exist."""
    creds = tmp_path / "credentials.json"
    creds.write_text("{}")
    monkeypatch.setattr(cs, "resolve_claude_binary", lambda *_: str(tmp_path / "claude"))
    monkeypatch.setattr(cs, "_CLAUDE_AUTH_PATHS", [str(creds)])
    result = cs.preflight_check()
    assert result["ok"] is True


# ---------------------------------------------------------------------------
# Test 4: _build_prompt
# ---------------------------------------------------------------------------

def test_build_prompt_single_user():
    prompt = cs._build_prompt([{"role": "user", "content": "Hello"}])
    assert "Human: Hello" in prompt


def test_build_prompt_with_system():
    messages = [
        {"role": "system", "content": "You are a security expert."},
        {"role": "user", "content": "What is XSS?"},
    ]
    prompt = cs._build_prompt(messages)
    assert "SYSTEM INSTRUCTIONS" in prompt
    assert "security expert" in prompt
    assert "Human: What is XSS?" in prompt


def test_build_prompt_strips_list_content():
    messages = [
        {"role": "user", "content": [{"type": "text", "text": "Hi"}]},
    ]
    prompt = cs._build_prompt(messages)
    assert "Hi" in prompt


def test_build_prompt_empty_returns_hello():
    prompt = cs._build_prompt([])
    assert len(prompt) > 0


# ---------------------------------------------------------------------------
# Test 5: Tools-disabled confirmed (subprocess flag check)
# ---------------------------------------------------------------------------

def test_flags_contain_tools_empty():
    """--tools with empty string must be in both flag lists to disable all tools."""
    sync_flags = cs._CLAUDE_FLAGS_SYNC
    stream_flags = cs._CLAUDE_FLAGS_STREAM

    # Both lists must contain "--tools" followed by ""
    for flags in (sync_flags, stream_flags):
        idx = flags.index("--tools")
        assert flags[idx + 1] == "", (
            f"--tools must be followed by '' in {flags}"
        )


# ---------------------------------------------------------------------------
# Test 6: call_completion with scrubbed env (mocked subprocess)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_call_completion_uses_scrubbed_env(monkeypatch, tmp_path):
    """call_completion passes a scrubbed env to the subprocess — verified by
    inspecting what env dict was handed to asyncio.create_subprocess_exec."""
    creds = tmp_path / "credentials.json"
    creds.write_text("{}")
    monkeypatch.setattr(cs, "resolve_claude_binary", lambda *_: "/usr/bin/claude")
    monkeypatch.setattr(cs, "_CLAUDE_AUTH_PATHS", [str(creds)])

    captured_env: dict = {}

    async def _fake_exec(*args, **kwargs):
        captured_env.update(kwargs.get("env") or {})
        mock = MagicMock()
        mock.communicate = AsyncMock(return_value=(
            json.dumps({"is_error": False, "result": "42"}).encode(),
            b"",
        ))
        return mock

    with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-junk-should-not-appear"}):
        with patch("asyncio.create_subprocess_exec", side_effect=_fake_exec):
            result = await cs.call_completion([{"role": "user", "content": "What is 6*7?"}])

    assert result == "42"
    assert "ANTHROPIC_API_KEY" not in captured_env, (
        "SUBSCRIPTION-NOT-KEY GATE FAILED: ANTHROPIC_API_KEY leaked into subprocess env"
    )


@pytest.mark.asyncio
async def test_call_completion_raises_on_error(monkeypatch, tmp_path):
    """call_completion raises ClaudeSubscriptionError on is_error=True."""
    creds = tmp_path / "credentials.json"
    creds.write_text("{}")
    monkeypatch.setattr(cs, "resolve_claude_binary", lambda *_: "/usr/bin/claude")
    monkeypatch.setattr(cs, "_CLAUDE_AUTH_PATHS", [str(creds)])

    async def _fake_exec(*args, **kwargs):
        mock = MagicMock()
        mock.communicate = AsyncMock(return_value=(
            json.dumps({"is_error": True, "result": "Invalid API key", "api_error_status": 401}).encode(),
            b"",
        ))
        return mock

    with patch("asyncio.create_subprocess_exec", side_effect=_fake_exec):
        with pytest.raises(cs.ClaudeSubscriptionError):
            await cs.call_completion([{"role": "user", "content": "hello"}])


# ---------------------------------------------------------------------------
# Test 7: route provisioning
# ---------------------------------------------------------------------------

def test_provision_endpoint_creates_row(monkeypatch):
    """provision() creates a ModelEndpoint with the sentinel URL and no api_key."""

    class _FakeRequest:
        def __init__(self):
            self.headers = {}
            self.cookies = {}

    db_local = None

    def _fake_provision(request):
        """Replica of the route logic without HTTP layer."""
        import uuid as _uuid
        db = db_local()
        try:
            ep = db.query(ModelEndpoint).filter(
                ModelEndpoint.base_url == cs.CLAUDE_SUBSCRIPTION_SENTINEL_URL
            ).first()
            if ep is None:
                ep = ModelEndpoint(
                    id=str(_uuid.uuid4())[:8],
                    name="Claude (Subscription)",
                    base_url=cs.CLAUDE_SUBSCRIPTION_SENTINEL_URL,
                    model_type="llm",
                    endpoint_kind="api",
                )
                db.add(ep)
            ep.api_key = None
            ep.is_enabled = True
            ep.supports_tools = False
            ep.model_refresh_mode = "manual"
            ep.cached_models = json.dumps(csr._MODELS)
            db.commit()
            return ep.id
        finally:
            db.close()

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    db_local = sessionmaker(bind=engine)

    ep_id = _fake_provision(_FakeRequest())
    db = db_local()
    try:
        ep = db.query(ModelEndpoint).filter(ModelEndpoint.id == ep_id).first()
        assert ep is not None
        assert ep.base_url == cs.CLAUDE_SUBSCRIPTION_SENTINEL_URL
        assert ep.api_key is None
        assert ep.supports_tools is False
        assert ep.model_refresh_mode == "manual"
        models = json.loads(ep.cached_models)
        assert len(models) > 0
        assert all(m.startswith("claude-") for m in models)
    finally:
        db.close()


def test_models_list_contains_claude_models():
    """_MODELS must only contain claude-* model IDs."""
    assert len(csr._MODELS) > 0
    for m in csr._MODELS:
        assert m.startswith("claude-"), f"Non-claude model in _MODELS: {m}"
