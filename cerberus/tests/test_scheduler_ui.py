"""Tests for the SCHEDULED TASKS section in the CC WORKSPACE tab.

Five spec invariants:
  1. GET  /api/tasks            → 200 with the seeded task listed.
  2. POST /api/tasks            → creates a task with the fields the UI sends.
  3. POST /api/tasks/{id}/pause → sets status to "paused".
  4. POST /api/tasks/{id}/resume→ sets status to "active".
  5. DELETE /api/tasks/{id}     → removes the task from the DB.

Fast lane. Mirrors the file-backed-tmpdb pattern already used by
test_tasks_active_endpoint.py — avoids the conftest's `:memory:` SQLite
trap where each connection gets its own database. Endpoints are pulled
out of the router and called directly as Python functions; FastAPI/HTTP
is not exercised at this layer (the JS code that hits the URLs is
covered separately by the node `--check` syntax pass + manual test plan).
"""

import asyncio
import tempfile
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from tests.helpers.import_state import clear_fake_database_modules

clear_fake_database_modules()

import core.database as cdb
import routes.task_routes as task_routes
from core.database import ScheduledTask


# ---------------------------------------------------------------------------
# Shared file-backed SQLite (NullPool → no shared in-memory weirdness).
# ---------------------------------------------------------------------------

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)
task_routes.SessionLocal = _TS


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _req(user="alice"):
    return SimpleNamespace(state=SimpleNamespace(current_user=user))


def _scheduler():
    """task_scheduler is required by the list endpoint
    (`await task_scheduler.ensure_defaults(user)`). Mock the methods the
    routes actually touch — everything else is unused in these tests."""
    sched = MagicMock()
    sched.ensure_defaults = AsyncMock(return_value=None)
    return sched


def _endpoint(method, path):
    # Always reset the SessionLocal monkey-patch — other tests in the same
    # process may have rebound it via clear_fake_database_modules().
    task_routes.SessionLocal = _TS
    router = task_routes.setup_task_routes(_scheduler())
    for route in router.routes:
        if (
            getattr(route, "path", None) == path
            and method in getattr(route, "methods", set())
        ):
            return route.endpoint
    raise RuntimeError(f"{method} {path} not found")


def _seed_task(task_id, owner="alice", schedule="daily", scheduled_time="09:00",
               status="active", trigger_type="schedule"):
    db = _TS()
    try:
        db.add(ScheduledTask(
            id=task_id,
            owner=owner,
            name=task_id,
            prompt="do work",
            task_type="llm",
            trigger_type=trigger_type,
            schedule=schedule,
            scheduled_time=scheduled_time,
            status=status,
            output_target="session",
        ))
        db.commit()
    finally:
        db.close()


def _get_task(task_id):
    db = _TS()
    try:
        return db.query(ScheduledTask).filter(ScheduledTask.id == task_id).first()
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


# ---------------------------------------------------------------------------
# 1. GET /api/tasks returns the seeded task
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_list_endpoint_returns_seeded_task():
    _seed_task("task-list-1", owner="alice")
    fn = _endpoint("GET", "/api/tasks")
    resp = await fn(_req("alice"))
    assert isinstance(resp, dict)
    assert "tasks" in resp
    assert isinstance(resp["tasks"], list)
    ids = [t["id"] for t in resp["tasks"]]
    assert "task-list-1" in ids

    row = next(t for t in resp["tasks"] if t["id"] == "task-list-1")
    # The fields the CC card renders.
    assert row["name"] == "task-list-1"
    assert row["schedule"] == "daily"
    assert row["scheduled_time"] == "09:00"
    assert row["status"] == "active"


# ---------------------------------------------------------------------------
# 2. POST /api/tasks creates a task with the UI's fields
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_endpoint_writes_task_row():
    fn = _endpoint("POST", "/api/tasks")
    # Match exactly the body the WORKSPACE form sends.
    req_model = task_routes.TaskCreate(
        name="Morning brief",
        prompt="Summarise overnight notes",
        task_type="llm",
        trigger_type="schedule",
        schedule="daily",
        scheduled_time="07:30",
    )
    resp = await fn(_req("alice"), req_model)
    assert resp["name"] == "Morning brief"
    assert resp["schedule"] == "daily"
    assert resp["scheduled_time"] == "07:30"
    assert resp["status"] == "active"          # recurring schedule → active

    # Confirm the row is real, not just an echo
    row = _get_task(resp["id"])
    assert row is not None
    assert row.owner == "alice"
    assert row.prompt == "Summarise overnight notes"
    assert row.task_type == "llm"
    assert row.schedule == "daily"
    assert row.scheduled_time == "07:30"
    assert row.status == "active"


# ---------------------------------------------------------------------------
# 3. POST /api/tasks/{id}/pause sets status="paused"
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pause_endpoint_sets_status_paused():
    _seed_task("task-pause-1", owner="alice", status="active")
    fn = _endpoint("POST", "/api/tasks/{task_id}/pause")
    resp = await fn(_req("alice"), "task-pause-1")
    assert resp == {"ok": True, "status": "paused"}
    assert _get_task("task-pause-1").status == "paused"


# ---------------------------------------------------------------------------
# 4. POST /api/tasks/{id}/resume sets status="active"
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_resume_endpoint_sets_status_active():
    _seed_task("task-resume-1", owner="alice", status="paused")
    fn = _endpoint("POST", "/api/tasks/{task_id}/resume")
    resp = await fn(_req("alice"), "task-resume-1")
    assert resp["ok"] is True
    assert resp["status"] == "active"
    # next_run is computed by compute_next_run() — a real datetime, ISO-rendered
    # with a 'Z' suffix. The exact value depends on wall-clock, so just assert
    # shape.
    assert isinstance(resp.get("next_run"), (str, type(None)))
    if resp.get("next_run"):
        assert resp["next_run"].endswith("Z")
    assert _get_task("task-resume-1").status == "active"


# ---------------------------------------------------------------------------
# 5. DELETE /api/tasks/{id} removes the row
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_delete_endpoint_removes_row():
    _seed_task("task-delete-1", owner="alice")
    assert _get_task("task-delete-1") is not None
    fn = _endpoint("DELETE", "/api/tasks/{task_id}")
    resp = await fn(_req("alice"), "task-delete-1")
    assert resp == {"ok": True}
    assert _get_task("task-delete-1") is None
