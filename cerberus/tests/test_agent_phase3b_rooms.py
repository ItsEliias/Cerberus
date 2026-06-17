"""Tests for Phase 3b — transcript context, routed/open modes, cap, continue-checkpoint."""

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
# Helpers
# ---------------------------------------------------------------------------

def _make_room(mode="routed", round_cap=5, total_in=0, total_out=0):
    r = MagicMock()
    r.mode = mode
    r.round_cap = round_cap
    r.total_input_tokens = total_in
    r.total_output_tokens = total_out
    return r


def _make_agent(name="CODER"):
    a = MagicMock()
    a.name = name
    a.id = f"id-{name.lower()}"
    a.system_prompt = f"You are {name}."
    a.model_alias = "default"
    return a


# ---------------------------------------------------------------------------
# Tests: build_context_messages
# ---------------------------------------------------------------------------

def test_build_context_messages_empty_returns_plain():
    from routes.conference_room_engine import build_context_messages

    class _Q:
        def filter(self, *_): return self
        def order_by(self, *_): return self
        def limit(self, *_): return self
        def all(self): return []

    db = MagicMock()
    db.query.return_value = _Q()

    msgs = build_context_messages(db, "r1", "You are CODER.", "write a sort")
    assert len(msgs) == 2
    assert msgs[0]["role"] == "system"
    assert "You are CODER." in msgs[0]["content"]
    assert "transcript" not in msgs[0]["content"].lower()
    assert msgs[1]["content"] == "write a sort"


def test_build_context_messages_injects_transcript():
    from routes.conference_room_engine import build_context_messages

    row1 = MagicMock(); row1.sender_name = "USER";  row1.role = "user";  row1.content = "Hello"
    row2 = MagicMock(); row2.sender_name = "CODER"; row2.role = "agent"; row2.content = "Hi there"

    class _Q:
        def filter(self, *_): return self
        def order_by(self, *_): return self
        def limit(self, *_): return self
        def all(self): return [row2, row1]   # desc order from DB

    db = MagicMock()
    db.query.return_value = _Q()

    msgs = build_context_messages(db, "r1", "You are AGENT.", "next question")
    sys_content = msgs[0]["content"]
    assert "Room transcript" in sys_content
    assert "USER: Hello" in sys_content
    assert "CODER: Hi there" in sys_content


def test_build_context_messages_sanitizes_control_chars():
    from routes.conference_room_engine import build_context_messages

    row = MagicMock()
    row.sender_name = "USER"
    row.role = "user"
    row.content = "normal\x00text\x1fend"

    class _Q:
        def filter(self, *_): return self
        def order_by(self, *_): return self
        def limit(self, *_): return self
        def all(self): return [row]

    db = MagicMock()
    db.query.return_value = _Q()

    msgs = build_context_messages(db, "r1", "", "prompt")
    assert "\x00" not in msgs[0]["content"]
    assert "\x1f" not in msgs[0]["content"]
    assert "normaltext" in msgs[0]["content"] or "normalend" in msgs[0]["content"]


def test_build_context_messages_truncates_long_content():
    from routes.conference_room_engine import build_context_messages, MAX_MSG_CHARS

    row = MagicMock()
    row.sender_name = "USER"
    row.role = "user"
    row.content = "X" * (MAX_MSG_CHARS + 500)

    class _Q:
        def filter(self, *_): return self
        def order_by(self, *_): return self
        def limit(self, *_): return self
        def all(self): return [row]

    db = MagicMock()
    db.query.return_value = _Q()

    msgs = build_context_messages(db, "r1", "", "prompt")
    # Content in transcript should not exceed MAX_MSG_CHARS
    assert len(msgs[0]["content"]) <= MAX_MSG_CHARS + 500  # system prompt + header overhead
    # The row content must be truncated
    assert "X" * (MAX_MSG_CHARS + 1) not in msgs[0]["content"]


# ---------------------------------------------------------------------------
# Tests: effective_cap
# ---------------------------------------------------------------------------

