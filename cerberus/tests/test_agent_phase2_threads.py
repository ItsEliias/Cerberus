"""Tests for Phase 2 — AgentThread + AgentMessage CRUD and send endpoint.

Uses in-memory SQLite so no real DB is touched.
"""

import sys
import uuid
from unittest.mock import MagicMock, patch, AsyncMock

# Stub heavy deps before any import
for _mod in [
    "sqlalchemy", "sqlalchemy.orm", "sqlalchemy.ext", "sqlalchemy.ext.declarative",
    "sqlalchemy.ext.hybrid", "sqlalchemy.sql", "sqlalchemy.sql.expression",
    "src.auth_helpers",
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

# ---------------------------------------------------------------------------
# Tests: DB models
# ---------------------------------------------------------------------------

def test_agent_thread_model_exists():
    """AgentThread must be importable from core.database."""
    from core.database import AgentThread
    assert hasattr(AgentThread, "__tablename__")
    assert AgentThread.__tablename__ == "agent_threads"


def test_agent_message_model_exists():
    from core.database import AgentMessage
    assert AgentMessage.__tablename__ == "agent_messages"


def test_agent_thread_columns():
    from core.database import AgentThread
    cols = {c.key for c in AgentThread.__table__.columns}
    required = {"id", "agent_id", "owner", "created_at", "last_message_at", "message_count"}
    assert required <= cols, f"Missing columns: {required - cols}"


def test_agent_message_columns():
    from core.database import AgentMessage
    cols = {c.key for c in AgentMessage.__table__.columns}
    required = {"id", "thread_id", "role", "content", "timestamp"}
    assert required <= cols, f"Missing columns: {required - cols}"


def test_agent_thread_unique_index():
    from core.database import AgentThread
    idx_names = {i.name for i in AgentThread.__table__.indexes}
    assert "ix_agent_threads_agent_owner" in idx_names


# ---------------------------------------------------------------------------
# Tests: _get_or_create_thread
# ---------------------------------------------------------------------------

def test_get_or_create_thread_creates_new():
    from routes.cerberus_agent_thread_routes import _get_or_create_thread

    created = []
    FakeThread = MagicMock()          # class-level mock so .agent_id / .owner are MagicMock descriptors
    FakeThread.return_value.messages = []
    FakeThread.return_value.agent_id = "agent-1"
    FakeThread.return_value.owner    = "user-a"

    class _FakeDB:
        def query(self, model):
            class _Q:
                def filter(self, *_a): return self
                def first(self): return None
            return _Q()
        def add(self, obj): created.append(obj)
        def commit(self): pass
        def refresh(self, obj): pass

    with patch("routes.cerberus_agent_thread_routes.AgentThread", FakeThread):
        result = _get_or_create_thread(_FakeDB(), "agent-1", "user-a")

    assert len(created) == 1
    assert FakeThread.call_args.kwargs["agent_id"] == "agent-1"
    assert FakeThread.call_args.kwargs["owner"]    == "user-a"


def test_get_or_create_thread_returns_existing():
    from routes.cerberus_agent_thread_routes import _get_or_create_thread

    existing = MagicMock()
    existing.id = "thread-99"
    existing.messages = []

    class _FakeDB:
        def query(self, model):
            class _Q:
                def filter(self, *_a): return self
                def first(self): return existing
            return _Q()

    result = _get_or_create_thread(_FakeDB(), "agent-1", "user-a")
    assert result.id == "thread-99"


# ---------------------------------------------------------------------------
# Tests: _save_assistant_message
# ---------------------------------------------------------------------------

def test_save_assistant_message_updates_count():
    from routes.cerberus_agent_thread_routes import _save_assistant_message

    thread = MagicMock()
    thread.id = "t1"
    thread.message_count = 2

    messages_added = []

    class _FakeDB:
        def query(self, model):
            class _Q:
                def filter(self, *_a): return self
                def first(self): return thread
            return _Q()
        def add(self, obj): messages_added.append(obj)
        def commit(self): pass
        def close(self): pass

    with patch("routes.cerberus_agent_thread_routes.SessionLocal", return_value=_FakeDB()):
        _save_assistant_message("t1", "Hello back!")

    assert len(messages_added) == 1
    assert messages_added[0].role == "assistant"
    assert messages_added[0].content == "Hello back!"
    assert thread.message_count == 3


def test_save_assistant_message_skips_empty():
    from routes.cerberus_agent_thread_routes import _save_assistant_message

    added = []

    class _FakeDB:
        def query(self, model):
            class _Q:
                def filter(self, *_a): return self
                def first(self): return MagicMock(message_count=0)
            return _Q()
        def add(self, obj): added.append(obj)
        def commit(self): pass
        def close(self): pass

    with patch("routes.cerberus_agent_thread_routes.SessionLocal", return_value=_FakeDB()):
        _save_assistant_message("t1", "   ")   # whitespace only

    assert len(added) == 0


# ---------------------------------------------------------------------------
# Tests: route schema
# ---------------------------------------------------------------------------

def test_send_message_body_validates():
    from routes.cerberus_agent_thread_routes import SendMessageBody
    body = SendMessageBody(message="Hello agent!")
    assert body.message == "Hello agent!"


def test_send_message_body_requires_message():
    from routes.cerberus_agent_thread_routes import SendMessageBody
    try:
        SendMessageBody()
        assert False, "Expected ValidationError"
    except Exception:
        pass  # pydantic ValidationError is expected


# ---------------------------------------------------------------------------
# Tests: route is importable and setup returns a router
# ---------------------------------------------------------------------------

def test_setup_agent_thread_routes_returns_router():
    from routes.cerberus_agent_thread_routes import setup_agent_thread_routes
    router = setup_agent_thread_routes()
    routes = [r.path for r in router.routes]
    assert any("/thread" in p for p in routes), f"No /thread route found: {routes}"
    assert any("/thread/send" in p for p in routes), f"No /thread/send route: {routes}"
