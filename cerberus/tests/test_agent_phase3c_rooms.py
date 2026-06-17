"""Tests for Phase 3c — ORCHESTRATOR-conducted open mode, round-based cap, provider defaults."""

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

def _make_room(round_cap=None, mode="open"):
    r = MagicMock()
    r.round_cap = round_cap
    r.mode = mode
    r.total_input_tokens = 0
    r.total_output_tokens = 0
    return r


def _make_agent(name):
    a = MagicMock()
    a.name = name
    a.id = f"id-{name.lower()}"
    a.system_prompt = f"You are {name}."
    a.model_alias = "default"
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
    yield 'data: {"delta": "ok"}\n\n'
    yield "data: [DONE]\n\n"


def _mock_agent_modules(url="http://localhost/v1"):
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
# Tests: provider-aware default cap
# ---------------------------------------------------------------------------

def test_provider_default_cap_local():
    from routes.conference_room_engine import effective_cap, DEFAULT_CAP_LOCAL
    room = _make_room(round_cap=None)
    agents = [_make_agent("CODER")]
    mock_resolve = MagicMock(return_value=("http://localhost:11434/v1", "m", {}))
    with patch.dict(sys.modules, {
        "routes.cerberus_agent_routes": MagicMock(_resolve_agent_endpoint=mock_resolve),
    }):
        cap = effective_cap(room, agents=agents, owner="alice")
    assert cap == DEFAULT_CAP_LOCAL


def test_provider_default_cap_paid():
    from routes.conference_room_engine import effective_cap, DEFAULT_CAP_PAID
    room = _make_room(round_cap=None)
    agents = [_make_agent("CODER")]
    mock_resolve = MagicMock(return_value=("https://api.openai.com/v1", "m", {}))
    with patch.dict(sys.modules, {
        "routes.cerberus_agent_routes": MagicMock(_resolve_agent_endpoint=mock_resolve),
    }):
        cap = effective_cap(room, agents=agents, owner="alice")
    assert cap == DEFAULT_CAP_PAID


def test_explicit_round_cap_overrides_provider_default():
    from routes.conference_room_engine import effective_cap
    room = _make_room(round_cap=3)
    agents = [_make_agent("CODER")]
    mock_resolve = MagicMock(return_value=("http://localhost/v1", "m", {}))
    with patch.dict(sys.modules, {
        "routes.cerberus_agent_routes": MagicMock(_resolve_agent_endpoint=mock_resolve),
    }):
        cap = effective_cap(room, agents=agents, owner="alice")
    assert cap == 3


def test_provider_default_cap_no_agents():
    from routes.conference_room_engine import effective_cap, DEFAULT_CAP_PAID
    room = _make_room(round_cap=None)
    assert effective_cap(room, agents=None, owner=None) == DEFAULT_CAP_PAID


def test_127_hint_counts_as_local():
    from routes.conference_room_engine import is_local_provider
    assert is_local_provider("http://127.0.0.1:8080/v1") is True


def test_provider_default_cap_127():
    from routes.conference_room_engine import effective_cap, DEFAULT_CAP_LOCAL
    room = _make_room(round_cap=None)
    agents = [_make_agent("CODER")]
    mock_resolve = MagicMock(return_value=("http://127.0.0.1:11434/v1", "m", {}))
    with patch.dict(sys.modules, {
        "routes.cerberus_agent_routes": MagicMock(_resolve_agent_endpoint=mock_resolve),
    }):
        cap = effective_cap(room, agents=agents, owner="alice")
    assert cap == DEFAULT_CAP_LOCAL


# ---------------------------------------------------------------------------
# Tests: open_stream — round-based cap (turns > participant count)
# ---------------------------------------------------------------------------

def test_round_based_cap_exceeds_participant_count():
    """2 agents + cap=4: round-robin should produce 4 turns, not stop at 2."""
    from routes.conference_room_engine import open_stream
    agents = [_make_agent("CODER"), _make_agent("TESTER")]
    room = _make_room(round_cap=4)
    db_factory = _make_fake_db_factory()

    with patch.dict(sys.modules, _mock_agent_modules()):
        chunks = _collect_async(
            open_stream("r1", room, agents, "test", "owner", 4, db_factory)
        )

    route_chunks = [c for c in chunks if c.startswith("event: route")]
    assert len(route_chunks) == 4, f"expected 4 route events, got {len(route_chunks)}"


