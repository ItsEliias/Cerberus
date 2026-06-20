"""Tests for GET /api/agents/{id}/thread/export — Markdown thread download.

Covers the pure renderers (filename slug + markdown body) and the route
behaviour: response shape, content-type, ordering, context-trim comment
placement, empty-thread degradation, and the auth gate.
"""

import sys
from datetime import datetime
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

import routes.cerberus_agent_thread_routes as ctr
from routes.cerberus_agent_thread_routes import (
    _export_filename,
    _render_thread_markdown,
    setup_agent_thread_routes,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _msg(role: str, content: str, ts: str = "2026-06-20T10:00:00"):
    return SimpleNamespace(
        role=role,
        content=content,
        timestamp=datetime.fromisoformat(ts),
    )


def _agent(name: str = "CODER", aid: str = "agent-1", ctx_window=None):
    return SimpleNamespace(
        id=aid, name=name, owner="alice", context_window=ctx_window,
    )


def _endpoint(method: str, path: str):
    router = setup_agent_thread_routes()
    for route in router.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set()):
            return route.endpoint
    raise RuntimeError(f"{method} {path} not found")


def _request(owner: str = "alice"):
    return SimpleNamespace(state=SimpleNamespace(current_user=owner))


class _FakeQ:
    def __init__(self, row):
        self._row = row
    def filter(self, *_a, **_kw): return self
    def first(self): return self._row


class _FakeDB:
    def __init__(self, agent, thread):
        self.agent = agent
        self.thread = thread
        self.closed = False

    def query(self, model):
        # Route queries CerberusAgent first; _get_or_create_thread queries
        # AgentThread (and returns the existing row on .first()). Map the two
        # by their class name so we don't need real sqlalchemy here.
        name = getattr(model, "__name__", "")
        if name == "CerberusAgent":
            return _FakeQ(self.agent)
        return _FakeQ(self.thread)

    def add(self, _obj): pass
    def commit(self): pass
    def refresh(self, _obj): pass
    def close(self): self.closed = True


def _run_export(*, agent, thread, owner="alice", agent_id="agent-1",
                global_window=20):
    fn = _endpoint("GET", "/api/agents/{agent_id}/thread/export")
    db = _FakeDB(agent, thread)
    fake_settings = MagicMock()
    fake_settings.get_setting = MagicMock(return_value=global_window)
    with patch("routes.cerberus_agent_thread_routes.SessionLocal", return_value=db), \
         patch("routes.cerberus_agent_thread_routes.require_user", return_value=owner), \
         patch.dict(sys.modules, {"src.settings": fake_settings}):
        return fn(agent_id, _request(owner))


# ---------------------------------------------------------------------------
# 0. Pure helpers
# ---------------------------------------------------------------------------

def test_export_filename_slugs_safely():
    assert _export_filename("CODER").startswith("cerberus-coder-")
    assert _export_filename("Data Analyst").startswith("cerberus-data-analyst-")
    assert _export_filename("//???").startswith("cerberus-agent-")
    # Always ends in .md
    assert _export_filename("X").endswith(".md")


def test_render_markdown_header_and_ordering():
    a = _agent("CODER")
    msgs = [
        _msg("user", "first question", "2026-06-19T09:00:00"),
        _msg("assistant", "first answer", "2026-06-19T09:00:01"),
        _msg("user", "follow-up", "2026-06-19T09:01:00"),
    ]
    md = _render_thread_markdown(a, msgs, ctx_window=20)
    assert md.startswith("# CERBERUS // CODER")
    assert "3 messages" in md
    # Ordering: first question comes before the answer comes before the follow-up.
    assert md.index("first question") < md.index("first answer") < md.index("follow-up")
    # Role labelling.
    assert "**You**" in md
    assert "**CODER**" in md
    # No trim comment when thread fits the window.
    assert "not included in agent context" not in md


