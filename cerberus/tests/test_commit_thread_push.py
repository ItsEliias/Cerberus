"""Tests for the three new server-side features:

  1. POST /api/git/summarise               — feat 1
  2. POST /api/agents/{id}/thread/summarise — feat 7
  3. POST /api/mobile/push-token (+ GET/DELETE) + agent_approval push hook

All three are fast-lane; the LLM call + git subprocess are stubbed.
"""

import asyncio
import sys
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

# The git module pulls services.search → would otherwise require the real
# index. Stub only what we need.
import routes.git_routes as gr
from routes.git_routes import setup_git_routes, GitSummariseBody


# ─── Generic helpers ────────────────────────────────────────────────────────

def _request(owner: str = "alice"):
    return SimpleNamespace(state=SimpleNamespace(current_user=owner))


def _endpoint(router, method: str, path: str):
    for route in router.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set()):
            return route.endpoint
    raise RuntimeError(f"{method} {path} not found")


# ─── 1. POST /api/git/summarise (happy) ─────────────────────────────────────

@pytest.mark.asyncio
async def test_git_summarise_returns_note_id_and_summary(monkeypatch, tmp_path):
    # Pretend tmp_path is a git repo.
    (tmp_path / ".git").mkdir()
    monkeypatch.setattr(gr, "_validate_repo_path", lambda _p: str(tmp_path))

    async def _fake_git(args, cwd):
        # Returns (rc, stdout, stderr) for `git log` then `git diff --stat`.
        if args and args[0] == "log":
            return (0, "abc1234 add feature\ndef5678 fix bug", "")
        if args and args[0] == "diff":
            return (0, "src/x.py | 5 ++++-\n 1 file changed", "")
        return (0, "", "")
    monkeypatch.setattr(gr, "_git", _fake_git)

    async def _fake_llm(*_a, **_kw):
        return "- Added feature X\n- Fixed bug Y"
    monkeypatch.setattr(gr, "_summarise_with_llm", lambda owner, diff: _fake_llm())
    monkeypatch.setattr(gr, "_save_summary_note",
                        lambda owner, branch, summary: "note-123")

    router = setup_git_routes()
    fn = _endpoint(router, "POST", "/api/git/summarise")
    with patch("routes.git_routes.require_user", return_value="alice"):
        resp = await fn(_request("alice"), GitSummariseBody())
    assert resp["note_id"] == "note-123"
    assert isinstance(resp["summary"], str)


# ─── 2. git subprocess failure → 500 with clear error ──────────────────────

@pytest.mark.asyncio
async def test_git_summarise_subprocess_failure_returns_500(monkeypatch, tmp_path):
    (tmp_path / ".git").mkdir()
    monkeypatch.setattr(gr, "_validate_repo_path", lambda _p: str(tmp_path))

    async def _failing_git(_args, cwd):
        # Both the primary log call AND the fallback log call return rc != 0.
        return (128, "", "fatal: not a git repository")
    monkeypatch.setattr(gr, "_git", _failing_git)

    router = setup_git_routes()
    fn = _endpoint(router, "POST", "/api/git/summarise")
    with patch("routes.git_routes.require_user", return_value="alice"):
        with pytest.raises(HTTPException) as exc:
            await fn(_request("alice"), GitSummariseBody())
    assert exc.value.status_code == 500
    assert "git log" in str(exc.value.detail)


# ─── 3. POST /thread/summarise — saves note + returns summary ──────────────

