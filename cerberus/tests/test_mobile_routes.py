"""Tests for /api/mobile/{summary,threads,thread/{id}/messages}.

Seven spec invariants:
  1. GET /api/mobile/summary returns all 5 keys.
  2. One sub-fetch failure → null for that key, others still present.
  3. GET /api/mobile/threads returns the documented shape.
  4. Preview is truncated at 100 characters.
  5. GET /api/mobile/thread/{id}/messages returns paginated rows.
  6. has_more=True when more messages exist.
  7. Unauthorised requests return 401.

Fast lane. Uses the file-backed NullPool engine pattern from
`tests/test_tasks_active_endpoint.py` so DB writes in the test are visible
to the route's `SessionLocal()` reads (the conftest's `:memory:` default
gives each connection its own DB and would invisibly mask seeds).
"""

import asyncio
import os
import sys
import tempfile
import uuid
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from tests.helpers.import_state import clear_fake_database_modules

clear_fake_database_modules()

import core.database as cdb
import routes.mobile_routes as mobile_routes
from core.database import (
    AgentMessage,
    AgentThread,
    CerberusAgent,
    utcnow_naive,
)


# ── Shared file-backed SQLite ──────────────────────────────────────────────

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)
mobile_routes.SessionLocal = _TS


# ── Helpers ────────────────────────────────────────────────────────────────

def _req(user="alice"):
    return SimpleNamespace(state=SimpleNamespace(current_user=user))


def _endpoint(method, path):
    """Pull the handler for a given (method, path) out of the router so we can
    invoke it as a plain Python function — avoids a TestClient + ASGI hop."""
    mobile_routes.SessionLocal = _TS
    router = mobile_routes.setup_mobile_routes()
    for route in router.routes:
        if (
            getattr(route, "path", None) == path
            and method in getattr(route, "methods", set())
        ):
            return route.endpoint
    raise RuntimeError(f"{method} {path} not registered")


def _seed_agent(*, agent_id, name, owner="alice", invocations=0):
    db = _TS()
    try:
        db.add(CerberusAgent(
            id=agent_id, name=name, owner=owner,
            role="custom", agent_type="general", status="active",
            avatar="🤖", invocation_count=invocations,
            system_prompt="", model_alias="sonnet",
        ))
        db.commit()
    finally:
        db.close()


def _seed_thread(*, thread_id, agent_id, owner="alice",
                  message_count=0, last_message_at=None):
    db = _TS()
    try:
        db.add(AgentThread(
            id=thread_id,
            agent_id=agent_id,
            owner=owner,
            message_count=message_count,
            last_message_at=last_message_at,
        ))
        db.commit()
    finally:
        db.close()


def _seed_message(*, message_id, thread_id, role, content, when=None):
    db = _TS()
    try:
        db.add(AgentMessage(
            id=message_id,
            thread_id=thread_id,
            role=role,
            content=content,
            timestamp=when or utcnow_naive(),
        ))
        db.commit()
    finally:
        db.close()


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    db = _TS()
    try:
        db.query(AgentMessage).delete()
        db.query(AgentThread).delete()
        db.query(CerberusAgent).delete()
        db.commit()
    finally:
        db.close()


# ───────────────────────────────────────────────────────────────────────────
# 1. summary returns all 5 keys
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_summary_returns_all_five_keys(monkeypatch):
    # Stub all sub-fetches so the test focuses on the response *shape*, not
    # whether profile/activity/etc. happen to be reachable from a unit test.
    monkeypatch.setattr(mobile_routes, "_fetch_profile",       _async_const({"name": "Alice"}))
    monkeypatch.setattr(mobile_routes, "_fetch_agents",        _async_const([]))
    monkeypatch.setattr(mobile_routes, "_fetch_activity",      _async_const({"days": 7}))
    monkeypatch.setattr(mobile_routes, "_fetch_pending_count", _async_const(0))
    monkeypatch.setattr(mobile_routes, "_fetch_gateway_status",
                        _async_const({"platforms": {}, "email_enabled": False}))

    fn = _endpoint("GET", "/api/mobile/summary")
    body = await fn(_req("alice"))

    assert set(body.keys()) == {
        "profile", "agents", "activity", "pending_approvals", "gateway_status",
    }
    assert body["profile"] == {"name": "Alice"}
    assert body["agents"] == []
    assert body["activity"] == {"days": 7}
    assert body["pending_approvals"] == 0
    assert body["gateway_status"] == {"platforms": {}, "email_enabled": False}