def test_render_markdown_inserts_trim_comment():
    a = _agent("CODER")
    msgs = [_msg("user", f"msg {i}", "2026-06-19T09:00:00") for i in range(25)]
    md = _render_thread_markdown(a, msgs, ctx_window=20)
    # 25 total, window 20 → 5 messages dropped.
    assert "<!-- 5 earlier messages not included in agent context -->" in md
    # Comment must sit ABOVE the first in-context message (index 5 = "msg 5").
    comment_pos = md.index("not included in agent context")
    msg5_pos = md.index("msg 5")
    msg4_pos = md.index("msg 4")
    assert msg4_pos < comment_pos < msg5_pos


def test_render_markdown_empty_thread_is_valid():
    a = _agent("CODER")
    md = _render_thread_markdown(a, [], ctx_window=20)
    # Header still present, message count is 0, no trim comment.
    assert "# CERBERUS // CODER" in md
    assert "0 messages" in md
    assert "not included" not in md
    # Trailing newline so the file isn't ragged.
    assert md.endswith("\n")


# ---------------------------------------------------------------------------
# 1-5. Route behaviour
# ---------------------------------------------------------------------------

def test_route_returns_200_with_markdown_content_type():
    agent = _agent("CODER")
    thread = SimpleNamespace(id="t1", messages=[
        _msg("user", "hello"),
        _msg("assistant", "hi back"),
    ])
    resp = _run_export(agent=agent, thread=thread)
    assert resp.status_code == 200
    assert resp.media_type.startswith("text/markdown")
    cd = resp.headers.get("content-disposition", "")
    assert cd.startswith("attachment;")
    assert "cerberus-coder-" in cd
    assert cd.endswith('.md"')


def test_route_includes_agent_name_in_header():
    agent = _agent("DATA-ANALYST")
    thread = SimpleNamespace(id="t1", messages=[_msg("user", "go")])
    resp = _run_export(agent=agent, thread=thread)
    body = resp.body.decode("utf-8")
    assert body.startswith("# CERBERUS // DATA-ANALYST")


def test_route_messages_in_chronological_order():
    agent = _agent()
    thread = SimpleNamespace(id="t1", messages=[
        _msg("user", "Q1", "2026-06-19T09:00:00"),
        _msg("assistant", "A1", "2026-06-19T09:00:05"),
        _msg("user", "Q2", "2026-06-19T09:01:00"),
        _msg("assistant", "A2", "2026-06-19T09:01:05"),
    ])
    body = _run_export(agent=agent, thread=thread).body.decode("utf-8")
    assert body.index("Q1") < body.index("A1") < body.index("Q2") < body.index("A2")


def test_route_inserts_trim_comment_when_exceeding_window():
    agent = _agent(ctx_window=3)
    thread = SimpleNamespace(id="t1", messages=[
        _msg("user", f"line-{i}", "2026-06-19T09:00:00") for i in range(7)
    ])
    body = _run_export(agent=agent, thread=thread).body.decode("utf-8")
    # 7 messages, window 3 → 4 dropped.
    assert "<!-- 4 earlier messages not included in agent context -->" in body


def test_route_empty_thread_renders_valid_markdown_not_500():
    agent = _agent("CODER")
    thread = SimpleNamespace(id="t1", messages=[])
    resp = _run_export(agent=agent, thread=thread)
    assert resp.status_code == 200
    body = resp.body.decode("utf-8")
    assert "# CERBERUS // CODER" in body
    assert "0 messages" in body


# ---------------------------------------------------------------------------
# 6. Unauthorised → 401 (propagated from require_user)
# ---------------------------------------------------------------------------

def test_route_unauthorised_returns_401():
    fn = _endpoint("GET", "/api/agents/{agent_id}/thread/export")
    with patch(
        "routes.cerberus_agent_thread_routes.require_user",
        side_effect=HTTPException(401, "Authentication required"),
    ):
        with pytest.raises(HTTPException) as exc:
            fn("agent-1", _request(None))
    assert exc.value.status_code == 401


def test_route_unknown_agent_returns_404():
    fn = _endpoint("GET", "/api/agents/{agent_id}/thread/export")
    db = _FakeDB(agent=None, thread=None)
    with patch("routes.cerberus_agent_thread_routes.SessionLocal", return_value=db), \
         patch("routes.cerberus_agent_thread_routes.require_user", return_value="alice"):
        with pytest.raises(HTTPException) as exc:
            fn("nope", _request("alice"))
    assert exc.value.status_code == 404
