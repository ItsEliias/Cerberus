"""Tests for /api/rooms/templates — preset room templates."""

import json
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

import routes.room_template_routes as rt
from routes.room_template_routes import _TEMPLATES, setup_room_template_routes


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _endpoint(method: str, path: str):
    """Return the function bound to (method, path) on the template router."""
    router = setup_room_template_routes()
    for route in router.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set()):
            return route.endpoint
    raise RuntimeError(f"{method} {path} not found")


def _request(owner: str = "alice"):
    return SimpleNamespace(state=SimpleNamespace(current_user=owner))


class _FakeDB:
    """Minimal SQLAlchemy session stub that returns the agent rows we seed."""

    def __init__(self, agent_rows):
        self._agents = agent_rows
        self.added = []
        self.committed = False

    def query(self, _model):
        rows = self._agents

        class _Q:
            def __init__(self, rows):
                self._rows = rows

            def filter(self, *_args, **_kwargs):
                return self

            def all(self):
                return self._rows

            def first(self):
                return self._rows[0] if self._rows else None

        return _Q(rows)

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        self.committed = True

    def refresh(self, obj):
        # Mimic SQLAlchemy populating server-side defaults after commit.
        if not getattr(obj, "created_at", None):
            from datetime import datetime
            obj.created_at = datetime.utcnow()
        if not getattr(obj, "mode", None):
            obj.mode = "routed"
        if not getattr(obj, "round_cap", None):
            obj.round_cap = 5
        if obj.message_count is None:
            obj.message_count = 0

    def close(self):
        pass


def _fake_agent(name: str):
    """Fake CerberusAgent row — only the fields the route reads."""
    return SimpleNamespace(id=f"agent-{name.lower()}", name=name)


# ---------------------------------------------------------------------------
# 1. list_templates returns all 7 with required fields
# ---------------------------------------------------------------------------

def test_list_templates_returns_all():
    fn = _endpoint("GET", "/api/rooms/templates")
    resp = fn()
    assert "templates" in resp
    assert len(resp["templates"]) == 7
    required = {"id", "name", "description", "icon", "agents"}
    for tpl in resp["templates"]:
        missing = required - set(tpl.keys())
        assert not missing, f"template {tpl.get('id')!r} missing {missing}"
        assert isinstance(tpl["agents"], list) and tpl["agents"]


# ---------------------------------------------------------------------------
# 2. Template IDs are unique
# ---------------------------------------------------------------------------

def test_template_ids_are_unique():
    ids = [t["id"] for t in _TEMPLATES]
    assert len(ids) == len(set(ids)), f"duplicate template ids in {ids}"


# ---------------------------------------------------------------------------
# 3. create_from_template resolves agents and writes a room
# ---------------------------------------------------------------------------

def test_create_from_template_resolves_agents():
    rows = [
        _fake_agent("ORCHESTRATOR"),
        _fake_agent("ARCHITECT"),
        _fake_agent("CODER"),
        _fake_agent("TESTER"),
        _fake_agent("REVIEWER"),
    ]
    db = _FakeDB(rows)
    fn = _endpoint("POST", "/api/rooms/templates/{template_id}/create")
    with patch("routes.room_template_routes.SessionLocal", return_value=db), \
         patch("routes.room_template_routes.require_user", return_value="alice"):
        resp = fn("ship-a-feature", _request("alice"))

    assert resp["template_id"] == "ship-a-feature"
    room = resp["room"]
    assert room["owner"] == "alice"
    assert "Ship a Feature" in room["name"]
    # Order in participant_ids must follow the template, not DB row order.
    expected = ["agent-orchestrator", "agent-architect", "agent-coder",
                "agent-tester", "agent-reviewer"]
    assert room["participant_ids"] == expected
    assert db.committed
    # A ConferenceRoom row was inserted with the JSON-encoded ids.
    assert len(db.added) == 1
    added = db.added[0]
    assert json.loads(added.participant_ids) == expected


# ---------------------------------------------------------------------------
# 4. Unknown template id → 404
# ---------------------------------------------------------------------------

def test_create_from_template_unknown_id_returns_404():
    db = _FakeDB([])
    fn = _endpoint("POST", "/api/rooms/templates/{template_id}/create")
    with patch("routes.room_template_routes.SessionLocal", return_value=db), \
         patch("routes.room_template_routes.require_user", return_value="alice"):
        with pytest.raises(HTTPException) as exc:
            fn("does-not-exist", _request("alice"))
    assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# 5. Missing agents are skipped, not 500'd
# ---------------------------------------------------------------------------

def test_create_from_template_skips_missing_agents(caplog):
    # Template asks for ORCHESTRATOR + ARCHITECT + CODER + TESTER + REVIEWER;
    # only ORCHESTRATOR exists in this owner's roster.
    db = _FakeDB([_fake_agent("ORCHESTRATOR")])
    fn = _endpoint("POST", "/api/rooms/templates/{template_id}/create")
    with patch("routes.room_template_routes.SessionLocal", return_value=db), \
         patch("routes.room_template_routes.require_user", return_value="alice"):
        resp = fn("ship-a-feature", _request("alice"))
    room = resp["room"]
    assert room["participant_ids"] == ["agent-orchestrator"]
    # Missing names should have been logged at WARNING level.
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    missing_logged = " ".join(r.message for r in warnings)
    for name in ("ARCHITECT", "CODER", "TESTER", "REVIEWER"):
        assert name in missing_logged


# ---------------------------------------------------------------------------
# 6. No agents resolve → 400
# ---------------------------------------------------------------------------

def test_create_from_template_all_missing_returns_400():
    db = _FakeDB([])  # owner has none of the template's named agents
    fn = _endpoint("POST", "/api/rooms/templates/{template_id}/create")
    with patch("routes.room_template_routes.SessionLocal", return_value=db), \
         patch("routes.room_template_routes.require_user", return_value="alice"):
        with pytest.raises(HTTPException) as exc:
            fn("ship-a-feature", _request("alice"))
    assert exc.value.status_code == 400
    # No room was ever added.
    assert db.added == []
