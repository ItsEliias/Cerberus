"""Tests for agent health monitoring + reset endpoint.

Covers:
  1. health_status column exists on CerberusAgent.
  2. Error count increments on failed stream.
  3. health_status becomes "degraded" after 1 error.
  4. health_status becomes "error" after 3+ errors.
  5. Successful stream resets health_status to "ok".
  6. GET /api/agents/{id}/health returns all fields.
  7. POST /api/agents/{id}/reset-health clears error state.
  8. Health tracking failure never propagates to the send path.
"""

import sys
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

for _mod in [
    "sqlalchemy", "sqlalchemy.orm", "sqlalchemy.ext", "sqlalchemy.ext.declarative",
    "sqlalchemy.ext.hybrid", "sqlalchemy.sql", "sqlalchemy.sql.expression",
    "src.auth_helpers",
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()


# ─── 1. Column exists on the model ──────────────────────────────────────────

def test_cerberus_agent_has_health_columns():
    from core.database import CerberusAgent
    cols = {c.key for c in CerberusAgent.__table__.columns}
    expected = {"health_status", "last_error", "last_error_at", "error_count"}
    missing = expected - cols
    assert not missing, f"CerberusAgent missing columns: {missing}"
    hs = CerberusAgent.__table__.columns["health_status"]
    assert hs.nullable is False
    default = getattr(hs.default, "arg", hs.default)
    assert default == "ok"


# ─── Shared fake DB for _record_agent_health tests ──────────────────────────

class _FakeAgent:
    def __init__(self, **kw):
        self.id = kw.get("id", "agent-1")
        self.health_status = kw.get("health_status", "ok")
        self.last_error    = kw.get("last_error", None)
        self.last_error_at = kw.get("last_error_at", None)
        self.error_count   = kw.get("error_count", 0)


class _FakeDB:
    def __init__(self, agent=None):
        self.agent = agent
        self.committed = False
        self.closed = False

    def query(self, _model):
        outer = self
        class _Q:
            def filter(self, *_a, **_kw): return self
            def first(self): return outer.agent
        return _Q()

    def commit(self): self.committed = True
    def close(self): self.closed = True


# ─── 2. Error count increments on failed stream ────────────────────────────

def test_record_agent_health_increments_error_count_on_failure():
    from routes.cerberus_agent_thread_routes import _record_agent_health
    agent = _FakeAgent(error_count=0, health_status="ok")
    db = _FakeDB(agent=agent)
    with patch(
        "routes.cerberus_agent_thread_routes.SessionLocal",
        return_value=db,
    ):
        _record_agent_health("agent-1", success=False, error_msg="boom")
    assert agent.error_count == 1
    assert agent.last_error == "boom"
    assert agent.last_error_at is not None
    assert db.committed


# ─── 3. health_status becomes "degraded" after 1 error ─────────────────────

def test_record_agent_health_marks_degraded_after_first_error():
    from routes.cerberus_agent_thread_routes import _record_agent_health
    agent = _FakeAgent(error_count=0, health_status="ok")
    db = _FakeDB(agent=agent)
    with patch(
        "routes.cerberus_agent_thread_routes.SessionLocal",
        return_value=db,
    ):
        _record_agent_health("agent-1", success=False, error_msg="x")
    assert agent.health_status == "degraded"


def test_record_agent_health_stays_degraded_at_2_errors():
    from routes.cerberus_agent_thread_routes import _record_agent_health
    agent = _FakeAgent(error_count=1, health_status="degraded")
    db = _FakeDB(agent=agent)
    with patch(
        "routes.cerberus_agent_thread_routes.SessionLocal",
        return_value=db,
    ):
        _record_agent_health("agent-1", success=False, error_msg="x")
    assert agent.error_count == 2
    assert agent.health_status == "degraded"


# ─── 4. health_status becomes "error" at 3+ errors ─────────────────────────

def test_record_agent_health_marks_error_at_three_errors():
    from routes.cerberus_agent_thread_routes import _record_agent_health
    agent = _FakeAgent(error_count=2, health_status="degraded")
    db = _FakeDB(agent=agent)
    with patch(
        "routes.cerberus_agent_thread_routes.SessionLocal",
        return_value=db,
    ):
        _record_agent_health("agent-1", success=False, error_msg="x")
    assert agent.error_count == 3
    assert agent.health_status == "error"


# ─── 5. Successful stream resets health_status to "ok" ─────────────────────

def test_record_agent_health_success_clears_error_streak():
    from routes.cerberus_agent_thread_routes import _record_agent_health
    agent = _FakeAgent(
        error_count=5,
        health_status="error",
        last_error="prior failure",
        last_error_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db = _FakeDB(agent=agent)
    with patch(
        "routes.cerberus_agent_thread_routes.SessionLocal",
        return_value=db,
    ):
        _record_agent_health("agent-1", success=True)
    assert agent.health_status == "ok"
    assert agent.error_count == 0
    assert agent.last_error is None
    assert agent.last_error_at is None


# ─── 6. GET /api/agents/{id}/health returns all fields ─────────────────────

def test_get_agent_health_returns_all_documented_fields():
    from routes.cerberus_agent_routes import setup_cerberus_agent_routes
    router = setup_cerberus_agent_routes()
    fn = None
    for route in router.routes:
        if getattr(route, "path", None) == "/api/agents/{agent_id}/health" \
                and "GET" in getattr(route, "methods", set()):
            fn = route.endpoint
            break
    assert fn is not None, "GET /{agent_id}/health not registered"

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    agent = SimpleNamespace(
        id="a1", owner="alice",
        created_at=now,
        health_status="degraded",
        last_error="something exploded",
        last_error_at=now,
        error_count=2,
        invocation_count=7,
        last_active_at=now,
    )
    class _Q:
        def filter(self, *_a, **_kw): return self
        def first(self): return agent
    class _DB:
        def query(self, _m): return _Q()
        def close(self): pass

    req = SimpleNamespace(state=SimpleNamespace(current_user="alice"))
    with patch("routes.cerberus_agent_routes.SessionLocal", return_value=_DB()), \
         patch("routes.cerberus_agent_routes.require_user", return_value="alice"), \
         patch("routes.cerberus_agent_routes._get_agent_for_owner",
               return_value=agent):
        resp = fn("a1", req)

    required = {
        "health_status", "last_error", "last_error_at",
        "error_count", "invocation_count", "last_active_at", "uptime_hours",
    }
    missing = required - set(resp.keys())
    assert not missing, f"missing fields: {missing}"
    assert resp["health_status"] == "degraded"
    assert resp["error_count"] == 2
    assert resp["invocation_count"] == 7
    assert isinstance(resp["uptime_hours"], float)


# ─── 7. POST /api/agents/{id}/reset-health clears error state ─────────────

def test_reset_agent_health_clears_state():
    from routes.cerberus_agent_routes import setup_cerberus_agent_routes
    router = setup_cerberus_agent_routes()
    fn = None
    for route in router.routes:
        if getattr(route, "path", None) == "/api/agents/{agent_id}/reset-health" \
                and "POST" in getattr(route, "methods", set()):
            fn = route.endpoint
            break
    assert fn is not None, "POST /{agent_id}/reset-health not registered"

    agent = SimpleNamespace(
        id="a1", owner="alice",
        health_status="error",
        last_error="boom",
        last_error_at=datetime.now(timezone.utc).replace(tzinfo=None),
        error_count=5,
    )
    class _DB:
        def __init__(self): self.committed = False
        def commit(self): self.committed = True
        def close(self): pass

    db = _DB()
    req = SimpleNamespace(state=SimpleNamespace(current_user="alice"))
    with patch("routes.cerberus_agent_routes.SessionLocal", return_value=db), \
         patch("routes.cerberus_agent_routes.require_user", return_value="alice"), \
         patch("routes.cerberus_agent_routes._get_agent_for_owner",
               return_value=agent):
        resp = fn("a1", req)

    assert resp["health_status"] == "ok"
    assert resp["error_count"] == 0
    assert agent.health_status == "ok"
    assert agent.last_error is None
    assert agent.last_error_at is None
    assert agent.error_count == 0
    assert db.committed


# ─── 8. Health tracking failure never propagates to send path ─────────────

def test_record_agent_health_swallows_factory_failure(caplog):
    from routes.cerberus_agent_thread_routes import _record_agent_health
    with patch(
        "routes.cerberus_agent_thread_routes.SessionLocal",
        side_effect=RuntimeError("pool exhausted"),
    ):
        # Must NOT raise — the send path has finished by now.
        _record_agent_health("agent-1", success=False, error_msg="x")
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert any("_record_agent_health failed" in r.message for r in warnings)


def test_record_agent_health_swallows_commit_failure(caplog):
    from routes.cerberus_agent_thread_routes import _record_agent_health

    class _BoomDB(_FakeDB):
        def commit(self):
            raise RuntimeError("disk full")

    db = _BoomDB(agent=_FakeAgent())
    with patch(
        "routes.cerberus_agent_thread_routes.SessionLocal",
        return_value=db,
    ):
        _record_agent_health("agent-1", success=False, error_msg="x")
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert any("_record_agent_health failed" in r.message for r in warnings)


def test_record_agent_health_skips_empty_agent_id():
    """Empty agent_id is a no-op — never opens a DB session."""
    from routes.cerberus_agent_thread_routes import _record_agent_health
    with patch(
        "routes.cerberus_agent_thread_routes.SessionLocal",
        side_effect=AssertionError("should not open session"),
    ):
        _record_agent_health("", success=False, error_msg="x")
        _record_agent_health(None, success=True)


# ─── Bonus: error-chunk parser pulls the message out cleanly ───────────────

def test_extract_error_from_chunk_handles_json_payload():
    from routes.cerberus_agent_thread_routes import _extract_error_from_chunk
    chunk = 'event: error\ndata: {"error": "tool blocked", "status": 403}\n\n'
    assert _extract_error_from_chunk(chunk) == "tool blocked"


def test_extract_error_from_chunk_falls_back_to_raw():
    from routes.cerberus_agent_thread_routes import _extract_error_from_chunk
    chunk = 'event: error\ndata: literal-text\n\n'
    assert _extract_error_from_chunk(chunk) == "literal-text"


def test_extract_error_from_chunk_returns_empty_for_garbage():
    from routes.cerberus_agent_thread_routes import _extract_error_from_chunk
    assert _extract_error_from_chunk("") == ""
    assert _extract_error_from_chunk("just text, no SSE markers") == ""