# ───────────────────────────────────────────────────────────────────────────
# 2. one sub-fetch failure → null for that key, others present
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_summary_failed_subfetch_yields_null(monkeypatch):
    # _fetch_profile is documented to swallow its own exceptions and return
    # None — simulate that contract here so the route's null-shape is what
    # the test exercises.
    monkeypatch.setattr(mobile_routes, "_fetch_profile",       _async_const(None))
    monkeypatch.setattr(mobile_routes, "_fetch_agents",        _async_const([{"id": "a1"}]))
    monkeypatch.setattr(mobile_routes, "_fetch_activity",      _async_const({"days": 7}))
    monkeypatch.setattr(mobile_routes, "_fetch_pending_count", _async_const(3))
    monkeypatch.setattr(mobile_routes, "_fetch_gateway_status",
                        _async_const({"platforms": {"discord": "configured"}, "email_enabled": True}))

    fn = _endpoint("GET", "/api/mobile/summary")
    body = await fn(_req("alice"))

    assert body["profile"] is None                          # failed sub-fetch
    assert body["agents"] == [{"id": "a1"}]                 # others unaffected
    assert body["activity"] == {"days": 7}
    assert body["pending_approvals"] == 3
    assert body["gateway_status"]["email_enabled"] is True


# ───────────────────────────────────────────────────────────────────────────
# 3. /threads response shape
# ───────────────────────────────────────────────────────────────────────────

def test_threads_shape_and_newest_first():
    # AgentThread has a unique (agent_id, owner) index — each test thread
    # needs its own agent.
    _seed_agent(agent_id="agent-A", name="Aurora")
    _seed_agent(agent_id="agent-B", name="Borealis")
    _seed_agent(agent_id="agent-C", name="Cassiopeia")

    # Threads with explicit last_message_at so the ordering is deterministic.
    now = datetime.utcnow()
    _seed_thread(thread_id="t-old",   agent_id="agent-A", message_count=2,
                  last_message_at=now - timedelta(hours=2))
    _seed_thread(thread_id="t-new",   agent_id="agent-B", message_count=5,
                  last_message_at=now - timedelta(minutes=5))
    _seed_thread(thread_id="t-empty", agent_id="agent-C", message_count=0,
                  last_message_at=None)

    _seed_message(message_id="m-1", thread_id="t-new", role="user",
                  content="hello there",
                  when=now - timedelta(minutes=6))
    _seed_message(message_id="m-2", thread_id="t-new", role="assistant",
                  content="general kenobi", when=now - timedelta(minutes=5))

    fn = _endpoint("GET", "/api/mobile/threads")
    body = fn(_req("alice"), agent_id=None, limit=20)

    assert "threads" in body
    threads = body["threads"]
    assert isinstance(threads, list)
    # Newest-first order: t-new before t-old before t-empty (NULL last)
    ids = [t["id"] for t in threads]
    assert ids[:2] == ["t-new", "t-old"]
    assert "t-empty" in ids

    new_row = next(t for t in threads if t["id"] == "t-new")
    assert set(new_row.keys()) == {
        "id", "title", "message_count", "last_message_at", "last_message_preview"
    }
    assert new_row["title"] == "Borealis"                    # agent's name
    assert new_row["message_count"] == 5
    assert new_row["last_message_at"].endswith("Z")
    assert new_row["last_message_preview"] == "general kenobi"


def test_threads_filters_by_agent_id_when_supplied():
    _seed_agent(agent_id="agent-A", name="Aurora")
    _seed_agent(agent_id="agent-B", name="Borealis")
    _seed_thread(thread_id="t-A", agent_id="agent-A")
    _seed_thread(thread_id="t-B", agent_id="agent-B")

    fn = _endpoint("GET", "/api/mobile/threads")
    body = fn(_req("alice"), agent_id="agent-A", limit=20)
    assert [t["id"] for t in body["threads"]] == ["t-A"]


# ───────────────────────────────────────────────────────────────────────────
# 4. preview truncated at 100 chars
# ───────────────────────────────────────────────────────────────────────────

def test_threads_preview_truncated_to_100_chars():
    _seed_agent(agent_id="agent-A", name="Aurora")
    _seed_thread(thread_id="t-huge", agent_id="agent-A",
                  last_message_at=datetime.utcnow())
    huge = "X" * 500
    _seed_message(message_id="m-huge", thread_id="t-huge", role="user",
                  content=huge)

    fn = _endpoint("GET", "/api/mobile/threads")
    body = fn(_req("alice"), agent_id=None, limit=20)
    row = next(t for t in body["threads"] if t["id"] == "t-huge")
    assert len(row["last_message_preview"]) == 100
    assert row["last_message_preview"] == "X" * 100


# ───────────────────────────────────────────────────────────────────────────
# 5. /thread/{id}/messages returns paginated results
# ───────────────────────────────────────────────────────────────────────────

