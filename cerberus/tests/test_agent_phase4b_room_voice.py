"""Tests for Phase 4b — group conference voice call: tts_voice in route events, floor control."""

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
# Helpers (mirrors test_agent_phase3c_rooms.py)
# ---------------------------------------------------------------------------

def _make_room(round_cap=None, mode="open"):
    r = MagicMock()
    r.round_cap = round_cap
    r.mode = mode
    r.total_input_tokens = 0
    r.total_output_tokens = 0
    return r


def _make_agent(name, tts_voice=""):
    a = MagicMock()
    a.name = name
    a.id = f"id-{name.lower()}"
    a.system_prompt = f"You are {name}."
    a.model_alias = "default"
    a.tts_voice = tts_voice
    return a


def _make_fake_db_factory():
    class _FakeDB:
        def query(self, model):
            class _Q:
                def filter(self, *_): return self
                def order_by(self, *_): return self
                def limit(self, *_): return self
                def all(self): return []
                def first(self): return None
            return _Q()
        def close(self): pass
    return lambda: _FakeDB()


def _collect_async(gen):
    async def _run():
        items = []
        async for item in gen:
            items.append(item)
        return items
    return asyncio.run(_run())


async def _fake_agent_stream(*a, **kw):
    yield 'data: {"delta": "hello"}\n\n'
    yield "data: [DONE]\n\n"


def _mock_modules(url="http://localhost/v1"):
    return {
        "routes.cerberus_agent_routes": MagicMock(
            _resolve_agent_endpoint=MagicMock(return_value=(url, "model", {}))
        ),
        "src.llm_core": MagicMock(
            stream_llm=_fake_agent_stream,
            llm_call_async=AsyncMock(return_value="ROUTE:CODER"),
        ),
    }


# ---------------------------------------------------------------------------
# Tests: event:route includes tts_voice (open_stream)
# ---------------------------------------------------------------------------

def test_open_stream_route_event_includes_tts_voice():
    """event:route data must include tts_voice from agent.tts_voice."""
    from routes.conference_room_engine import open_stream

    coder = _make_agent("CODER", tts_voice="alloy")
    agents = [coder]
    room = _make_room(round_cap=1)
    db_factory = _make_fake_db_factory()

    with patch.dict(sys.modules, _mock_modules()):
        chunks = _collect_async(
            open_stream("r1", room, agents, "test", "owner", 1, db_factory)
        )

    route_chunks = [c for c in chunks if c.startswith("event: route")]
    assert len(route_chunks) == 1
    data = json.loads(route_chunks[0].split("data: ", 1)[1].strip())
    assert "tts_voice" in data
    assert data["tts_voice"] == "alloy"


def test_open_stream_route_event_tts_voice_empty_string_when_none():
    """event:route must emit tts_voice as '' when agent.tts_voice is None."""
    from routes.conference_room_engine import open_stream

    coder = _make_agent("CODER", tts_voice=None)
    agents = [coder]
    room = _make_room(round_cap=1)
    db_factory = _make_fake_db_factory()

    with patch.dict(sys.modules, _mock_modules()):
        chunks = _collect_async(
            open_stream("r1", room, agents, "test", "owner", 1, db_factory)
        )

    route_chunks = [c for c in chunks if c.startswith("event: route")]
    assert len(route_chunks) == 1
    data = json.loads(route_chunks[0].split("data: ", 1)[1].strip())
    assert data["tts_voice"] == ""


def test_open_stream_each_agent_tts_voice_in_route():
    """Multiple agents: each route event carries that agent's specific tts_voice."""
    from routes.conference_room_engine import open_stream

    coder  = _make_agent("CODER",  tts_voice="nova")
    tester = _make_agent("TESTER", tts_voice="onyx")
    agents = [coder, tester]
    room = _make_room(round_cap=2)
    db_factory = _make_fake_db_factory()

    with patch.dict(sys.modules, _mock_modules()):
        chunks = _collect_async(
            open_stream("r1", room, agents, "test", "owner", 2, db_factory)
        )

    route_chunks = [c for c in chunks if c.startswith("event: route")]
    assert len(route_chunks) == 2
    d0 = json.loads(route_chunks[0].split("data: ", 1)[1].strip())
    d1 = json.loads(route_chunks[1].split("data: ", 1)[1].strip())
    voices = {d0["agent"]: d0["tts_voice"], d1["agent"]: d1["tts_voice"]}
    assert voices["CODER"]  == "nova"
    assert voices["TESTER"] == "onyx"


# ---------------------------------------------------------------------------
# Tests: event:route includes tts_voice (routed_stream)
# ---------------------------------------------------------------------------

