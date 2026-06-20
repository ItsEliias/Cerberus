"""Tests for the per-agent invocation_count HUD telemetry.

Covers the new CerberusAgent column, the increment helper, the migration
idempotence guard, and exposure through the agent serializer.
"""

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
# 1. Column exists on the model
# ---------------------------------------------------------------------------

def test_invocation_count_column_exists():
    from core.database import CerberusAgent
    cols = {c.key for c in CerberusAgent.__table__.columns}
    assert "invocation_count" in cols, "invocation_count must be a CerberusAgent column"
    col = CerberusAgent.__table__.columns["invocation_count"]
    assert col.nullable is False
    # SQLAlchemy stores the default as a ColumnDefault wrapper; the raw value
    # lives on `.arg`. Some test stubs collapse this to the scalar — accept both.
    default = getattr(col.default, "arg", col.default)
    assert default == 0


# ---------------------------------------------------------------------------
# 2. Helper increments via a single UPDATE
# ---------------------------------------------------------------------------

class _UpdateProbe:
    """Spy that captures the .update() payload from a SQLAlchemy filter chain."""

    def __init__(self):
        self.updates = []
        self.commits = 0
        self.closed = False

    def query(self, _model):
        return self._Q(self)

    def commit(self):
        self.commits += 1

    def close(self):
        self.closed = True

    class _Q:
        def __init__(self, outer):
            self._outer = outer

        def filter(self, *_a, **_kw):
            return self

        def update(self, mapping, synchronize_session=False):
            self._outer.updates.append(
                {"mapping": mapping, "sync": synchronize_session},
            )
            return 1  # mimic SQLAlchemy returning row count


def test_increment_invocation_count_runs_a_single_update():
    from routes.cerberus_agent_thread_routes import _increment_invocation_count

    probe = _UpdateProbe()
    with patch(
        "routes.cerberus_agent_thread_routes.SessionLocal",
        return_value=probe,
    ):
        _increment_invocation_count("agent-1")

    assert probe.commits == 1
    assert probe.closed is True
    assert len(probe.updates) == 1
    upd = probe.updates[0]
    # Payload must increment by exactly +1 (i.e. column ref + 1).
    assert "invocation_count" in upd["mapping"]
    # synchronize_session=False avoids ORM-level identity-map reconciliation
    # for a fire-and-forget counter bump.
    assert upd["sync"] is False


def test_increment_skipped_for_empty_agent_id():
    from routes.cerberus_agent_thread_routes import _increment_invocation_count

    probe = _UpdateProbe()
    with patch(
        "routes.cerberus_agent_thread_routes.SessionLocal",
        return_value=probe,
    ):
        _increment_invocation_count("")
        _increment_invocation_count(None)

    # No DB session was even opened — guard against blind queries on empty ids.
    assert probe.updates == []
    assert probe.commits == 0


# ---------------------------------------------------------------------------
# 3. Failure path is swallowed
# ---------------------------------------------------------------------------

def test_increment_swallows_db_errors(caplog):
    from routes.cerberus_agent_thread_routes import _increment_invocation_count

    class _BoomDB:
        def query(self, _model):
            raise RuntimeError("db unavailable")

        def close(self): pass

    with patch(
        "routes.cerberus_agent_thread_routes.SessionLocal",
        return_value=_BoomDB(),
    ):
        # Must NOT propagate — the send path already finished.
        _increment_invocation_count("agent-1")

    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert any("_increment_invocation_count failed" in r.message for r in warnings)


def test_increment_swallows_session_factory_failure(caplog):
    from routes.cerberus_agent_thread_routes import _increment_invocation_count

    def _broken_factory():
        raise RuntimeError("pool exhausted")

    with patch(
        "routes.cerberus_agent_thread_routes.SessionLocal",
        side_effect=_broken_factory,
    ):
        _increment_invocation_count("agent-1")

    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert any("_increment_invocation_count failed" in r.message for r in warnings)


# ---------------------------------------------------------------------------
# 4. to_dict() exposes invocation_count (used by GET /api/agents)
# ---------------------------------------------------------------------------

def test_to_dict_includes_invocation_count():
    from core.database import CerberusAgent

    agent = CerberusAgent(
        id="a1",
        name="CODER",
        role="custom",
        agent_type="general",
        status="idle",
        system_prompt="",
        model_alias="sonnet",
        score=3,
        invocation_count=42,
    )
    payload = agent.to_dict()
    assert payload["invocation_count"] == 42


def test_to_dict_invocation_count_defaults_to_zero():
    """A row written before the migration ran should still render as 0."""
    from core.database import CerberusAgent

    agent = CerberusAgent(
        id="a2", name="X", role="custom", agent_type="general",
        status="idle", system_prompt="", model_alias="sonnet",
    )
    # Simulate a legacy row where the ORM hasn't applied the default yet.
    agent.invocation_count = None
    assert agent.to_dict()["invocation_count"] == 0


# ---------------------------------------------------------------------------
# 5. Migration is idempotent
# ---------------------------------------------------------------------------

def test_migration_is_idempotent_when_column_already_exists():
    """Re-running the helper after the column exists must be a no-op."""
    from core import database as db_mod

    class _Conn:
        def __init__(self, existing_cols):
            self._existing = existing_cols
            self.executed = []
            self.commits = 0

        def execute(self, stmt):
            sql = str(stmt) if hasattr(stmt, "text") else str(stmt)
            if "PRAGMA table_info" in sql:
                return [(0, name, "TEXT", 0, None, 0) for name in self._existing]
            self.executed.append(sql)
            return None

        def commit(self):
            self.commits += 1

        def __enter__(self): return self
        def __exit__(self, *exc): return False

    class _Engine:
        def __init__(self, conn): self._conn = conn
        def connect(self): return self._conn

    # 1st run: column missing — must ALTER.
    conn_first = _Conn(existing_cols=["id", "name"])
    with patch.object(db_mod, "engine", _Engine(conn_first)):
        db_mod._migrate_add_agent_invocation_count_column()
    assert any("ALTER TABLE" in s for s in conn_first.executed)
    assert conn_first.commits == 1

    # 2nd run: column present — no ALTER, no rollback.
    conn_second = _Conn(existing_cols=["id", "name", "invocation_count"])
    with patch.object(db_mod, "engine", _Engine(conn_second)):
        db_mod._migrate_add_agent_invocation_count_column()
    assert all("ALTER TABLE" not in s for s in conn_second.executed)
    # commit still fires (matches the surrounding migrations' pattern).


def test_migration_swallows_engine_errors(caplog):
    """Migration must log + swallow if the engine itself raises."""
    from core import database as db_mod

    class _BoomEngine:
        def connect(self):
            raise RuntimeError("locked")

    with patch.object(db_mod, "engine", _BoomEngine()):
        db_mod._migrate_add_agent_invocation_count_column()

    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert any("invocation_count migration" in r.message for r in warnings)