def test_round_based_cap_fires_cap_reached():
    """cap=3, 2 agents (no ORCHESTRATOR) → cap_reached with rounds=3."""
    from routes.conference_room_engine import open_stream
    agents = [_make_agent("CODER"), _make_agent("TESTER")]
    room = _make_room(round_cap=3)
    db_factory = _make_fake_db_factory()

    with patch.dict(sys.modules, _mock_agent_modules()):
        chunks = _collect_async(
            open_stream("r1", room, agents, "test", "owner", 3, db_factory)
        )

    cap_chunks = [c for c in chunks if "cap_reached" in c]
    assert len(cap_chunks) == 1
    assert '"rounds": 3' in cap_chunks[0]


def test_round_robin_order_without_orchestrator():
    """Without ORCHESTRATOR, agents cycle in list order: CODER, TESTER, CODER."""
    from routes.conference_room_engine import open_stream
    coder = _make_agent("CODER")
    tester = _make_agent("TESTER")
    agents = [coder, tester]
    room = _make_room(round_cap=3)
    db_factory = _make_fake_db_factory()

    with patch.dict(sys.modules, _mock_agent_modules()):
        chunks = _collect_async(
            open_stream("r1", room, agents, "test", "owner", 3, db_factory)
        )

    route_chunks = [c for c in chunks if c.startswith("event: route")]
    assert len(route_chunks) == 3
    assert "CODER" in route_chunks[0]
    assert "TESTER" in route_chunks[1]
    assert "CODER" in route_chunks[2]


# ---------------------------------------------------------------------------
# Tests: open_stream — ORCHESTRATOR-conducted
# ---------------------------------------------------------------------------

def test_orchestrator_conducts_speaker_selection():
    """With ORCHESTRATOR, _conduct_next_speaker is called each turn (not fixed order)."""
    from routes.conference_room_engine import open_stream
    orch  = _make_agent("ORCHESTRATOR")
    coder = _make_agent("CODER")
    tester = _make_agent("TESTER")
    agents = [orch, coder, tester]
    room = _make_room(round_cap=5)
    db_factory = _make_fake_db_factory()

    conduct_mock = AsyncMock(side_effect=[
        (tester, False),  # ORCHESTRATOR picks TESTER first (not list order)
        (coder,  False),  # then CODER
        (None,   True),   # then signals convergence
    ])

    with patch.dict(sys.modules, _mock_agent_modules()):
        with patch("routes.conference_room_engine._conduct_next_speaker", conduct_mock):
            chunks = _collect_async(
                open_stream("r1", room, agents, "discuss", "owner", 5, db_factory)
            )

    route_chunks = [c for c in chunks if c.startswith("event: route")]
    assert len(route_chunks) == 2
    assert "TESTER" in route_chunks[0]   # ORCHESTRATOR chose TESTER first
    assert "CODER"  in route_chunks[1]
    assert conduct_mock.call_count == 3  # called 3 times (2 picks + 1 converge)


def test_early_convergence_stops_before_cap():
    """ORCHESTRATOR signalling DONE after 1 turn stops discussion early, no cap_reached."""
    from routes.conference_room_engine import open_stream
    orch  = _make_agent("ORCHESTRATOR")
    coder = _make_agent("CODER")
    agents = [orch, coder]
    room = _make_room(round_cap=10)
    db_factory = _make_fake_db_factory()

    conduct_mock = AsyncMock(side_effect=[
        (coder, False),  # one turn
        (None,  True),   # converge after second check
    ])

    with patch.dict(sys.modules, _mock_agent_modules()):
        with patch("routes.conference_room_engine._conduct_next_speaker", conduct_mock):
            chunks = _collect_async(
                open_stream("r1", room, agents, "q", "owner", 10, db_factory)
            )

    route_chunks = [c for c in chunks if c.startswith("event: route")]
    cap_chunks   = [c for c in chunks if "cap_reached" in c]
    assert len(route_chunks) == 1
    assert len(cap_chunks) == 0
    assert chunks[-1] == "data: [DONE]\n\n"


def test_orchestrator_conducts_more_turns_than_participants():
    """With ORCHESTRATOR, same agent can speak multiple times — rounds > participant count."""
    from routes.conference_room_engine import open_stream
    orch  = _make_agent("ORCHESTRATOR")
    coder = _make_agent("CODER")
    agents = [orch, coder]
    room = _make_room(round_cap=4)
    db_factory = _make_fake_db_factory()

    # ORCHESTRATOR keeps picking CODER (1 other agent, 4 turns)
    conduct_mock = AsyncMock(return_value=(coder, False))

    with patch.dict(sys.modules, _mock_agent_modules()):
        with patch("routes.conference_room_engine._conduct_next_speaker", conduct_mock):
            chunks = _collect_async(
                open_stream("r1", room, agents, "q", "owner", 4, db_factory)
            )

    route_chunks = [c for c in chunks if c.startswith("event: route")]
    cap_chunks   = [c for c in chunks if "cap_reached" in c]
    assert len(route_chunks) == 4   # 1 agent, 4 turns
    assert len(cap_chunks) == 1
    assert '"rounds": 4' in cap_chunks[0]