def test_routed_stream_route_event_includes_tts_voice():
    """routed_stream event:route must also include tts_voice."""
    from routes.conference_room_engine import routed_stream

    coder = _make_agent("CODER", tts_voice="shimmer")
    agents = [coder]
    db_factory = _make_fake_db_factory()

    mock_route = AsyncMock(return_value=(coder, "ROUTE:CODER"))

    with patch.dict(sys.modules, _mock_modules()):
        with patch("routes.conference_room_engine._agent_stream", side_effect=_fake_agent_stream):
            with patch("routes.conference_room_routes._route_message", mock_route):
                chunks = _collect_async(
                    routed_stream("r1", None, agents, "test", "owner", db_factory)
                )

    route_chunks = [c for c in chunks if c.startswith("event: route")]
    assert len(route_chunks) == 1
    data = json.loads(route_chunks[0].split("data: ", 1)[1].strip())
    assert data["tts_voice"] == "shimmer"


# ---------------------------------------------------------------------------
# Tests: route event schema
# ---------------------------------------------------------------------------

def test_route_event_has_all_fields():
    """event:route must carry agent, agent_id, and tts_voice."""
    from routes.conference_room_engine import open_stream

    coder = _make_agent("CODER", tts_voice="alloy")
    agents = [coder]
    room = _make_room(round_cap=1)
    db_factory = _make_fake_db_factory()

    with patch.dict(sys.modules, _mock_modules()):
        chunks = _collect_async(
            open_stream("r1", room, agents, "test", "owner", 1, db_factory)
        )

    route_chunks = [c for c in chunks if c.startswith("event: route")]
    data = json.loads(route_chunks[0].split("data: ", 1)[1].strip())
    assert "agent"     in data
    assert "agent_id"  in data
    assert "tts_voice" in data
    assert data["agent"]    == "CODER"
    assert data["agent_id"] == "id-coder"


# ---------------------------------------------------------------------------
# Tests: orchestrator-conducted open stream still includes tts_voice
# ---------------------------------------------------------------------------

def test_orchestrator_conducted_route_includes_tts_voice():
    """With ORCHESTRATOR, _conduct_next_speaker route events carry tts_voice."""
    from routes.conference_room_engine import open_stream

    orch  = _make_agent("ORCHESTRATOR", tts_voice="")
    coder = _make_agent("CODER", tts_voice="echo")
    agents = [orch, coder]
    room = _make_room(round_cap=2)
    db_factory = _make_fake_db_factory()

    conduct_mock = AsyncMock(side_effect=[
        (coder, False),
        (None,  True),   # converge after one turn
    ])

    with patch.dict(sys.modules, _mock_modules()):
        with patch("routes.conference_room_engine._conduct_next_speaker", conduct_mock):
            chunks = _collect_async(
                open_stream("r1", room, agents, "test", "owner", 2, db_factory)
            )

    route_chunks = [c for c in chunks if c.startswith("event: route")]
    assert len(route_chunks) == 1
    data = json.loads(route_chunks[0].split("data: ", 1)[1].strip())
    assert data["tts_voice"] == "echo"
    assert data["agent"] == "CODER"


# ---------------------------------------------------------------------------
# Tests: room_voice route — /continue endpoint still works (4b uses it)
# ---------------------------------------------------------------------------

def test_continue_route_registered():
    """POST /api/rooms/{id}/continue route must be present (used by room_voice.js)."""
    from routes.conference_room_routes import setup_conference_room_routes
    router = setup_conference_room_routes()
    paths = [r.path for r in router.routes]
    methods = {r.path: getattr(r, "methods", set()) for r in router.routes}
    continue_path = next(p for p in paths if "/continue" in p)
    assert "POST" in methods[continue_path]


def test_send_route_registered():
    """POST /api/rooms/{id}/send route must be present (primary room_voice entry point)."""
    from routes.conference_room_routes import setup_conference_room_routes
    router = setup_conference_room_routes()
    paths = [r.path for r in router.routes]
    methods = {r.path: getattr(r, "methods", set()) for r in router.routes}
    send_path = next(p for p in paths if "/send" in p)
    assert "POST" in methods[send_path]


# ---------------------------------------------------------------------------
# Tests: backward compat — 3b/3c route events still have agent + agent_id
# ---------------------------------------------------------------------------

def test_route_event_backward_compat_agent_and_id_still_present():
    """Adding tts_voice must not break existing agent/agent_id fields."""
    from routes.conference_room_engine import open_stream

    coder = _make_agent("CODER", tts_voice="alloy")
    room = _make_room(round_cap=1)
    db_factory = _make_fake_db_factory()

    with patch.dict(sys.modules, _mock_modules()):
        chunks = _collect_async(
            open_stream("r1", room, [coder], "test", "owner", 1, db_factory)
        )

    route_chunks = [c for c in chunks if c.startswith("event: route")]
    data = json.loads(route_chunks[0].split("data: ", 1)[1].strip())
    # 3b/3c relied on these two fields
    assert data["agent"]   == "CODER"
    assert data["agent_id"] == "id-coder"