@pytest.mark.asyncio
async def test_thread_summarise_saves_note_and_returns_summary(monkeypatch):
    # Stub the SQLAlchemy chain to return an agent + thread with 2 messages.
    class _Msg:
        def __init__(self, role, content):
            self.role = role
            self.content = content
    agent = SimpleNamespace(
        id="a1", name="CODER", owner="alice", context_window=None,
    )
    thread = SimpleNamespace(
        id="t1", messages=[
            _Msg("user",      "How should we do X?"),
            _Msg("assistant", "We should do Y."),
        ],
    )

    class _Q:
        def __init__(self, row): self._row = row
        def filter(self, *_a, **_kw): return self
        def first(self): return self._row

    class _DB:
        def __init__(self):
            self.added = []
            self.committed = False
        def query(self, model):
            name = getattr(model, "__name__", "")
            if "CerberusAgent" in name: return _Q(agent)
            if "AgentThread"   in name: return _Q(thread)
            return _Q(None)
        def add(self, obj): self.added.append(obj)
        def commit(self): self.committed = True
        def refresh(self, _obj): pass
        def close(self): pass

    # Stub the LLM helper inline so we don't need a real endpoint.
    fake_llm = MagicMock()
    async def _fake_llm_async(*_a, **_kw):
        return "- decision X made\n- action Y next"
    fake_llm.llm_call_async = _fake_llm_async
    monkeypatch.setitem(sys.modules, "src.llm_core", fake_llm)

    fake_resolver = MagicMock()
    fake_resolver.resolve_endpoint = lambda *_a, **_kw: ("http://llm", "m", {})
    monkeypatch.setitem(sys.modules, "src.endpoint_resolver", fake_resolver)

    import routes.cerberus_agent_thread_routes as ctr
    monkeypatch.setattr(
        ctr, "_get_or_create_thread", lambda db, aid, owner: thread,
    )

    router = ctr.setup_agent_thread_routes()
    fn = _endpoint(router, "POST", "/api/agents/{agent_id}/thread/summarise")

    db = _DB()
    with patch("routes.cerberus_agent_thread_routes.SessionLocal", return_value=db), \
         patch("routes.cerberus_agent_thread_routes.require_user", return_value="alice"):
        resp = await fn("a1", _request("alice"))
    assert "summary" in resp
    assert resp["summary"].startswith("- decision X made")
    # The note row was added.
    assert any(o.__class__.__name__ == "Note" for o in db.added)
    assert resp["note_id"] is not None


# ─── 4. Empty thread → graceful "nothing to summarise" ─────────────────────

@pytest.mark.asyncio
async def test_thread_summarise_empty_thread_returns_friendly_message(monkeypatch):
    agent = SimpleNamespace(
        id="a1", name="CODER", owner="alice", context_window=None,
    )
    thread = SimpleNamespace(id="t1", messages=[])

    class _Q:
        def __init__(self, row): self._row = row
        def filter(self, *_a, **_kw): return self
        def first(self): return self._row
    class _DB:
        def query(self, model):
            name = getattr(model, "__name__", "")
            if "CerberusAgent" in name: return _Q(agent)
            if "AgentThread"   in name: return _Q(thread)
            return _Q(None)
        def add(self, obj): pass
        def commit(self): pass
        def close(self): pass

    import routes.cerberus_agent_thread_routes as ctr
    monkeypatch.setattr(
        ctr, "_get_or_create_thread", lambda db, aid, owner: thread,
    )

    router = ctr.setup_agent_thread_routes()
    fn = _endpoint(router, "POST", "/api/agents/{agent_id}/thread/summarise")
    with patch("routes.cerberus_agent_thread_routes.SessionLocal", return_value=_DB()), \
         patch("routes.cerberus_agent_thread_routes.require_user", return_value="alice"):
        resp = await fn("a1", _request("alice"))
    assert resp["note_id"] is None
    assert "nothing" in resp["summary"].lower()


# ─── 5. POST /api/mobile/push-token creates a row ─────────────────────────

def test_push_token_create_persists_row(monkeypatch):
    rows = []
    class _Q:
        def __init__(self): pass
        def filter(self, *_a, **_kw): return self
        def first(self): return None  # no existing → insert path
    class _DB:
        def query(self, _model): return _Q()
        def add(self, obj): rows.append(obj)
        def commit(self): pass
        def refresh(self, obj):
            from datetime import datetime
            if not getattr(obj, "created_at", None):
                obj.created_at = datetime.utcnow()
        def close(self): pass

    import routes.mobile_routes as mr
    from routes.mobile_routes import setup_mobile_routes, PushTokenBody
    router = setup_mobile_routes()
    fn = _endpoint(router, "POST", "/api/mobile/push-token")
    body = PushTokenBody(token="t-real-fcm-token", platform="android", device_id="dev-1")
    with patch("routes.mobile_routes.SessionLocal", return_value=_DB()), \
         patch("routes.mobile_routes.require_user", return_value="alice"):
        resp = fn(_request("alice"), body)
    assert resp["device_id"] == "dev-1"
    assert resp["updated"] is False
    assert len(rows) == 1
    assert rows[0].owner == "alice"


def test_push_token_rejects_bad_platform(monkeypatch):
    from routes.mobile_routes import setup_mobile_routes, PushTokenBody
    router = setup_mobile_routes()
    fn = _endpoint(router, "POST", "/api/mobile/push-token")
    body = PushTokenBody(token="t", platform="webos", device_id="d")
    with patch("routes.mobile_routes.require_user", return_value="alice"):
        with pytest.raises(HTTPException) as exc:
            fn(_request("alice"), body)
    assert exc.value.status_code == 400


# ─── 6. Upsert updates existing token by device_id ─────────────────────────

