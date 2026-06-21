"""Python-side tests for the council-presets + changelog endpoints.

Five spec invariants (i18n itself is exercised by the JS test file):
  1. POST /api/council/presets creates a preset.
  2. GET  /api/council/presets returns the owner-scoped list.
  3. DELETE /api/council/presets/{id} removes the preset.
  4. POST /api/council/presets/{id}/create-room creates a room.
  5. GET  /api/changelog returns content + generated flag.

Fast lane. Uses the file-backed NullPool engine pattern from
tests/test_tasks_active_endpoint.py so DB writes in the test are
visible to the route's SessionLocal() reads (the conftest's :memory:
SQLite default gives each connection its own DB).
"""

import asyncio
import json
import os
import sys
import tempfile
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from tests.helpers.import_state import clear_fake_database_modules

clear_fake_database_modules()

import core.database as cdb
import routes.council_preset_routes as preset_routes
import routes.changelog_routes as changelog_routes
from core.database import CerberusAgent, ConferenceRoom, CouncilPreset


# ── Shared file-backed SQLite ──────────────────────────────────────────

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)
preset_routes.SessionLocal = _TS


# ── Helpers ────────────────────────────────────────────────────────────

def _req(user="alice"):
    return SimpleNamespace(state=SimpleNamespace(current_user=user))


def _endpoint(method, path):
    preset_routes.SessionLocal = _TS
    router = preset_routes.setup_council_preset_routes()
    for route in router.routes:
        if (
            getattr(route, "path", None) == path
            and method in getattr(route, "methods", set())
        ):
            return route.endpoint
    raise RuntimeError(f"{method} {path} not registered")


def _seed_agent(owner, name):
    db = _TS()
    try:
        db.add(CerberusAgent(
            id=f"agent-{owner}-{name}-{uuid.uuid4().hex[:6]}",
            owner=owner, name=name,
            role="custom", agent_type="general", status="active",
            system_prompt="", model_alias="sonnet",
        ))
        db.commit()
    finally:
        db.close()


def _make_create_body(name="Ship Team", description="My fav team",
                      agent_names=("ORCHESTRATOR", "CODER", "TESTER")):
    return preset_routes.CouncilPresetCreate(
        name=name, description=description, agent_names=list(agent_names),
    )


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    db = _TS()
    try:
        db.query(CouncilPreset).delete()
        db.query(ConferenceRoom).delete()
        db.query(CerberusAgent).delete()
        db.commit()
    finally:
        db.close()


# ── 1. POST creates a preset ───────────────────────────────────────────

def test_create_preset_writes_row():
    fn = _endpoint("POST", "/api/council/presets")
    resp = fn(_req("alice"), _make_create_body())
    assert resp["name"] == "Ship Team"
    assert resp["description"] == "My fav team"
    assert resp["agent_names"] == ["ORCHESTRATOR", "CODER", "TESTER"]
    assert resp["agent_count"] == 3
    assert resp["owner"] == "alice"

    db = _TS()
    try:
        row = db.query(CouncilPreset).filter(CouncilPreset.id == resp["id"]).first()
    finally:
        db.close()
    assert row is not None
    assert row.owner == "alice"
    assert json.loads(row.agent_names) == ["ORCHESTRATOR", "CODER", "TESTER"]


def test_create_preset_rejects_empty_name():
    from fastapi import HTTPException
    fn = _endpoint("POST", "/api/council/presets")
    with pytest.raises(HTTPException) as ei:
        fn(_req("alice"), _make_create_body(name="   "))
    assert ei.value.status_code == 400


def test_create_preset_rejects_empty_agent_list():
    from fastapi import HTTPException
    fn = _endpoint("POST", "/api/council/presets")
    with pytest.raises(HTTPException) as ei:
        fn(_req("alice"), _make_create_body(agent_names=[]))
    assert ei.value.status_code == 400


# ── 2. GET returns owner-scoped list ───────────────────────────────────

def test_list_presets_owner_scoped():
    create = _endpoint("POST", "/api/council/presets")
    create(_req("alice"), _make_create_body(name="Alice A"))
    create(_req("alice"), _make_create_body(name="Alice B"))
    create(_req("bob"),   _make_create_body(name="Bob X"))

    fn = _endpoint("GET", "/api/council/presets")
    alice_body = fn(_req("alice"))
    names = {p["name"] for p in alice_body["presets"]}
    assert names == {"Alice A", "Alice B"}

    bob_body = fn(_req("bob"))
    assert {p["name"] for p in bob_body["presets"]} == {"Bob X"}


# ── 3. DELETE removes the preset ───────────────────────────────────────

