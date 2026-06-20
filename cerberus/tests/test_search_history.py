"""Tests for the search-history + saved-search API + recording helper."""

import sys
import uuid
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

# search_routes imports several heavy modules at import-time (services.search,
# core.middleware, etc.). Stub the ones not present in the test env so the
# module loads cleanly under the SQLAlchemy stub.
for _mod, _shape in [
    ("services.search", {"get_search_config": lambda: {}, "comprehensive_web_search": None, "PROVIDER_INFO": {}}),
    ("services.search.core", {"_call_provider": None}),
    ("services.search.providers", {"_get_provider_key": None, "_get_search_instance": None}),
]:
    if _mod not in sys.modules:
        mod = MagicMock()
        for k, v in _shape.items():
            setattr(mod, k, v)
        sys.modules[_mod] = mod

import routes.search_routes as sr
from routes.search_routes import setup_search_routes, SavedSearchCreate


# ─── Helpers ────────────────────────────────────────────────────────────────

def _endpoint(method: str, path: str):
    router = setup_search_routes(config=None)
    for route in router.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set()):
            return route.endpoint
    raise RuntimeError(f"{method} {path} not found")


def _request(owner: str = "alice"):
    return SimpleNamespace(state=SimpleNamespace(current_user=owner))


# ─── Fake DB with in-memory list backing ────────────────────────────────────

class _FakeDB:
    def __init__(self, *, history_rows=None, saved_rows=None):
        self.history = list(history_rows or [])
        self.saved   = list(saved_rows or [])
        self.added = []
        self.commits = 0
        self.closed = False

    def query(self, model):
        if "SearchHistory" in getattr(model, "__name__", ""):
            return _Q(self.history, "_history")
        if "SavedSearch" in getattr(model, "__name__", ""):
            return _Q(self.saved, "_saved")
        return _Q([], "_other")

    def add(self, obj):
        self.added.append(obj)
        if obj.__class__.__name__ == "SearchHistory":
            self.history.append(obj)
        elif obj.__class__.__name__ == "SavedSearch":
            self.saved.append(obj)

    def delete(self, obj):
        if obj in self.history: self.history.remove(obj)
        if obj in self.saved:   self.saved.remove(obj)

    def commit(self): self.commits += 1
    def refresh(self, _obj): pass
    def close(self): self.closed = True


class _Q:
    def __init__(self, rows, _kind):
        self._rows = rows
        self._owner = None
        self._id = None
        self._limit = None

    def filter(self, *args):
        # First filter captures owner; second filter captures id (when present).
        if self._owner is None:
            self._owner = _captured["owner"]
        else:
            self._id = _captured.get("entry_id")
        return self

    def order_by(self, *_a):
        self._rows.sort(key=lambda r: getattr(r, "timestamp", None) or "", reverse=True)
        return self

    def limit(self, n):
        self._limit = int(n)
        return self

    def all(self):
        out = [r for r in self._rows if getattr(r, "owner", None) == self._owner]
        if self._limit is not None:
            out = out[: self._limit]
        return out

    def first(self):
        for r in self._rows:
            if getattr(r, "owner", None) == self._owner and \
               (self._id is None or getattr(r, "id", None) == self._id):
                return r
        return None

    def delete(self, synchronize_session=False):
        removed = [r for r in self._rows if getattr(r, "owner", None) == self._owner]
        for r in removed:
            self._rows.remove(r)
        return len(removed)


_captured: dict = {"owner": None, "entry_id": None}


def _fake_history_row(*, id_=None, owner="alice", query="hello", source="web",
                     result_count=3, timestamp="2026-06-20T10:00:00"):
    return SimpleNamespace(
        __class__=type("SearchHistory", (), {}),
        id=id_ or str(uuid.uuid4()),
        owner=owner, query=query, source=source,
        result_count=result_count, timestamp=_FakeDT(timestamp),
    )


def _fake_saved_row(*, id_=None, owner="alice", query="hello", label=None,
                   timestamp="2026-06-20T10:00:00"):
    return SimpleNamespace(
        __class__=type("SavedSearch", (), {}),
        id=id_ or str(uuid.uuid4()),
        owner=owner, query=query, label=label,
        timestamp=_FakeDT(timestamp),
    )