def test_push_token_upsert_updates_existing_by_device_id(monkeypatch):
    existing = SimpleNamespace(
        id="id1", owner="alice", token="OLD-TOKEN",
        platform="android", device_id="dev-1",
        created_at=None, last_seen_at=None,
    )
    class _Q:
        def filter(self, *_a, **_kw): return self
        def first(self): return existing
    class _DB:
        def query(self, _model): return _Q()
        def add(self, obj): raise AssertionError("upsert must not insert a new row")
        def commit(self): pass
        def refresh(self, _o): pass
        def close(self): pass

    from routes.mobile_routes import setup_mobile_routes, PushTokenBody
    router = setup_mobile_routes()
    fn = _endpoint(router, "POST", "/api/mobile/push-token")
    body = PushTokenBody(token="NEW-TOKEN", platform="android", device_id="dev-1")
    with patch("routes.mobile_routes.SessionLocal", return_value=_DB()), \
         patch("routes.mobile_routes.require_user", return_value="alice"):
        resp = fn(_request("alice"), body)
    assert resp["updated"] is True
    assert existing.token == "NEW-TOKEN"
    assert existing.last_seen_at is not None


# ─── 7. GET /api/mobile/push-tokens never returns raw tokens ──────────────

def test_push_tokens_list_omits_raw_token(monkeypatch):
    from datetime import datetime
    row = SimpleNamespace(
        id="id1", owner="alice", token="SECRET-FCM-TOKEN",
        platform="android", device_id="dev-1",
        last_seen_at=datetime.utcnow(),
    )
    class _Q:
        def filter(self, *_a, **_kw): return self
        def order_by(self, *_a, **_kw): return self
        def all(self): return [row]
    class _DB:
        def query(self, _model): return _Q()
        def close(self): pass

    from routes.mobile_routes import setup_mobile_routes
    router = setup_mobile_routes()
    fn = _endpoint(router, "GET", "/api/mobile/push-tokens")
    with patch("routes.mobile_routes.SessionLocal", return_value=_DB()), \
         patch("routes.mobile_routes.require_user", return_value="alice"):
        resp = fn(_request("alice"))
    assert resp["tokens"], "expected at least one token row"
    for t in resp["tokens"]:
        assert "token" not in t, f"raw token leaked in response: {t}"
        assert t["device_id"] == "dev-1"
        assert t["platform"] == "android"


# ─── 8. send_push_notification logs without raising ────────────────────────

def test_send_push_notification_logs_without_raising(monkeypatch, caplog):
    import logging
    from src.push_notifications import send_push_notification
    # Stub the token lookup so we don't need a real DB.
    import src.push_notifications as pn
    monkeypatch.setattr(pn, "_list_tokens", lambda owner: [
        {"token": "t1", "platform": "android", "device_id": "d1"},
        {"token": "t2", "platform": "ios",     "device_id": "d2"},
    ])
    caplog.set_level(logging.INFO, logger="src.push_notifications")
    sent = send_push_notification(
        "alice", "Hello", "Body here", data={"k": "v"},
    )
    assert sent == 2
    infos = [r for r in caplog.records if r.levelname == "INFO"]
    assert any("PUSH" in r.message for r in infos)


def test_send_push_notification_swallows_lookup_failure(monkeypatch, caplog):
    from src.push_notifications import send_push_notification
    import src.push_notifications as pn

    def _broken_list(_owner):
        raise RuntimeError("db down")
    # _list_tokens swallows internally, so simulate failure inside the
    # main fan-out instead.
    monkeypatch.setattr(pn, "_list_tokens", _broken_list)
    # Must not raise.
    sent = send_push_notification("alice", "T", "B")
    assert sent == 0


# ─── 9. Gateway approval store triggers push notification ─────────────────

def test_agent_approval_triggers_push(monkeypatch):
    """store_pending must invoke the per-approval notification helper.

    Patches the helper directly (the inner _notify_owner_of_pending_approval
    swallows ALL exceptions to keep the approval store write resilient — so
    a missing DB or push module would silently no-op without this patch)."""
    import src.agent_approval as aa

    seen = []
    def _spy(agent_id, tool_name, preview):
        seen.append({"agent_id": agent_id, "tool_name": tool_name, "preview": preview})
    monkeypatch.setattr(aa, "_notify_owner_of_pending_approval", _spy)

    aa.store_pending(
        agent_id="agent-1", thread_id="t1",
        tool_name="write_file", tool_args={"content": "hi"},
        preview="/tmp/x.txt\nhello",
    )
    assert seen, "_notify_owner_of_pending_approval was not called"
    assert seen[0]["agent_id"] == "agent-1"
    assert seen[0]["tool_name"] == "write_file"
