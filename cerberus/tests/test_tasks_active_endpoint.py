"""Regression test for GET /api/tasks/active 500 caused by t.agent attr error.

ScheduledTask exposes ``crew_member_id`` (the agent reference), not ``agent``.
The endpoint used to read ``t.agent`` which raised AttributeError on every
request and produced 500 responses.
"""

import tempfile
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from tests.helpers.import_state import clear_fake_database_modules

clear_fake_database_modules()

import core.database as cdb
import routes.task_routes as task_routes
from core.database import ScheduledTask

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)
task_routes.SessionLocal = _TS


def _req(user="alice"):
    return SimpleNamespace(state=SimpleNamespace(current_user=user))


def _endpoint(method, path):
    task_routes.SessionLocal = _TS
    router = task_routes.setup_task_routes(MagicMock())
    for route in router.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set()):
            return route.endpoint
    raise RuntimeError(f"{method} {path} not found")


def _seed_active_task(task_id, owner, crew_member_id):
    db = _TS()
    try:
        task = ScheduledTask(
            id=task_id,
            owner=owner,
            name=task_id,
            prompt="do work",
            task_type="llm",
            trigger_type="schedule",
            status="active",
            output_target="session",
            crew_member_id=crew_member_id,
        )
        db.add(task)
        db.commit()
    finally:
        db.close()


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    db = _TS()
    try:
        db.query(ScheduledTask).delete()
        db.commit()
    finally:
        db.close()


def test_active_returns_200_with_agent_from_crew_member_id():
    _seed_active_task("task-1", "alice", "agent-1")
    fn = _endpoint("GET", "/api/tasks/active")
    resp = fn(_req("alice"))
    assert "tasks" in resp
    assert len(resp["tasks"]) == 1
    row = resp["tasks"][0]
    assert row["id"] == "task-1"
    assert row["agent"] == "agent-1"
    assert row["status"] == "active"


def test_active_returns_none_agent_when_crew_member_id_missing():
    _seed_active_task("task-2", "alice", None)
    fn = _endpoint("GET", "/api/tasks/active")
    resp = fn(_req("alice"))
    assert len(resp["tasks"]) == 1
    assert resp["tasks"][0]["agent"] is None


def test_active_does_not_reference_t_agent():
    """The renamed column means t.agent must not appear in get_active_tasks."""
    import inspect
    src = inspect.getsource(task_routes)
    assert "t.agent" not in src, (
        "ScheduledTask has no `agent` column — use `crew_member_id`"
    )
