"""Tests for the gateway approval UI flow.

Covers the six invariants the CC GATEWAY tab depends on to render and act
on approval cards:
  1. GET /api/gateway/approvals returns 200 with a 'pending' list.
  2. Empty store -> {"pending": []}.
  3. PATCH /api/gateway/approve/{request_id} returns 200 and marks the entry
     'executed'.
  4. DELETE /api/gateway/approve/{request_id} returns 200 and marks the entry
     'rejected'.
  5. Unknown request_id returns 404 on both endpoints.
  6. Each pending card payload from GET /api/gateway/approvals carries the
     request_id + tool + preview the frontend renders.

Fast lane (no @pytest.mark.slow). Uses FastAPI TestClient against a
disposable app with require_user patched to a no-op. Tool execution is
stubbed (execute_tool_block) so the approve path doesn't run real tools.
"""

import json
import os
import sys
import uuid

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI
from fastapi.testclient import TestClient

import src.agent_approval as aa
import routes.gateway_status_routes as gw_status
import routes.cerberus_agent_thread_routes as gw_approve

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_approval_store():
    """Start every test with a clean approval store. The store is module-level
    in agent_approval; previous tests in the same process could otherwise
    leak pending/executed entries into the next assertion."""
    aa._store.clear()
    yield
    aa._store.clear()


class _FakeRow:
    """Duck-typed enough to satisfy `_verify_gateway_pending` — must carry
    `is_gateway` (truthy) and `owner` (matching the caller)."""
    def __init__(self, session_id):
        self.id = session_id
        self.is_gateway = True
        self.owner = "owner"


class _FakeQuery:
    def __init__(self, session_id):
        self._sid = session_id
    def filter(self, *args, **kwargs):
        return self
    def first(self):
        return _FakeRow(self._sid)


class _FakeDbSession:
    """Returned by the patched `SessionLocal`. The verify closure calls
    `db.query(DbSession).filter(...).first()` then `db.close()` — we mimic
    that surface only."""
    def __init__(self, session_id):
        self._sid = session_id
    def query(self, _model):
        return _FakeQuery(self._sid)
    def close(self):
        pass


@pytest.fixture
def gateway_session(monkeypatch):
    """Patch the routes module's `SessionLocal` so the approve endpoint's
    `_verify_gateway_pending` closure sees a fake gateway-owned Session row
    instead of querying the (per-connection :memory:) DB. The conftest's
    :memory: default means rows inserted via SessionLocal() in a test are
    invisible to a separate SessionLocal() in the route — patching is the
    surgical alternative."""
    sid = "gw-sess-" + uuid.uuid4().hex[:8]
    monkeypatch.setattr(
        gw_approve, "SessionLocal", lambda: _FakeDbSession(sid)
    )
    yield sid


@pytest.fixture
def approvals_client(monkeypatch):
    """Disposable app with just the gateway-status router. require_user is
    a no-op. Environment vars are stripped so /status (used as a smoke
    check elsewhere) starts from a known baseline."""
    monkeypatch.setattr(gw_status, "require_user", lambda req: "owner")
    for key in ("DISCORD_BOT_TOKEN", "TELEGRAM_BOT_TOKEN", "SLACK_BOT_TOKEN",
                "GATEWAY_EMAIL_ALLOWLIST"):
        monkeypatch.delenv(key, raising=False)
    app = FastAPI()
    app.include_router(gw_status.setup_gateway_status_routes())
    return TestClient(app)


@pytest.fixture
def approve_client(monkeypatch):
    """Disposable app exposing PATCH/DELETE /api/gateway/approve/{id}. Tool
    execution and the rate-limit / email allowlist guards are stubbed so
    the test focuses on the request_id → status transition.

    The owner-scope guard (`_verify_gateway_pending`) is a closure inside
    `setup_gateway_approval_routes`, so it can't be patched directly; the
    gateway_session fixture provides a real DB row that satisfies it.
    """
    monkeypatch.setattr(gw_approve, "require_user", lambda req: "owner")
    monkeypatch.setattr(gw_approve, "_enforce_email_recipient_allowlist", lambda entry: None)
    monkeypatch.setattr(gw_approve, "_enforce_gateway_rate_limit", lambda entry: None)

    # Tool execution is unsafe in unit tests — return a fake result.
    async def _fake_exec(block, session_id=None, owner=None, **kwargs):
        return ("fake-desc", {"ok": True})

    # The route imports execute_tool_block lazily inside the handler:
    # `from src.agent_tools import execute_tool_block, ToolBlock`. Patch
    # the symbol on src.agent_tools so that lazy import picks it up.
    import src.agent_tools as _at
    monkeypatch.setattr(_at, "execute_tool_block", _fake_exec, raising=False)

    app = FastAPI()
    app.include_router(gw_approve.setup_gateway_approval_routes())
    return TestClient(app)


def _store_gateway_pending(thread_id, tool="manage_calendar", preview="create_event title=Standup"):
    """Stash a gateway-style pending entry (agent_id='') and return its id."""
    return aa.store_pending(
        agent_id="",
        thread_id=thread_id,
        tool_name=tool,
        tool_args={"content": json.dumps({"action": "create_event", "title": "Standup"})},
        preview=preview,
    )


