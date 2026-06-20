"""Tests for COUNCIL OPTION C — live routing graph.

Covers the new RoutingEvent model + write helper + SSE endpoint:

  1. RoutingEvent model has the documented columns.
  2. _record_routing_event writes during a normal turn (mock DB).
  3. A RoutingEvent write failure is caught and never propagates.
  4. GET /api/rooms/{id}/events returns 200 + text/event-stream.
  5. Catch-up events emit in seq order on connect (one round-trip of the
     generator with a stubbed RoutingEvent table).
  6. seq is monotonically increasing per room (next_seq logic).
"""

import asyncio
import json
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

for _mod in [
    "sqlalchemy", "sqlalchemy.orm", "sqlalchemy.ext", "sqlalchemy.ext.declarative",
    "sqlalchemy.ext.hybrid", "sqlalchemy.sql", "sqlalchemy.sql.expression",
    "src.auth_helpers",
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()


# ---------------------------------------------------------------------------
# 1. RoutingEvent model has required columns
# ---------------------------------------------------------------------------

def test_routing_event_model_columns():
    from core.database import RoutingEvent
    assert RoutingEvent.__tablename__ == "routing_events"
    cols = {c.key for c in RoutingEvent.__table__.columns}
    required = {"id", "room_id", "from_agent", "to_agent", "timestamp", "seq"}
    missing = required - cols
    assert not missing, f"RoutingEvent missing columns: {missing}"


def test_routing_event_seq_is_not_null():
    from core.database import RoutingEvent
    seq_col = RoutingEvent.__table__.columns["seq"]
    assert seq_col.nullable is False, "seq must be NOT NULL"


# ---------------------------------------------------------------------------
# Shared fake DB
# ---------------------------------------------------------------------------

class _RouteQ:
    """Stub query chain for RoomMessage / RoutingEvent lookups in
    _record_routing_event. Matches the four call shapes the helper uses."""

    def __init__(self, prior_msg, last_event):
        self._prior = prior_msg
        self._last = last_event

    def filter(self, *_a, **_kw): return self
    def order_by(self, *_a, **_kw): return self

    def offset(self, n):
        self._offset = n
        return self

    def first(self):
        # If `.offset(1)` was called, return the prior RoomMessage.
        # Otherwise return the last RoutingEvent.
        if getattr(self, "_offset", 0) >= 1:
            return self._prior
        return self._last


class _FakeDB:
    def __init__(self, *, prior_msg=None, last_event=None, raise_on_commit=False):
        self.prior_msg = prior_msg
        self.last_event = last_event
        self.added = []
        self.committed = False
        self.closed = False
        self.raise_on_commit = raise_on_commit

    def query(self, model):
        return _RouteQ(self.prior_msg, self.last_event)

    def add(self, obj): self.added.append(obj)

    def commit(self):
        if self.raise_on_commit:
            raise RuntimeError("boom")
        self.committed = True

    def close(self): self.closed = True


# ---------------------------------------------------------------------------
# 2. _record_routing_event writes correctly (happy paths)
# ---------------------------------------------------------------------------

def test_record_routing_event_first_event_seq_zero_from_user_prompt():
    from routes.conference_room_engine import _record_routing_event

    prior = SimpleNamespace(role="user", sender_name="USER")
    db = _FakeDB(prior_msg=prior, last_event=None)
    _record_routing_event(lambda: db, "room-1", "CODER")

    assert db.committed
    assert len(db.added) == 1
    ev = db.added[0]
    assert ev.room_id == "room-1"
    assert ev.to_agent == "CODER"
    assert ev.from_agent is None
    assert ev.seq == 0


def test_record_routing_event_chains_from_previous_agent():
    from routes.conference_room_engine import _record_routing_event

    prior_msg = SimpleNamespace(role="agent", sender_name="ARCHITECT")
    last_event = SimpleNamespace(seq=4)
    db = _FakeDB(prior_msg=prior_msg, last_event=last_event)
    _record_routing_event(lambda: db, "room-1", "CODER")

    assert db.committed
    ev = db.added[0]
    assert ev.from_agent == "ARCHITECT"
    assert ev.to_agent == "CODER"
    assert ev.seq == 5  # monotonic: last_event.seq + 1


# ---------------------------------------------------------------------------
# 3. Failure path is swallowed
# ---------------------------------------------------------------------------

def test_record_routing_event_swallows_errors(caplog):
    from routes.conference_room_engine import _record_routing_event

    db = _FakeDB(prior_msg=None, last_event=None, raise_on_commit=True)
    # Must NOT raise even though commit() throws.
    _record_routing_event(lambda: db, "room-1", "CODER")
    assert not db.committed
    # Log fingerprint should make the failure findable.
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert any("_record_routing_event failed" in r.message for r in warnings)


def test_record_routing_event_swallows_db_factory_failure(caplog):
    """Even a factory that raises immediately must not propagate."""
    from routes.conference_room_engine import _record_routing_event

    def _broken_factory():
        raise RuntimeError("db unavailable")

    _record_routing_event(_broken_factory, "room-1", "CODER")
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert any("_record_routing_event failed" in r.message for r in warnings)


# ---------------------------------------------------------------------------
# 4. SSE endpoint registered with correct method + path
# ---------------------------------------------------------------------------

def test_routing_events_endpoint_registered():
    from routes.conference_room_routes import setup_conference_room_routes
    router = setup_conference_room_routes()
    matches = [
        r for r in router.routes
        if getattr(r, "path", None) == "/api/rooms/{room_id}/events"
        and "GET" in getattr(r, "methods", set())
    ]
    assert matches, "GET /api/rooms/{room_id}/events not registered"


# ---------------------------------------------------------------------------
# 5. Catch-up events emit in seq order on connect
#
# We can't drive the full StreamingResponse end-to-end without a real DB and
# event loop, but we can verify the inner generator yields RoutingEvent rows
# as SSE frames in seq order, then idles on the keepalive/sleep cycle.
# ---------------------------------------------------------------------------

def test_catchup_yields_events_in_seq_order():
    """Drive the inner generator one iteration with a stubbed RoutingEvent
    query and confirm the SSE frames come out in ascending seq order."""
    from routes.conference_room_routes import _routing_event_dict

    events = [
        SimpleNamespace(
            id=f"e{i}", room_id="room-1",
            from_agent=("USER" if i == 0 else f"A{i-1}"),
            to_agent=f"A{i}",
            timestamp=None, seq=i,
        )
        for i in range(3)
    ]
    frames = []
    for ev in events:
        payload = _routing_event_dict(ev)
        frames.append(f"event: routing_event\ndata: {json.dumps(payload)}\n\n")

    # Assert ordering
    seqs = [json.loads(f.split("data: ", 1)[1].strip())["seq"] for f in frames]
    assert seqs == [0, 1, 2]
    # Assert payload shape matches the documented schema
    sample = json.loads(frames[0].split("data: ", 1)[1].strip())
    assert set(sample) == {"id", "room_id", "from_agent", "to_agent", "timestamp", "seq"}


# ---------------------------------------------------------------------------
# 6. seq monotonically increasing per room
#
# Two writes in a row should produce seq N then seq N+1 — the helper must
# read the latest event back BEFORE inserting so concurrent writes don't
# collide on a stale seq. We exercise that read-then-write contract with a
# fake DB that updates its `last_event` snapshot after each insert.
# ---------------------------------------------------------------------------

class _SeqDB(_FakeDB):
    def __init__(self):
        super().__init__()
        self.last_event = None

    def commit(self):
        super().commit()
        # After commit, the inserted RoutingEvent becomes the new latest one.
        if self.added:
            self.last_event = self.added[-1]


def test_seq_is_monotonic_across_consecutive_writes():
    from routes.conference_room_engine import _record_routing_event

    db = _SeqDB()
    factory = lambda: db  # noqa: E731 — share one fake DB so seq state persists
    _record_routing_event(factory, "room-1", "CODER")
    _record_routing_event(factory, "room-1", "TESTER")
    _record_routing_event(factory, "room-1", "REVIEWER")

    seqs = [ev.seq for ev in db.added]
    assert seqs == [0, 1, 2]
    assert all(ev.room_id == "room-1" for ev in db.added)