def test_delete_preset_removes_row():
    create = _endpoint("POST", "/api/council/presets")
    resp = create(_req("alice"), _make_create_body())
    rid = resp["id"]

    fn = _endpoint("DELETE", "/api/council/presets/{preset_id}")
    out = fn(_req("alice"), rid)
    assert out == {"status": "deleted", "id": rid}

    db = _TS()
    try:
        assert db.query(CouncilPreset).filter(CouncilPreset.id == rid).first() is None
    finally:
        db.close()


def test_delete_unknown_preset_returns_404():
    from fastapi import HTTPException
    fn = _endpoint("DELETE", "/api/council/presets/{preset_id}")
    with pytest.raises(HTTPException) as ei:
        fn(_req("alice"), "missing")
    assert ei.value.status_code == 404


def test_delete_other_owners_preset_returns_404():
    from fastapi import HTTPException
    create = _endpoint("POST", "/api/council/presets")
    resp = create(_req("bob"), _make_create_body(name="Bob Pet"))
    fn = _endpoint("DELETE", "/api/council/presets/{preset_id}")
    with pytest.raises(HTTPException) as ei:
        fn(_req("alice"), resp["id"])
    assert ei.value.status_code == 404


# ── 4. POST .../create-room spins up a real ConferenceRoom ─────────────

def test_create_room_from_preset_inserts_conference_room():
    # Seed agents the preset references — otherwise create-room 400s.
    _seed_agent("alice", "ORCHESTRATOR")
    _seed_agent("alice", "CODER")
    _seed_agent("alice", "TESTER")

    create = _endpoint("POST", "/api/council/presets")
    resp = create(_req("alice"), _make_create_body())
    rid = resp["id"]

    fn = _endpoint("POST", "/api/council/presets/{preset_id}/create-room")
    out = fn(_req("alice"), rid)
    assert "room" in out
    room = out["room"]
    assert room["owner"] == "alice"
    assert room["name"].startswith("Ship Team — ")
    # participant_ids was JSON-encoded on insert and decoded by _room_dict
    assert isinstance(room["participant_ids"], list)
    assert len(room["participant_ids"]) == 3

    # Real DB row exists
    db = _TS()
    try:
        cr = db.query(ConferenceRoom).filter(ConferenceRoom.id == room["id"]).first()
    finally:
        db.close()
    assert cr is not None
    assert cr.owner == "alice"


def test_create_room_skips_missing_agents_but_400s_if_all_missing():
    from fastapi import HTTPException
    # No agents seeded → none of the preset names resolve → 400.
    create = _endpoint("POST", "/api/council/presets")
    resp = create(_req("alice"), _make_create_body())
    fn = _endpoint("POST", "/api/council/presets/{preset_id}/create-room")
    with pytest.raises(HTTPException) as ei:
        fn(_req("alice"), resp["id"])
    assert ei.value.status_code == 400


# ── 5. GET /api/changelog returns content + generated flag ─────────────

def _changelog_endpoint(method, path):
    router = changelog_routes.setup_changelog_routes()
    for route in router.routes:
        if (
            getattr(route, "path", None) == path
            and method in getattr(route, "methods", set())
        ):
            return route.endpoint
    raise RuntimeError(f"{method} {path} not registered")


@pytest.fixture(autouse=True)
def _patch_changelog_auth(monkeypatch):
    # Module imports `from src.auth_helpers import require_user`, so the
    # binding to patch is on the routes module itself.
    monkeypatch.setattr(changelog_routes, "require_user", lambda req: "alice")


def test_changelog_returns_content_and_generated_flag():
    fn = _changelog_endpoint("GET", "/api/changelog")
    body = fn(_req("alice"))
    assert isinstance(body, dict)
    assert set(body.keys()) == {"content", "generated"}
    assert isinstance(body["content"], str)
    assert isinstance(body["generated"], bool)
    # No CHANGELOG.md in this repo → git-log fallback → generated=True
    assert body["generated"] is True
    assert len(body["content"]) > 0


def test_changelog_reads_file_when_present(monkeypatch, tmp_path):
    # Drop a temporary CHANGELOG.md and point the search there.
    cl = tmp_path / "CHANGELOG.md"
    cl.write_text("# Hand-written changelog\n\n- v1.0 — initial\n", encoding="utf-8")
    monkeypatch.setattr(
        changelog_routes, "_candidate_roots", lambda: [tmp_path]
    )
    fn = _changelog_endpoint("GET", "/api/changelog")
    body = fn(_req("alice"))
    assert body["generated"] is False
    assert "Hand-written changelog" in body["content"]