class _FakeDT:
    def __init__(self, iso): self._iso = iso
    def __lt__(self, other): return self._iso < getattr(other, "_iso", "")
    def isoformat(self): return self._iso
    def __bool__(self): return bool(self._iso)


# ─── 1. Model has all required columns ─────────────────────────────────────

def test_search_history_model_columns():
    from core.database import SearchHistory
    assert SearchHistory.__tablename__ == "search_history"
    cols = {c.key for c in SearchHistory.__table__.columns}
    required = {"id", "owner", "query", "result_count", "timestamp", "source"}
    missing = required - cols
    assert not missing, f"SearchHistory missing columns: {missing}"


def test_saved_search_model_columns():
    from core.database import SavedSearch
    assert SavedSearch.__tablename__ == "saved_searches"
    cols = {c.key for c in SavedSearch.__table__.columns}
    required = {"id", "owner", "query", "label", "timestamp"}
    missing = required - cols
    assert not missing, f"SavedSearch missing columns: {missing}"


# ─── 2. GET /api/search/history is owner-scoped ─────────────────────────────

def test_history_get_returns_owner_scoped_rows():
    _captured["owner"] = "alice"
    db = _FakeDB(history_rows=[
        _fake_history_row(owner="alice", query="alpha"),
        _fake_history_row(owner="bob",   query="bravo"),
        _fake_history_row(owner="alice", query="charlie"),
    ])
    fn = _endpoint("GET", "/api/search/history")
    with patch("routes.search_routes.SessionLocal", return_value=db), \
         patch("routes.search_routes.require_user", return_value="alice"):
        resp = fn(_request("alice"), limit=20)
    queries = {h["query"] for h in resp["history"]}
    assert queries == {"alpha", "charlie"}
    assert "bravo" not in queries


# ─── 3. DELETE /api/search/history/{id} removes one entry ──────────────────

def test_history_delete_one_entry():
    _captured["owner"] = "alice"
    _captured["entry_id"] = "to-go"
    rows = [
        _fake_history_row(id_="to-go",  owner="alice", query="x"),
        _fake_history_row(id_="to-stay", owner="alice", query="y"),
    ]
    db = _FakeDB(history_rows=rows)
    fn = _endpoint("DELETE", "/api/search/history/{entry_id}")
    with patch("routes.search_routes.SessionLocal", return_value=db), \
         patch("routes.search_routes.require_user", return_value="alice"):
        resp = fn("to-go", _request("alice"))
    assert resp == {"deleted": "to-go"}
    remaining = {r.id for r in db.history}
    assert remaining == {"to-stay"}


def test_history_delete_unknown_returns_404():
    _captured["owner"] = "alice"
    _captured["entry_id"] = "nope"
    db = _FakeDB(history_rows=[])
    fn = _endpoint("DELETE", "/api/search/history/{entry_id}")
    with patch("routes.search_routes.SessionLocal", return_value=db), \
         patch("routes.search_routes.require_user", return_value="alice"):
        with pytest.raises(HTTPException) as exc:
            fn("nope", _request("alice"))
    assert exc.value.status_code == 404


# ─── 4. DELETE /api/search/history clears all for owner ────────────────────

def test_history_clear_only_clears_owner_rows():
    _captured["owner"] = "alice"
    rows = [
        _fake_history_row(owner="alice", query="a"),
        _fake_history_row(owner="alice", query="b"),
        _fake_history_row(owner="bob",   query="other"),
    ]
    db = _FakeDB(history_rows=rows)
    fn = _endpoint("DELETE", "/api/search/history")
    with patch("routes.search_routes.SessionLocal", return_value=db), \
         patch("routes.search_routes.require_user", return_value="alice"):
        resp = fn(_request("alice"))
    assert resp == {"removed": 2}
    # bob's row survives.
    assert any(r.owner == "bob" for r in db.history)
    assert not any(r.owner == "alice" for r in db.history)


# ─── 5. POST /api/search/saved creates an entry ────────────────────────────