def test_thread_messages_paginates_in_descending_order():
    _seed_agent(agent_id="agent-A", name="Aurora")
    _seed_thread(thread_id="t-1", agent_id="agent-A")

    now = datetime.utcnow()
    # Newest message last in seed-order — but the route returns newest first.
    for i in range(5):
        _seed_message(
            message_id=f"m-{i}",
            thread_id="t-1",
            role="user" if i % 2 == 0 else "assistant",
            content=f"message {i}",
            when=now - timedelta(minutes=5 - i),  # m-0 oldest, m-4 newest
        )

    fn = _endpoint("GET", "/api/mobile/thread/{thread_id}/messages")
    body = fn(_req("alice"), thread_id="t-1", limit=3, before=None)

    assert "messages" in body
    msgs = body["messages"]
    assert [m["id"] for m in msgs] == ["m-4", "m-3", "m-2"]   # newest-first
    assert all({"id", "role", "content", "timestamp"} <= set(m.keys()) for m in msgs)
    assert body["has_more"] is True
    assert body["next_before"] == "m-2"

    # Page 2 via the returned cursor — strictly older than m-2.
    body2 = fn(_req("alice"), thread_id="t-1", limit=3, before="m-2")
    assert [m["id"] for m in body2["messages"]] == ["m-1", "m-0"]
    assert body2["has_more"] is False
    assert body2["next_before"] is None


# ───────────────────────────────────────────────────────────────────────────
# 6. has_more=True when more messages exist
# ───────────────────────────────────────────────────────────────────────────

def test_thread_messages_has_more_flag():
    _seed_agent(agent_id="agent-A", name="Aurora")
    _seed_thread(thread_id="t-h", agent_id="agent-A")

    now = datetime.utcnow()
    for i in range(4):
        _seed_message(message_id=f"h-{i}", thread_id="t-h",
                      role="user", content=f"m{i}",
                      when=now - timedelta(minutes=4 - i))

    fn = _endpoint("GET", "/api/mobile/thread/{thread_id}/messages")

    # limit < total → has_more True, cursor surfaces
    body = fn(_req("alice"), thread_id="t-h", limit=2, before=None)
    assert body["has_more"] is True
    assert body["next_before"] is not None

    # limit == total → has_more False, no cursor
    body_all = fn(_req("alice"), thread_id="t-h", limit=4, before=None)
    assert body_all["has_more"] is False
    assert body_all["next_before"] is None

    # limit > total → still no more
    body_over = fn(_req("alice"), thread_id="t-h", limit=10, before=None)
    assert body_over["has_more"] is False
    assert body_over["next_before"] is None


# ───────────────────────────────────────────────────────────────────────────
# 7. Unauthorised → 401
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_summary_unauthorised_raises_401(monkeypatch):
    # Force the worst-case require_user path: auth IS configured AND no user
    # is present on the request → 401.
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.setenv("LOCALHOST_BYPASS", "false")

    fn = _endpoint("GET", "/api/mobile/summary")
    bare_req = _BareRequest()
    with pytest.raises(Exception) as ei:
        await fn(bare_req)
    assert getattr(ei.value, "status_code", None) == 401


def test_threads_unauthorised_raises_401(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.setenv("LOCALHOST_BYPASS", "false")

    fn = _endpoint("GET", "/api/mobile/threads")
    with pytest.raises(Exception) as ei:
        fn(_BareRequest(), agent_id=None, limit=20)
    assert getattr(ei.value, "status_code", None) == 401


def test_thread_messages_unauthorised_raises_401(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.setenv("LOCALHOST_BYPASS", "false")

    fn = _endpoint("GET", "/api/mobile/thread/{thread_id}/messages")
    with pytest.raises(Exception) as ei:
        fn(_BareRequest(), thread_id="missing", limit=50, before=None)
    assert getattr(ei.value, "status_code", None) == 401


def test_thread_messages_other_owners_thread_returns_404():
    # Owner-scope leak check — a foreign thread must NOT appear, and the
    # response code must not differentiate "doesn't exist" from "not yours"
    # (both 404) so existence isn't leaked.
    _seed_agent(agent_id="agent-A", name="Aurora", owner="bob")
    _seed_thread(thread_id="t-bob", agent_id="agent-A", owner="bob")
    fn = _endpoint("GET", "/api/mobile/thread/{thread_id}/messages")
    with pytest.raises(Exception) as ei:
        fn(_req("alice"), thread_id="t-bob", limit=50, before=None)
    assert getattr(ei.value, "status_code", None) == 404


# ── Helpers used by the tests above ──────────────────────────────────────

def _async_const(value):
    """An async function that ignores its arguments and returns `value`."""
    async def _f(*args, **kwargs):
        return value
    return _f


class _BareRequest:
    """A Request stub with no current_user — exercises the 401 path of
    `require_user`. `auth_manager.is_configured = True` forces the real
    function to raise instead of falling through to the loopback shim."""
    def __init__(self):
        self.state = SimpleNamespace()  # NO current_user attribute
        self.app = SimpleNamespace(state=SimpleNamespace(
            auth_manager=SimpleNamespace(is_configured=True),
        ))
        # require_user inspects request.client.host to decide loopback
        # short-circuits; a non-loopback host triggers the 401 branch.
        self.client = SimpleNamespace(host="10.0.0.42")
        self.headers = {}