# ---------------------------------------------------------------------------
# 1. GET /api/gateway/approvals returns 200 with pending list
# ---------------------------------------------------------------------------

def test_approvals_endpoint_returns_pending_list(approvals_client, gateway_session):
    rid_a = _store_gateway_pending(gateway_session, tool="mcp__email__send_email", preview="to=alice@x")
    rid_b = _store_gateway_pending(gateway_session, tool="manage_calendar", preview="create_event title=Standup")

    r = approvals_client.get("/api/gateway/approvals")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "pending" in body
    assert isinstance(body["pending"], list)
    assert len(body["pending"]) == 2

    rids = {p["request_id"] for p in body["pending"]}
    assert rids == {rid_a, rid_b}


# ---------------------------------------------------------------------------
# 2. Empty store returns {"pending": []}
# ---------------------------------------------------------------------------

def test_approvals_endpoint_empty_when_no_pending(approvals_client):
    r = approvals_client.get("/api/gateway/approvals")
    assert r.status_code == 200, r.text
    assert r.json() == {"pending": []}


def test_approvals_endpoint_excludes_executed_and_rejected(approvals_client, gateway_session):
    # Mixed states — only 'pending' should surface
    rid_keep = _store_gateway_pending(gateway_session, tool="manage_calendar")
    rid_exec = _store_gateway_pending(gateway_session, tool="manage_calendar")
    rid_rej  = _store_gateway_pending(gateway_session, tool="manage_calendar")
    aa.approve(rid_exec)
    aa.set_result(rid_exec, {"ok": True})  # → status='executed'
    aa.reject(rid_rej)                     # → status='rejected'

    body = approvals_client.get("/api/gateway/approvals").json()
    rids = {p["request_id"] for p in body["pending"]}
    assert rids == {rid_keep}


# ---------------------------------------------------------------------------
# 3. PATCH approve returns 200 and marks entry executed
# ---------------------------------------------------------------------------

def test_patch_approve_marks_entry_executed(approve_client, gateway_session):
    rid = _store_gateway_pending(gateway_session, tool="manage_calendar")
    r = approve_client.patch(f"/api/gateway/approve/{rid}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("approved") is True
    assert body.get("request_id") == rid
    # Store transitioned through approve -> set_result -> executed
    entry = aa.get_pending(rid)
    assert entry is not None
    assert entry["status"] == "executed"
    assert entry["result"] == {"desc": "fake-desc", "result": {"ok": True}}


# ---------------------------------------------------------------------------
# 4. DELETE reject returns 200 and marks entry rejected
# ---------------------------------------------------------------------------

def test_delete_reject_marks_entry_rejected(approve_client, gateway_session):
    rid = _store_gateway_pending(gateway_session, tool="manage_calendar")
    r = approve_client.delete(f"/api/gateway/approve/{rid}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("rejected") is True
    assert body.get("request_id") == rid
    entry = aa.get_pending(rid)
    assert entry is not None
    assert entry["status"] == "rejected"


# ---------------------------------------------------------------------------
# 5. Unknown request_id returns 404 on both endpoints
# ---------------------------------------------------------------------------

def test_patch_unknown_request_id_returns_404(approve_client):
    r = approve_client.patch(f"/api/gateway/approve/{uuid.uuid4()}")
    assert r.status_code == 404


def test_delete_unknown_request_id_returns_404(approve_client):
    r = approve_client.delete(f"/api/gateway/approve/{uuid.uuid4()}")
    assert r.status_code == 404


def test_patch_after_reject_returns_404(approve_client, gateway_session):
    """Approve on an already-rejected entry must 404 — defense-in-depth
    against a double-click race in the UI."""
    rid = _store_gateway_pending(gateway_session, tool="manage_calendar")
    aa.reject(rid)  # already decided
    r = approve_client.patch(f"/api/gateway/approve/{rid}")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# 6. Card payload carries the fields the frontend renders
# ---------------------------------------------------------------------------

def test_pending_entries_carry_card_fields(approvals_client, gateway_session):
    rid = _store_gateway_pending(
        gateway_session,
        tool="mcp__email__send_email",
        preview="to=alice@example.com; subject=Hello",
    )
    body = approvals_client.get("/api/gateway/approvals").json()
    assert len(body["pending"]) == 1
    card = body["pending"][0]
    # request_id + tool + preview + created_at — exactly what _buildApprovalCard
    # in gateway.js renders.
    assert card["request_id"] == rid
    assert card["tool"] == "mcp__email__send_email"
    assert card["preview"] == "to=alice@example.com; subject=Hello"
    assert isinstance(card["created_at"], str)
    assert card["created_at"].endswith("Z")  # ISO UTC


def test_pending_preview_truncated_to_400_chars(approvals_client, gateway_session):
    # store_pending caps preview at 2000 chars; the route serialiser caps
    # again at 400 with a trailing ellipsis so a runaway preview can't blow
    # up the JSON body.
    huge = "X" * 800
    rid = aa.store_pending(
        agent_id="",
        thread_id=gateway_session,
        tool_name="manage_calendar",
        tool_args={"content": "{}"},
        preview=huge,
    )
    card = approvals_client.get("/api/gateway/approvals").json()["pending"][0]
    assert card["request_id"] == rid
    assert len(card["preview"]) <= 401  # 400 chars + ellipsis
    assert card["preview"].endswith("…")
