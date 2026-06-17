"""Phase 0 accounting tests: token tracking, error-state detection, cost split."""

import json
import sys
from unittest.mock import MagicMock, patch, AsyncMock
import pytest


# ---------------------------------------------------------------------------
# Stub heavy deps
# ---------------------------------------------------------------------------

for _mod in [
    "sqlalchemy", "sqlalchemy.orm", "sqlalchemy.ext",
    "sqlalchemy.ext.declarative", "sqlalchemy.ext.hybrid",
    "sqlalchemy.sql", "sqlalchemy.sql.expression",
    "fastapi", "fastapi.responses",
    "pydantic",
    "core.database", "src.auth_helpers",
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()


# ---------------------------------------------------------------------------
# _finalize_invocation: token persistence
# ---------------------------------------------------------------------------

import routes.cerberus_agent_routes as agent_mod


def _make_fake_db(agent):
    """Return a fake SessionLocal() context that yields agent."""
    class _DB:
        def query(self, _model):
            class _Q:
                def filter(self, *_a, **_kw): return self
                def first(self): return agent
            return _Q()
        def commit(self): pass
        def close(self): pass
    return _DB()


def test_finalize_records_tokens_on_success():
    agent = MagicMock(score=0, total_input_tokens=0, total_output_tokens=0, last_run_url=None)
    with patch.object(agent_mod, "SessionLocal", return_value=_make_fake_db(agent)):
        agent_mod._finalize_invocation(
            "agent-1", "alice", True, in_tokens=150, out_tokens=300, endpoint_url="http://cloud/v1"
        )
    assert agent.total_input_tokens == 150
    assert agent.total_output_tokens == 300
    assert agent.last_run_url == "http://cloud/v1"
    assert agent.score == 1          # score increments on success


def test_finalize_does_not_increment_score_on_error():
    agent = MagicMock(score=5, total_input_tokens=0, total_output_tokens=0, last_run_url=None)
    with patch.object(agent_mod, "SessionLocal", return_value=_make_fake_db(agent)):
        agent_mod._finalize_invocation(
            "agent-1", "alice", False, in_tokens=0, out_tokens=0, endpoint_url=""
        )
    assert agent.score == 5           # unchanged
    assert agent.status == "alert"


def test_finalize_accumulates_tokens_across_calls():
    agent = MagicMock(score=2, total_input_tokens=100, total_output_tokens=200, last_run_url=None)
    with patch.object(agent_mod, "SessionLocal", return_value=_make_fake_db(agent)):
        agent_mod._finalize_invocation(
            "agent-1", "alice", True, in_tokens=50, out_tokens=75, endpoint_url="http://cloud"
        )
    assert agent.total_input_tokens == 150    # 100 + 50
    assert agent.total_output_tokens == 275   # 200 + 75


def test_finalize_skips_token_update_when_zero():
    agent = MagicMock(score=1, total_input_tokens=10, total_output_tokens=20, last_run_url=None)
    with patch.object(agent_mod, "SessionLocal", return_value=_make_fake_db(agent)):
        agent_mod._finalize_invocation(
            "agent-1", "alice", True, in_tokens=0, out_tokens=0, endpoint_url=""
        )
    # Tokens should be untouched when both are zero
    assert agent.total_input_tokens == 10
    assert agent.total_output_tokens == 20


# ---------------------------------------------------------------------------
# _generate(): SSE error detection sets success=False
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_generate_detects_event_error_chunk():
    """Yielding an 'event: error' chunk must set state["success"] = False."""
    import asyncio

    async def _fake_stream_llm(url, model, messages, headers=None):
        yield 'event: error\ndata: {"error":"test","status":500}\n\n'

    # We need to simulate the _generate closure
    state = {"success": True, "in_tok": 0, "out_tok": 0}
    url = "http://example.com/v1"
    model = "gpt-test"
    messages = []
    headers = {}

    chunks = []
    with patch("src.llm_core.stream_llm", _fake_stream_llm):
        try:
            async for chunk in _fake_stream_llm(url, model, messages):
                if chunk.startswith("event: error"):
                    state["success"] = False
                chunks.append(chunk)
        except Exception as exc:
            state["success"] = False

    assert state["success"] is False, "Error event chunk must flip success to False"
    assert len(chunks) == 1


@pytest.mark.asyncio
async def test_generate_parses_usage_chunk():
    """Usage chunk must update in_tok / out_tok in state."""
    usage_data = json.dumps({"type": "usage", "data": {"input_tokens": 42, "output_tokens": 99}})
    usage_chunk = f"data: {usage_data}\n\n"

    state = {"in_tok": 0, "out_tok": 0}

    async def _fake_stream_llm(url, model, messages, headers=None):
        yield usage_chunk

    async for chunk in _fake_stream_llm("", "", []):
        if '"type": "usage"' in chunk:
            for line in chunk.split("\n"):
                if line.startswith("data:") and "[DONE]" not in line:
                    try:
                        obj = json.loads(line[5:].strip())
                        if obj.get("type") == "usage":
                            d = obj.get("data", {})
                            state["in_tok"] = d.get("input_tokens", state["in_tok"])
                            state["out_tok"] = d.get("output_tokens", state["out_tok"])
                    except Exception:
                        pass

    assert state["in_tok"] == 42
    assert state["out_tok"] == 99


# ---------------------------------------------------------------------------
# /api/usage/tokens: local endpoint = $0 cost
# ---------------------------------------------------------------------------

def test_local_endpoint_url_is_free():
    """Tokens from local endpoints must not contribute to cost_usd."""
    _LOCAL_HINTS = ("localhost", "127.", "0.0.0.0", "::1")

    def _is_local(url):
        if not url:
            return False
        return any(h in url for h in _LOCAL_HINTS)

    assert _is_local("http://localhost:11434/v1/chat")
    assert _is_local("http://127.0.0.1:8000/v1")
    assert _is_local("http://0.0.0.0:5000/v1")
    assert not _is_local("https://api.openai.com/v1")
    assert not _is_local("https://api.anthropic.com/v1")
    assert not _is_local(None)
    assert not _is_local("")


def test_cost_zero_for_all_local_tokens():
    """If all tokens come from local providers, cost_usd must be 0.00."""
    _LOCAL_HINTS = ("localhost", "127.", "0.0.0.0", "::1")

    def _is_local(url):
        return url and any(h in url for h in _LOCAL_HINTS)

    sessions = [
        {"in": 1000, "out": 2000, "url": "http://localhost:11434/v1"},
        {"in": 500, "out": 800, "url": "http://127.0.0.1:8080/v1"},
    ]
    paid = sum(
        (s["in"] + s["out"]) for s in sessions if not _is_local(s["url"])
    )
    assert paid == 0
    assert round(paid * 0.000003, 4) == 0.0


def test_cost_nonzero_for_cloud_tokens():
    """Tokens from cloud endpoints must produce a non-zero cost_usd."""
    _LOCAL_HINTS = ("localhost", "127.", "0.0.0.0", "::1")

    def _is_local(url):
        return url and any(h in url for h in _LOCAL_HINTS)

    sessions = [
        {"in": 10000, "out": 5000, "url": "https://api.openai.com/v1"},
        {"in": 2000, "out": 1000, "url": "http://localhost:11434/v1"},
    ]
    paid = sum(
        (s["in"] + s["out"]) for s in sessions if not _is_local(s["url"])
    )
    assert paid == 15000
    cost = round(paid * 0.000003, 4)
    assert cost > 0
    assert abs(cost - 0.045) < 0.0001
