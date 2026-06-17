"""Tests for Phase 3 — ConferenceRoom + RoomMessage models and routes."""

import sys
import json
import asyncio
from unittest.mock import MagicMock, patch, AsyncMock

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

def test_conference_room_model_exists():
    from core.database import ConferenceRoom
    assert ConferenceRoom.__tablename__ == "conference_rooms"


def test_room_message_model_exists():
    from core.database import RoomMessage
    assert RoomMessage.__tablename__ == "room_messages"


def test_conference_room_columns():
    from core.database import ConferenceRoom
    cols = {c.key for c in ConferenceRoom.__table__.columns}
    assert {"id", "name", "owner", "participant_ids", "last_message_at", "message_count"} <= cols


def test_room_message_columns():
    from core.database import RoomMessage
    cols = {c.key for c in RoomMessage.__table__.columns}
    assert {"id", "room_id", "role", "sender_id", "sender_name", "content"} <= cols


def test_participant_ids_defaults_empty_json():
    from core.database import ConferenceRoom
    col = ConferenceRoom.__table__.columns["participant_ids"]
    assert col.default.arg == "[]"


# ---------------------------------------------------------------------------
# Tests: _save_room_message
# ---------------------------------------------------------------------------

def test_save_room_message_persists():
    from routes.conference_room_routes import _save_room_message

    room = MagicMock()
    room.message_count = 0
    added = []

    class _FakeDB:
        def query(self, model):
            class _Q:
                def filter(self, *_a): return self
                def first(self): return room
            return _Q()
        def add(self, obj): added.append(obj)
        def commit(self): pass
        def close(self): pass

    with patch("routes.conference_room_routes.SessionLocal", return_value=_FakeDB()):
        _save_room_message("room-1", "agent", "agent-99", "CODER", "Here's the code.")

    assert len(added) == 1
    assert added[0].role == "agent"
    assert added[0].sender_name == "CODER"
    assert room.message_count == 1


def test_save_room_message_skips_empty():
    from routes.conference_room_routes import _save_room_message

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

    with patch("routes.conference_room_routes.SessionLocal", return_value=_FakeDB()):
        _save_room_message("room-1", "agent", None, "CODER", "   ")

    assert len(added) == 0


# ---------------------------------------------------------------------------
# Tests: _route_message
# ---------------------------------------------------------------------------

def test_route_message_single_agent_no_routing():
    from routes.conference_room_routes import _route_message
    agent = MagicMock(); agent.name = "CODER"
    result, _ = asyncio.run(_route_message([agent], "help me", "owner"))
    assert result.name == "CODER"


def test_route_message_no_orchestrator_picks_first():
    from routes.conference_room_routes import _route_message
    a1 = MagicMock(); a1.name = "CODER"
    a2 = MagicMock(); a2.name = "TESTER"
    result, _ = asyncio.run(_route_message([a1, a2], "test this", "owner"))
    assert result.name == "CODER"


def test_route_message_only_orchestrator_responds_directly():
    from routes.conference_room_routes import _route_message
    orch = MagicMock(); orch.name = "ORCHESTRATOR"
    result, _ = asyncio.run(_route_message([orch], "help", "owner"))
    assert result.name == "ORCHESTRATOR"


def test_route_message_empty_returns_none():
    from routes.conference_room_routes import _route_message
    result, _ = asyncio.run(_route_message([], "hi", "owner"))
    assert result is None


def test_route_message_orchestrator_routes_via_llm():
    """ORCHESTRATOR present + others → LLM routing decision picks CODER."""
    from routes.conference_room_routes import _route_message

    orch  = MagicMock(); orch.name = "ORCHESTRATOR"; orch.model_alias = "default"
    coder = MagicMock(); coder.name = "CODER"

    mock_resolve = MagicMock(return_value=("http://llm/v1", "gpt-4", {}))
    mock_llm     = AsyncMock(return_value="ROUTE:CODER")

    # _route_message imports both inside its body; patch at the source modules
    with patch.dict(sys.modules, {
        "src.llm_core":                MagicMock(llm_call_async=mock_llm),
        "routes.cerberus_agent_routes": MagicMock(_resolve_agent_endpoint=mock_resolve),
    }):
        result, note = asyncio.run(
            _route_message([orch, coder], "write a sort function", "alice")
        )
    assert result.name == "CODER"


# ---------------------------------------------------------------------------
# Tests: route setup
# ---------------------------------------------------------------------------

def test_setup_conference_room_routes_returns_router():
    from routes.conference_room_routes import setup_conference_room_routes
    router = setup_conference_room_routes()
    paths = [r.path for r in router.routes]
    assert any(p == "/api/rooms" for p in paths)
    assert any("/send" in p for p in paths)


def test_pydantic_schemas():
    from routes.conference_room_routes import RoomCreate, RoomPatch, RoomSend
    rc = RoomCreate(name="Sprint", participant_ids=["a", "b"])
    assert rc.name == "Sprint"
    assert rc.participant_ids == ["a", "b"]

    rp = RoomPatch(name="Updated")
    assert rp.name == "Updated"
    assert rp.participant_ids is None

    rs = RoomSend(message="Hello!")
    assert rs.message == "Hello!"


# ---------------------------------------------------------------------------
# Tests: helper serializers
# ---------------------------------------------------------------------------

def test_room_dict_serializes_participant_ids():
    from routes.conference_room_routes import _room_dict
    room = MagicMock()
    room.id = "r1"; room.name = "Alpha"; room.owner = "alice"
    room.participant_ids = json.dumps(["id1", "id2"])
    room.created_at = None; room.last_message_at = None; room.message_count = 3
    d = _room_dict(room)
    assert d["participant_ids"] == ["id1", "id2"]
    assert d["message_count"] == 3


def test_msg_dict_serializes():
    from routes.conference_room_routes import _msg_dict
    msg = MagicMock()
    msg.id = "m1"; msg.role = "agent"; msg.sender_id = "a1"
    msg.sender_name = "CODER"; msg.content = "Here's the code"
    msg.timestamp = None
    d = _msg_dict(msg)
    assert d["sender_name"] == "CODER"
    assert d["role"] == "agent"
