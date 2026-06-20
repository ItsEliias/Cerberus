"""Tests for the voice-transcript → Notes pipeline.

GET /api/voice/sessions surfaces the caller's voice-tagged notes for the
RECENT SESSIONS strip in voice.js. The route is read-only and treats
``source = 'voice'`` (set by the frontend POST) or ``title`` starting with
``Voice session —`` (legacy notes) as the source of truth — no new schema.
"""

import sys
from datetime import datetime, timedelta
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

import routes.voice_session_routes as vsr
from routes.voice_session_routes import setup_voice_session_routes


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _endpoint(method: str, path: str):
    router = setup_voice_session_routes()
    for route in router.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set()):
            return route.endpoint
    raise RuntimeError(f"{method} {path} not found")


def _request(owner: str = "alice"):
    return SimpleNamespace(state=SimpleNamespace(current_user=owner))


def _fake_note(*, id_, owner="alice", title="", content="", source="user",
               archived=False, created_at=None):
    return SimpleNamespace(
        id=id_,
        owner=owner,
        title=title,
        content=content,
        source=source,
        archived=archived,
        created_at=created_at,
    )


class _FakeDB:
    """In-memory replay of the SQLAlchemy filter chain used by the route.

    Captures the underlying notes list and returns only those rows that pass
    the route's owner/archived/voice/title-prefix predicates, ordered newest
    first and limited per the route's `.limit(...)` call."""

    def __init__(self, notes):
        self._notes = notes

    def query(self, _model):
        return _Q(list(self._notes))

    def close(self):
        pass


class _Q:
    def __init__(self, notes):
        self._notes = notes
        self._owner = None
        self._archived = None
        self._voice = False
        self._limit = None

    def filter(self, *args):
        # The route calls .filter() four times in this order:
        #   1. Note.owner == owner            → BinaryExpression mock
        #   2. Note.archived == False         → BinaryExpression mock
        #   3. source==voice OR title LIKE …  → BooleanClauseList mock
        # We can't introspect SQLAlchemy expressions without the real ORM,
        # so we stage the predicates positionally instead.
        if self._owner is None:
            self._owner = _capture_owner(args[0])
        elif self._archived is None:
            self._archived = _capture_archived(args[0])
        else:
            self._voice = True
        return self

    def order_by(self, *_a):
        # Newest first.
        self._notes.sort(
            key=lambda n: n.created_at or datetime.min, reverse=True,
        )
        return self

    def limit(self, n):
        self._limit = int(n)
        return self

    def all(self):
        out = [
            n for n in self._notes
            if (self._owner is None or n.owner == self._owner)
            and (self._archived is None or n.archived == self._archived)
            and (
                not self._voice
                or n.source == "voice"
                or (n.title or "").startswith("Voice session —")
            )
        ]
        if self._limit is not None:
            out = out[: self._limit]
        return out


def _capture_owner(_expr):
    # We can't read the SQLAlchemy expression directly under the stubbed
    # module. Instead, plumb the caller's owner via the patched
    # require_user (test scope) and trust the route's contract that the
    # owner filter is applied first.
    return _captured["owner"]


def _capture_archived(_expr):
    return False  # route always passes archived == False


# Per-test channel for the captured owner.
_captured: dict = {"owner": None}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def _run(notes, owner="alice", limit=20):
    _captured["owner"] = owner
    fn = _endpoint("GET", "/api/voice/sessions")
    db = _FakeDB(notes)
    with patch("routes.voice_session_routes.SessionLocal", return_value=db), \
         patch("routes.voice_session_routes.require_user", return_value=owner):
        return fn(_request(owner), limit=limit)


def test_returns_200_with_sessions_array():
    """Endpoint must exist and return a `sessions` key on the happy path."""
    now = datetime.utcnow()
    notes = [
        _fake_note(id_="n1", title="Voice session — CODER",
                   content="hello world", source="voice", created_at=now),
    ]
    resp = _run(notes)
    assert "sessions" in resp
    assert isinstance(resp["sessions"], list)
    assert len(resp["sessions"]) == 1
    row = resp["sessions"][0]
    assert row["id"] == "n1"
    assert row["title"] == "Voice session — CODER"
    assert row["preview"] == "hello world"
    assert row["created_at"] is not None


def test_filters_to_voice_tagged_notes_only():
    """A note with source='user' or no voice prefix must NOT leak through."""
    now = datetime.utcnow()
    notes = [
        _fake_note(id_="voice-1", title="Voice session — CODER",
                   source="voice", content="aaa", created_at=now),
        _fake_note(id_="legacy-voice", title="Voice session — TESTER",
                   source="user", content="legacy", created_at=now),
        _fake_note(id_="random", title="Grocery list",
                   source="user", content="milk", created_at=now),
        _fake_note(id_="agent-note", title="Auto-summary",
                   source="agent", content="summary", created_at=now),
    ]
    resp = _run(notes)
    ids = {s["id"] for s in resp["sessions"]}
    assert ids == {"voice-1", "legacy-voice"}, ids


def test_sessions_are_ordered_newest_first():
    base = datetime(2026, 6, 1, 10, 0, 0)
    notes = [
        _fake_note(id_="old",    title="Voice session — A",
                   source="voice", content="x",
                   created_at=base),
        _fake_note(id_="newest", title="Voice session — C",
                   source="voice", content="x",
                   created_at=base + timedelta(hours=2)),
        _fake_note(id_="mid",    title="Voice session — B",
                   source="voice", content="x",
                   created_at=base + timedelta(hours=1)),
    ]
    resp = _run(notes)
    assert [s["id"] for s in resp["sessions"]] == ["newest", "mid", "old"]


def test_empty_result_when_no_voice_notes_exist():
    notes = [
        _fake_note(id_="n1", title="Shopping",
                   source="user", content="eggs", created_at=datetime.utcnow()),
    ]
    resp = _run(notes)
    assert resp == {"sessions": []}


def test_preview_truncates_long_content():
    long = "x" * 500
    notes = [
        _fake_note(id_="n1", title="Voice session — CODER",
                   source="voice", content=long,
                   created_at=datetime.utcnow()),
    ]
    resp = _run(notes)
    preview = resp["sessions"][0]["preview"]
    assert len(preview) == 100
    assert preview == "x" * 100


def test_archived_voice_notes_are_excluded():
    """Archived flag must keep stale notes out of the recent list."""
    now = datetime.utcnow()
    notes = [
        _fake_note(id_="active",   title="Voice session — A",
                   source="voice", archived=False, created_at=now),
        _fake_note(id_="archived", title="Voice session — B",
                   source="voice", archived=True, created_at=now),
    ]
    resp = _run(notes)
    ids = {s["id"] for s in resp["sessions"]}
    assert ids == {"active"}


def test_limit_param_is_clamped_to_max_and_min():
    """Out-of-range / non-int limits fall back to sane defaults."""
    now = datetime.utcnow()
    notes = [
        _fake_note(id_=f"n{i}", title="Voice session — A",
                   source="voice", content=f"row{i}",
                   created_at=now - timedelta(seconds=i))
        for i in range(120)
    ]
    # limit = 200 → clamp to _MAX_LIMIT (100)
    assert len(_run(notes, limit=200)["sessions"]) == 100
    # limit = 0 → clamp to 1
    assert len(_run(notes, limit=0)["sessions"]) == 1
    # limit = 5 → 5
    assert len(_run(notes, limit=5)["sessions"]) == 5