def test_effective_cap_default():
    from routes.conference_room_engine import effective_cap, DEFAULT_CAP
    room = _make_room(round_cap=None)
    room.round_cap = None
    assert effective_cap(room) == DEFAULT_CAP


def test_effective_cap_custom():
    from routes.conference_room_engine import effective_cap
    room = _make_room(round_cap=3)
    assert effective_cap(room) == 3


def test_effective_cap_clamps_above_max():
    from routes.conference_room_engine import effective_cap, MAX_CAP
    room = _make_room(round_cap=MAX_CAP + 10)
    assert effective_cap(room) == MAX_CAP


def test_effective_cap_clamps_below_one():
    from routes.conference_room_engine import effective_cap
    room = _make_room(round_cap=0)
    assert effective_cap(room) == 1


# ---------------------------------------------------------------------------
# Tests: is_local_provider
# ---------------------------------------------------------------------------

def test_is_local_provider_localhost():
    from routes.conference_room_engine import is_local_provider
    assert is_local_provider("http://localhost:11434/v1") is True


def test_is_local_provider_remote():
    from routes.conference_room_engine import is_local_provider
    assert is_local_provider("https://api.openai.com/v1") is False


def test_is_local_provider_none():
    from routes.conference_room_engine import is_local_provider
    assert is_local_provider(None) is False


# ---------------------------------------------------------------------------
# Tests: room_dict includes Phase 3b fields
# ---------------------------------------------------------------------------

def test_room_dict_includes_phase3b_fields():
    from routes.conference_room_routes import _room_dict
    room = MagicMock()
    room.id = "r1"; room.name = "Alpha"; room.owner = "alice"
    room.participant_ids = "[]"
    room.created_at = None; room.last_message_at = None; room.message_count = 0
    room.mode = "open"; room.round_cap = 3
    room.total_input_tokens = 100; room.total_output_tokens = 200
    d = _room_dict(room)
    assert d["mode"] == "open"
    assert d["round_cap"] == 3
    assert d["total_input_tokens"] == 100
    assert d["total_output_tokens"] == 200


# ---------------------------------------------------------------------------
# Tests: route setup — continue endpoint exists
# ---------------------------------------------------------------------------

def test_continue_route_registered():
    from routes.conference_room_routes import setup_conference_room_routes
    router = setup_conference_room_routes()
    paths = [r.path for r in router.routes]
    assert any("/continue" in p for p in paths)


def test_patch_route_exists():
    from routes.conference_room_routes import setup_conference_room_routes
    router = setup_conference_room_routes()
    paths = [r.path for r in router.routes]
    assert any("{room_id}" in p for p in paths)


# ---------------------------------------------------------------------------
# Tests: RoomPatch schema accepts mode + round_cap
# ---------------------------------------------------------------------------

def test_room_patch_accepts_mode():
    from routes.conference_room_routes import RoomPatch
    rp = RoomPatch(mode="open")
    assert rp.mode == "open"
    assert rp.round_cap is None


def test_room_patch_accepts_round_cap():
    from routes.conference_room_routes import RoomPatch
    rp = RoomPatch(round_cap=7)
    assert rp.round_cap == 7


# ---------------------------------------------------------------------------
# Tests: open_stream emits route events + cap_reached
# ---------------------------------------------------------------------------

def _collect_async(coro_or_gen):
    """Collect all items from an async generator."""
    async def _run():
        items = []
        async for item in coro_or_gen:
            items.append(item)
        return items
    return asyncio.run(_run())


def _make_fake_db_factory(room):
    class _FakeDB:
        def query(self, model):
            class _Q:
                def filter(self, *_): return self
                def order_by(self, *_): return self
                def limit(self, *_): return self
                def all(self): return []
            return _Q()
        def close(self): pass

    def factory():
        return _FakeDB()

    return factory