def test_saved_create_persists_query_and_label():
    _captured["owner"] = "alice"
    db = _FakeDB()
    fn = _endpoint("POST", "/api/search/saved")
    body = SavedSearchCreate(query="cerberus internals", label="docs")
    with patch("routes.search_routes.SessionLocal", return_value=db), \
         patch("routes.search_routes.require_user", return_value="alice"):
        resp = fn(_request("alice"), body)
    assert resp["query"] == "cerberus internals"
    assert resp["label"] == "docs"
    assert len(db.saved) == 1
    assert db.saved[0].owner == "alice"


def test_saved_create_rejects_empty_query():
    _captured["owner"] = "alice"
    db = _FakeDB()
    fn = _endpoint("POST", "/api/search/saved")
    body = SavedSearchCreate(query="   ")
    with patch("routes.search_routes.SessionLocal", return_value=db), \
         patch("routes.search_routes.require_user", return_value="alice"):
        with pytest.raises(HTTPException) as exc:
            fn(_request("alice"), body)
    assert exc.value.status_code == 400


# ─── 6. GET /api/search/saved returns saved entries ────────────────────────

def test_saved_get_returns_owner_scoped_rows():
    _captured["owner"] = "alice"
    db = _FakeDB(saved_rows=[
        _fake_saved_row(owner="alice", query="alpha"),
        _fake_saved_row(owner="bob",   query="bravo"),
    ])
    fn = _endpoint("GET", "/api/search/saved")
    with patch("routes.search_routes.SessionLocal", return_value=db), \
         patch("routes.search_routes.require_user", return_value="alice"):
        resp = fn(_request("alice"))
    qs = {r["query"] for r in resp["saved"]}
    assert qs == {"alpha"}


def test_saved_delete_one_entry():
    _captured["owner"] = "alice"
    _captured["entry_id"] = "to-go"
    rows = [
        _fake_saved_row(id_="to-go",  owner="alice", query="x"),
        _fake_saved_row(id_="to-stay", owner="alice", query="y"),
    ]
    db = _FakeDB(saved_rows=rows)
    fn = _endpoint("DELETE", "/api/search/saved/{entry_id}")
    with patch("routes.search_routes.SessionLocal", return_value=db), \
         patch("routes.search_routes.require_user", return_value="alice"):
        resp = fn("to-go", _request("alice"))
    assert resp == {"deleted": "to-go"}
    assert {r.id for r in db.saved} == {"to-stay"}


# ─── 7. Recording failure does not propagate ────────────────────────────────

def test_record_search_history_swallows_db_factory_failure(caplog):
    """If SessionLocal() itself raises, the helper must not propagate."""
    with patch("routes.search_routes.SessionLocal",
               side_effect=RuntimeError("pool down")):
        # Must not raise.
        sr._record_search_history("alice", "hello", 5, "web")
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert any("_record_search_history failed" in r.message for r in warnings)


def test_record_search_history_swallows_commit_failure(caplog):
    """If db.commit() raises, the helper must not propagate."""
    class _BoomDB(_FakeDB):
        def commit(self):
            raise RuntimeError("disk full")
    with patch("routes.search_routes.SessionLocal", return_value=_BoomDB()):
        sr._record_search_history("alice", "hello", 5, "web")
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert any("_record_search_history failed" in r.message for r in warnings)


def test_record_search_history_skips_empty_query():
    """Empty/whitespace queries are dropped before any DB session opens."""
    db = _FakeDB()
    with patch("routes.search_routes.SessionLocal", return_value=db):
        sr._record_search_history("alice", "   ", 0, "web")
        sr._record_search_history("alice", "",    0, "web")
    assert db.added == []


# ─── 8. Owner isolation (one query covering both paths) ───────────────────

def test_owner_isolation_history_and_saved():
    """A second owner querying history + saved must not see alice's rows."""
    _captured["owner"] = "bob"
    db = _FakeDB(
        history_rows=[_fake_history_row(owner="alice", query="alice-only")],
        saved_rows=[_fake_saved_row(owner="alice", query="alice-saved")],
    )
    hist_fn  = _endpoint("GET", "/api/search/history")
    saved_fn = _endpoint("GET", "/api/search/saved")
    with patch("routes.search_routes.SessionLocal", return_value=db), \
         patch("routes.search_routes.require_user", return_value="bob"):
        hist = hist_fn(_request("bob"), limit=20)
        saved = saved_fn(_request("bob"))
    assert hist == {"history": []}
    assert saved == {"saved": []}
