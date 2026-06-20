"""Tests for GET /api/stats/activity — daily message/session aggregation.

The route powers the dashboard heatmap. These cover the response schema, the
missing-date back-fill, the streak math, the `days` parameter clamp, and the
empty-history degenerate case.
"""

import sys
from datetime import date, datetime, timedelta
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

import routes.activity_routes as ar
from routes.activity_routes import setup_activity_routes


def _endpoint(method: str, path: str):
    router = setup_activity_routes()
    for route in router.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set()):
            return route.endpoint
    raise RuntimeError(f"{method} {path} not found")


def _request(owner: str = "alice"):
    return SimpleNamespace(state=SimpleNamespace(current_user=owner))


# ---------------------------------------------------------------------------
# Fake DB — replays the route's exact query chain twice:
#   1. The per-day GROUP BY → returns the seeded rows
#   2. The total-distinct-sessions SCALAR → returns total_sessions
# ---------------------------------------------------------------------------

class _FakeDB:
    def __init__(self, *, day_rows, total_sessions):
        self._day_rows = day_rows
        self._total_sessions = total_sessions
        self._query_count = 0
        self.closed = False

    def query(self, *_args, **_kw):
        self._query_count += 1
        # Route calls .query() twice — first the per-day aggregation, then the
        # distinct-session scalar. The chain shape differs (.all vs .scalar),
        # so this single returner covers both.
        return _Q(self._day_rows, self._total_sessions, self._query_count)

    def close(self):
        self.closed = True


class _Q:
    def __init__(self, day_rows, total_sessions, query_num):
        self._day_rows = day_rows
        self._total_sessions = total_sessions
        self._query_num = query_num

    def join(self, *_a, **_kw): return self
    def filter(self, *_a, **_kw): return self
    def group_by(self, *_a, **_kw): return self
    def order_by(self, *_a, **_kw): return self

    def all(self):
        # day_rows is a list of (iso_date_str, message_count, session_count).
        return list(self._day_rows)

    def scalar(self):
        # The second query returns the distinct-session total.
        return self._total_sessions


def _run(day_rows, total_sessions, *, days=30, owner="alice", today=None):
    fn = _endpoint("GET", "/api/stats/activity")
    db = _FakeDB(day_rows=day_rows, total_sessions=total_sessions)
    # Patch the route's notion of "today" so streak math is deterministic.
    with patch("routes.activity_routes.SessionLocal", return_value=db), \
         patch("routes.activity_routes.require_user", return_value=owner), \
         patch("routes.activity_routes.datetime") as fake_dt:
        if today is None:
            today = date(2026, 6, 30)
        fake_dt.utcnow.return_value = datetime.combine(today, datetime.min.time())
        fake_dt.combine = datetime.combine
        fake_dt.min = datetime.min
        return fn(_request(owner), days=days)


# ---------------------------------------------------------------------------
# 1. 200 with all required keys
# ---------------------------------------------------------------------------

def test_returns_all_required_keys():
    resp = _run(day_rows=[], total_sessions=0)
    required = {
        "days", "total_messages", "total_sessions",
        "current_streak", "longest_streak", "period_days",
    }
    missing = required - set(resp.keys())
    assert not missing, f"missing keys: {missing}"
    assert isinstance(resp["days"], list)


# ---------------------------------------------------------------------------
# 2. days array length == period_days (missing dates filled with zeros)
# ---------------------------------------------------------------------------

def test_days_array_length_matches_period_and_fills_zeros():
    today = date(2026, 6, 30)
    # Only one day with data — the rest should be zero-filled.
    rows = [("2026-06-15", 7, 2)]
    resp = _run(rows, total_sessions=2, days=30, today=today)
    assert resp["period_days"] == 30
    assert len(resp["days"]) == 30
    zeros = [d for d in resp["days"] if d["messages"] == 0]
    assert len(zeros) == 29
    nonzero = [d for d in resp["days"] if d["messages"] > 0]
    assert len(nonzero) == 1
    assert nonzero[0]["date"] == "2026-06-15"
    assert nonzero[0]["messages"] == 7
    assert nonzero[0]["sessions"] == 2


# ---------------------------------------------------------------------------
# 3. Days sorted ascending
# ---------------------------------------------------------------------------

def test_days_sorted_ascending():
    rows = [
        ("2026-06-20", 1, 1),
        ("2026-06-25", 2, 1),
        ("2026-06-18", 3, 2),
    ]
    resp = _run(rows, total_sessions=3, today=date(2026, 6, 30))
    dates = [d["date"] for d in resp["days"]]
    assert dates == sorted(dates)
    # First and last entries match the 30-day window.
    assert dates[0] == "2026-06-01"
    assert dates[-1] == "2026-06-30"


# ---------------------------------------------------------------------------
# 4. current_streak — consecutive days ending today
# ---------------------------------------------------------------------------

def test_current_streak_consecutive_days_ending_today():
    today = date(2026, 6, 30)
    # 5-day run ending today.
    rows = [
        (today.isoformat(), 4, 1),
        ((today - timedelta(days=1)).isoformat(), 1, 1),
        ((today - timedelta(days=2)).isoformat(), 1, 1),
        ((today - timedelta(days=3)).isoformat(), 1, 1),
        ((today - timedelta(days=4)).isoformat(), 1, 1),
        # Gap, then more activity earlier in the period.
        ((today - timedelta(days=10)).isoformat(), 9, 2),
    ]
    resp = _run(rows, total_sessions=3, today=today)
    assert resp["current_streak"] == 5


def test_current_streak_zero_when_today_is_blank():
    today = date(2026, 6, 30)
    # Yesterday had activity but today is empty → current streak resets.
    rows = [((today - timedelta(days=1)).isoformat(), 5, 1)]
    resp = _run(rows, total_sessions=1, today=today)
    assert resp["current_streak"] == 0


# ---------------------------------------------------------------------------
# 5. longest_streak — longest consecutive run anywhere in the period
# ---------------------------------------------------------------------------

def test_longest_streak_correct():
    today = date(2026, 6, 30)
    # Run of 7 starting from day 5..11, plus a current 2-day run.
    rows = []
    for d in range(5, 12):
        rows.append(((today - timedelta(days=d)).isoformat(), 3, 1))
    for d in range(0, 2):
        rows.append(((today - timedelta(days=d)).isoformat(), 2, 1))
    resp = _run(rows, total_sessions=3, today=today)
    assert resp["longest_streak"] == 7
    assert resp["current_streak"] == 2


# ---------------------------------------------------------------------------
# 6. `days` param clamp (1..90)
# ---------------------------------------------------------------------------

def test_days_param_clamped_above_max():
    resp = _run([], total_sessions=0, days=999)
    assert resp["period_days"] == 90
    assert len(resp["days"]) == 90


def test_days_param_clamped_below_min():
    resp = _run([], total_sessions=0, days=0)
    assert resp["period_days"] == 1
    assert len(resp["days"]) == 1


def test_days_param_invalid_falls_back_to_default():
    resp = _run([], total_sessions=0, days="banana")
    assert resp["period_days"] == 30
    assert len(resp["days"]) == 30


# ---------------------------------------------------------------------------
# 7. Empty history → all zeros
# ---------------------------------------------------------------------------

def test_empty_history_returns_zeros():
    resp = _run([], total_sessions=0)
    assert resp["total_messages"] == 0
    assert resp["total_sessions"] == 0
    assert resp["current_streak"] == 0
    assert resp["longest_streak"] == 0
    # Every filled day is zero.
    assert all(d["messages"] == 0 and d["sessions"] == 0 for d in resp["days"])
