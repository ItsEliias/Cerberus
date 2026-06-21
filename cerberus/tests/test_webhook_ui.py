"""Tests for the WEBHOOKS section in the CC WORKSPACE tab.

Five spec invariants:
  1. GET  /api/webhooks      → 200 with the documented shape.
  2. POST /api/webhooks      → creates a Webhook row with the form fields.
  3. DELETE /api/webhooks/{id} → removes the row.
  4. PATCH /api/webhooks/{id} → flips `is_active`.
  5. POST /api/webhooks/{id}/test → returns the existing
     {"status": "sent"} shape (the test endpoint already exists in
     routes/webhook_routes.py, so the spec's "add it if missing" branch
     does not apply; assertions follow the real contract).

Fast lane. File-backed NullPool engine pattern from
tests/test_tasks_active_endpoint.py — the conftest `:memory:` default
gives each connection its own DB and would mask test-side seeds.

Webhook routes require admin auth (`_require_admin`); we patch that to
a no-op so the test focuses on each handler's transition logic.
`webhook_manager.deliver_test` is stubbed to avoid real HTTP.
"""

import asyncio
import os
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

# The conftest installs a partial fake `src.database` that only carries
# SessionLocal + ModelEndpoint. webhook_routes → src.webhook_manager →
# `from src.database import Webhook`, which fails against that stub.
# Evict the stub and force a fresh import of the real shim (which re-exports
# core.database, including Webhook) before pulling routes.webhook_routes.
sys.modules.pop("src.webhook_manager", None)
sys.modules.pop("src.database", None)
import src.database  # noqa: F401, E402 — real shim now resolves

import core.database as cdb  # noqa: E402
import routes.webhook_routes as webhook_routes  # noqa: E402
from core.database import Webhook  # noqa: E402


# ── Shared file-backed SQLite ──────────────────────────────────────────────

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)
webhook_routes.SessionLocal = _TS


# ── Helpers ────────────────────────────────────────────────────────────────

def _req():
    return SimpleNamespace(state=SimpleNamespace(current_user="admin"))


@pytest.fixture
def webhook_manager():
    """The route uses webhook_manager.deliver_test; stub it as AsyncMock so
    POST /test resolves without firing a real HTTP request."""
    wm = MagicMock()
    wm.deliver_test = AsyncMock(return_value=None)
    return wm


@pytest.fixture(autouse=True)
def _patch_admin_gate(monkeypatch):
    """_require_admin is imported into webhook_routes at module load — patch
    the binding there so every handler treats the caller as admin."""
    monkeypatch.setattr(webhook_routes, "_require_admin", lambda req: None)


def _endpoint(method, path, webhook_mgr):
    webhook_routes.SessionLocal = _TS
    # webhook_routes.router is module-level; each setup_webhook_routes() call
    # APPENDS the same routes again with a fresh `webhook_manager` closure.
    # Wipe its routes first so the (method, path) lookup below returns the
    # closure bound to THIS test's fixture, not a stale one from earlier
    # tests in the same process.
    webhook_routes.router.routes.clear()
    router = webhook_routes.setup_webhook_routes(
        webhook_mgr,
        auth_manager=MagicMock(),
        session_manager=None,
        api_key_manager=None,
    )
    for route in router.routes:
        if (
            getattr(route, "path", None) == path
            and method in getattr(route, "methods", set())
        ):
            return route.endpoint
    raise RuntimeError(f"{method} {path} not registered")


def _seed_webhook(*, webhook_id, name="Hook", url="https://example.com/hook",
                   events="chat.completed", is_active=True, secret=None):
    db = _TS()
    try:
        db.add(Webhook(
            id=webhook_id, name=name, url=url, events=events,
            is_active=is_active, secret=secret,
        ))
        db.commit()
    finally:
        db.close()


def _get_webhook(webhook_id):
    db = _TS()
    try:
        return db.query(Webhook).filter(Webhook.id == webhook_id).first()
    finally:
        db.close()


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    db = _TS()
    try:
        db.query(Webhook).delete()
        db.commit()
    finally:
        db.close()


# ───────────────────────────────────────────────────────────────────────────
# 1. GET /api/webhooks returns the documented shape
# ───────────────────────────────────────────────────────────────────────────

def test_list_webhooks_returns_correct_shape(webhook_manager):
    _seed_webhook(webhook_id="w-1", name="Slack", url="https://slack.example.com/hooks/abc",
                  events="chat.completed,session.created", is_active=True, secret="s1")
    _seed_webhook(webhook_id="w-2", name="Discord", url="https://discord.example.com/api/webhook/xyz",
                  events="chat.message", is_active=False)
    fn = _endpoint("GET", "/api/webhooks", webhook_manager)
    rows = fn(_req())
    assert isinstance(rows, list)
    assert len(rows) == 2
    ids = {r["id"] for r in rows}
    assert ids == {"w-1", "w-2"}

    # Per webhook_routes.py:78-92 — explicit projection.
    sample = next(r for r in rows if r["id"] == "w-1")
    expected = {
        "id", "name", "url", "has_secret", "events",
        "is_active", "last_triggered_at", "last_status_code",
        "last_error", "created_at",
    }
    assert expected <= set(sample.keys())
    # Events come back as a list (CSV split by the route)
    assert sample["events"] == ["chat.completed", "session.created"]
    assert sample["has_secret"] is True
    assert sample["is_active"] is True

    other = next(r for r in rows if r["id"] == "w-2")
    assert other["events"] == ["chat.message"]
    assert other["has_secret"] is False
    assert other["is_active"] is False