# ---------------------------------------------------------------------------
# Tests: _conduct_next_speaker routing decisions
# ---------------------------------------------------------------------------

def test_conduct_next_speaker_returns_named_agent():
    from routes.conference_room_engine import _conduct_next_speaker
    orch  = _make_agent("ORCHESTRATOR")
    coder = _make_agent("CODER")
    tester = _make_agent("TESTER")
    others = [coder, tester]

    mock_resolve = MagicMock(return_value=("http://localhost/v1", "m", {}))
    mock_llm = AsyncMock(return_value="ROUTE:TESTER")

    with patch.dict(sys.modules, {
        "routes.cerberus_agent_routes": MagicMock(_resolve_agent_endpoint=mock_resolve),
        "src.llm_core": MagicMock(llm_call_async=mock_llm),
        "core.database": MagicMock(RoomMessage=MagicMock()),
    }):
        agent, converged = asyncio.run(
            _conduct_next_speaker(orch, others, "owner", "r1", "test", _make_fake_db_factory())
        )

    assert agent.name == "TESTER"
    assert converged is False


def test_conduct_next_speaker_route_done_converges():
    from routes.conference_room_engine import _conduct_next_speaker
    orch  = _make_agent("ORCHESTRATOR")
    coder = _make_agent("CODER")

    mock_resolve = MagicMock(return_value=("http://localhost/v1", "m", {}))
    mock_llm = AsyncMock(return_value="ROUTE:DONE")

    with patch.dict(sys.modules, {
        "routes.cerberus_agent_routes": MagicMock(_resolve_agent_endpoint=mock_resolve),
        "src.llm_core": MagicMock(llm_call_async=mock_llm),
        "core.database": MagicMock(RoomMessage=MagicMock()),
    }):
        agent, converged = asyncio.run(
            _conduct_next_speaker(orch, [coder], "owner", "r1", "test", _make_fake_db_factory())
        )

    assert agent is None
    assert converged is True


def test_conduct_next_speaker_converged_keyword():
    from routes.conference_room_engine import _conduct_next_speaker
    orch  = _make_agent("ORCHESTRATOR")
    coder = _make_agent("CODER")

    mock_resolve = MagicMock(return_value=("http://localhost/v1", "m", {}))
    mock_llm = AsyncMock(return_value="CONVERGED")

    with patch.dict(sys.modules, {
        "routes.cerberus_agent_routes": MagicMock(_resolve_agent_endpoint=mock_resolve),
        "src.llm_core": MagicMock(llm_call_async=mock_llm),
        "core.database": MagicMock(RoomMessage=MagicMock()),
    }):
        agent, converged = asyncio.run(
            _conduct_next_speaker(orch, [coder], "owner", "r1", "test", _make_fake_db_factory())
        )

    assert converged is True


def test_conduct_next_speaker_fallback_on_llm_error():
    from routes.conference_room_engine import _conduct_next_speaker
    orch  = _make_agent("ORCHESTRATOR")
    coder = _make_agent("CODER")
    tester = _make_agent("TESTER")

    mock_resolve = MagicMock(return_value=("http://localhost/v1", "m", {}))
    mock_llm = AsyncMock(side_effect=RuntimeError("network error"))

    with patch.dict(sys.modules, {
        "routes.cerberus_agent_routes": MagicMock(_resolve_agent_endpoint=mock_resolve),
        "src.llm_core": MagicMock(llm_call_async=mock_llm),
        "core.database": MagicMock(RoomMessage=MagicMock()),
    }):
        agent, converged = asyncio.run(
            _conduct_next_speaker(orch, [coder, tester], "owner", "r1", "test", _make_fake_db_factory())
        )

    # Falls back to others[0]
    assert agent.name == "CODER"
    assert converged is False


# ---------------------------------------------------------------------------
# Tests: /continue uses conducted loop
# ---------------------------------------------------------------------------

def test_continue_route_uses_open_stream():
    """POST /continue must call open_stream (conducted loop), not a simple pass."""
    from routes.conference_room_routes import setup_conference_room_routes
    router = setup_conference_room_routes()
    paths = [r.path for r in router.routes]
    methods = {r.path: getattr(r, "methods", set()) for r in router.routes}
    continue_path = next(p for p in paths if "/continue" in p)
    assert "POST" in methods[continue_path]