def test_open_stream_emits_route_per_agent():
    """open_stream must emit event:route for each agent up to cap."""
    from routes.conference_room_engine import open_stream

    agents = [_make_agent("CODER"), _make_agent("TESTER")]
    room = _make_room(mode="open", round_cap=2)
    db_factory = _make_fake_db_factory(room)

    mock_resolve = MagicMock(return_value=("http://localhost/v1", "m", {}))
    mock_stream  = AsyncMock(return_value=iter([
        'data: {"delta": "ok"}\n\n', "data: [DONE]\n\n",
    ]))

    async def _fake_stream(*a, **kw):
        yield 'data: {"delta": "ok"}\n\n'
        yield "data: [DONE]\n\n"

    with patch.dict(sys.modules, {
        "routes.cerberus_agent_routes": MagicMock(_resolve_agent_endpoint=mock_resolve),
        "src.llm_core": MagicMock(stream_llm=_fake_stream),
    }):
        chunks = _collect_async(open_stream("r1", room, agents, "test", "owner", 2, db_factory))

    route_chunks = [c for c in chunks if c.startswith("event: route")]
    assert len(route_chunks) == 2


def test_open_stream_emits_cap_reached():
    """open_stream emits event:cap_reached when cap is hit."""
    from routes.conference_room_engine import open_stream

    agents = [_make_agent("CODER"), _make_agent("TESTER"), _make_agent("REVIEWER")]
    room = _make_room(mode="open", round_cap=2)
    db_factory = _make_fake_db_factory(room)

    async def _fake_stream(*a, **kw):
        yield 'data: {"delta": "x"}\n\n'
        yield "data: [DONE]\n\n"

    mock_resolve = MagicMock(return_value=("http://localhost/v1", "m", {}))

    with patch.dict(sys.modules, {
        "routes.cerberus_agent_routes": MagicMock(_resolve_agent_endpoint=mock_resolve),
        "src.llm_core": MagicMock(stream_llm=_fake_stream),
    }):
        chunks = _collect_async(open_stream("r1", room, agents, "test", "owner", 2, db_factory))

    cap_chunks = [c for c in chunks if c.startswith("event: cap_reached")]
    assert len(cap_chunks) == 1
    assert '"rounds": 2' in cap_chunks[0]


def test_open_stream_ends_with_done():
    """open_stream final chunk must be data: [DONE]."""
    from routes.conference_room_engine import open_stream

    agents = [_make_agent("CODER")]
    room = _make_room(round_cap=1)
    db_factory = _make_fake_db_factory(room)

    async def _fake_stream(*a, **kw):
        yield 'data: {"delta": "hi"}\n\n'
        yield "data: [DONE]\n\n"

    mock_resolve = MagicMock(return_value=("http://localhost/v1", "m", {}))

    with patch.dict(sys.modules, {
        "routes.cerberus_agent_routes": MagicMock(_resolve_agent_endpoint=mock_resolve),
        "src.llm_core": MagicMock(stream_llm=_fake_stream),
    }):
        chunks = _collect_async(open_stream("r1", room, agents, "test", "owner", 1, db_factory))

    assert chunks[-1] == "data: [DONE]\n\n"


def test_open_stream_suppresses_intermediate_done():
    """open_stream must not forward [DONE] from each agent turn (only final)."""
    from routes.conference_room_engine import open_stream

    agents = [_make_agent("CODER"), _make_agent("TESTER")]
    room = _make_room(round_cap=2)
    db_factory = _make_fake_db_factory(room)

    async def _fake_stream(*a, **kw):
        yield 'data: {"delta": "x"}\n\n'
        yield "data: [DONE]\n\n"

    mock_resolve = MagicMock(return_value=("http://localhost/v1", "m", {}))

    with patch.dict(sys.modules, {
        "routes.cerberus_agent_routes": MagicMock(_resolve_agent_endpoint=mock_resolve),
        "src.llm_core": MagicMock(stream_llm=_fake_stream),
    }):
        chunks = _collect_async(open_stream("r1", room, agents, "test", "owner", 2, db_factory))

    done_chunks = [c for c in chunks if "[DONE]" in c]
    # Only the final [DONE] should be present
    assert len(done_chunks) == 1
    assert done_chunks[-1] == "data: [DONE]\n\n"