# ───────────────────────────────────────────────────────────────────────────
# 2. POST creates a webhook with the form fields
# ───────────────────────────────────────────────────────────────────────────

def test_create_webhook_writes_row(monkeypatch, webhook_manager):
    # validate_webhook_url does DNS resolution and rejects URLs whose
    # hostname doesn't resolve (fail-closed at _is_private_url:107). The
    # CI environment may not resolve "example.com" → identity-stub the
    # validator so the test focuses on the route's row-write logic, not
    # network conditions. URL security is exercised in dedicated tests.
    monkeypatch.setattr(webhook_routes, "validate_webhook_url", lambda u: u)
    fn = _endpoint("POST", "/api/webhooks", webhook_manager)
    # Form fields exactly as the WORKSPACE form sends them.
    resp = fn(
        _req(),
        name="My Webhook",
        url="https://example.com/hook",
        secret="topsecret",
        events="chat.completed,session.created",
    )
    assert "id" in resp
    assert resp["name"] == "My Webhook"

    row = _get_webhook(resp["id"])
    assert row is not None
    assert row.name == "My Webhook"
    assert row.url == "https://example.com/hook"
    # Stored as CSV string on the row (not exploded list).
    assert row.events == "chat.completed,session.created"
    assert row.is_active is True
    # Secret stored encrypted/plain depending on api_key_manager availability;
    # the unit-test path passes None for api_key_manager so the secret falls
    # through as the literal value. Just confirm SOMETHING is persisted.
    assert row.secret == "topsecret"


def test_create_webhook_rejects_empty_name(webhook_manager):
    fn = _endpoint("POST", "/api/webhooks", webhook_manager)
    with pytest.raises(Exception) as ei:
        fn(_req(), name="", url="https://x", secret="", events="chat.completed")
    assert getattr(ei.value, "status_code", None) == 400


def test_create_webhook_rejects_unknown_event(webhook_manager):
    fn = _endpoint("POST", "/api/webhooks", webhook_manager)
    with pytest.raises(Exception) as ei:
        fn(_req(), name="X", url="https://example.com/hook",
            secret="", events="not.a.real.event")
    assert getattr(ei.value, "status_code", None) == 400


# ───────────────────────────────────────────────────────────────────────────
# 3. DELETE removes the row
# ───────────────────────────────────────────────────────────────────────────

def test_delete_webhook_removes_row(webhook_manager):
    _seed_webhook(webhook_id="w-del")
    assert _get_webhook("w-del") is not None
    fn = _endpoint("DELETE", "/api/webhooks/{webhook_id}", webhook_manager)
    resp = fn(_req(), "w-del")
    assert resp == {"status": "deleted"}
    assert _get_webhook("w-del") is None


def test_delete_unknown_webhook_returns_404(webhook_manager):
    fn = _endpoint("DELETE", "/api/webhooks/{webhook_id}", webhook_manager)
    with pytest.raises(Exception) as ei:
        fn(_req(), "missing")
    assert getattr(ei.value, "status_code", None) == 404


# ───────────────────────────────────────────────────────────────────────────
# 4. PATCH toggles is_active
# ───────────────────────────────────────────────────────────────────────────

def test_toggle_webhook_flips_active(webhook_manager):
    _seed_webhook(webhook_id="w-t", is_active=True)
    fn = _endpoint("PATCH", "/api/webhooks/{webhook_id}", webhook_manager)

    resp = fn(_req(), "w-t")
    assert resp == {"id": "w-t", "is_active": False}
    assert _get_webhook("w-t").is_active is False

    # Toggling again flips back to True
    resp2 = fn(_req(), "w-t")
    assert resp2 == {"id": "w-t", "is_active": True}
    assert _get_webhook("w-t").is_active is True


def test_toggle_unknown_webhook_returns_404(webhook_manager):
    fn = _endpoint("PATCH", "/api/webhooks/{webhook_id}", webhook_manager)
    with pytest.raises(Exception) as ei:
        fn(_req(), "missing")
    assert getattr(ei.value, "status_code", None) == 404


# ───────────────────────────────────────────────────────────────────────────
# 5. POST /api/webhooks/{id}/test returns the {status: "sent"} shape
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_test_webhook_calls_manager_and_returns_sent(webhook_manager):
    _seed_webhook(webhook_id="w-ping", url="https://example.com/ping",
                  secret="signing-key")
    fn = _endpoint("POST", "/api/webhooks/{webhook_id}/test", webhook_manager)
    resp = await fn(_req(), "w-ping")
    assert resp == {"status": "sent"}
    # The route is supposed to delegate the actual delivery to webhook_manager.
    webhook_manager.deliver_test.assert_awaited_once()
    args, _ = webhook_manager.deliver_test.call_args
    assert args[0] == "w-ping"
    assert args[1] == "https://example.com/ping"
    assert args[2] == "signing-key"


@pytest.mark.asyncio
async def test_test_unknown_webhook_returns_404(webhook_manager):
    fn = _endpoint("POST", "/api/webhooks/{webhook_id}/test", webhook_manager)
    with pytest.raises(Exception) as ei:
        await fn(_req(), "missing")
    assert getattr(ei.value, "status_code", None) == 404
    webhook_manager.deliver_test.assert_not_called()
