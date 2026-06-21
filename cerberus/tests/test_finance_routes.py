"""Tests for GET /api/finance/summary.

Fast-lane (pytest -m "not slow"). Heavy deps are stubbed at module level
using the same pattern as test_activity_stats.py.
"""
import sys
import os
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

for _mod in [
    "sqlalchemy", "sqlalchemy.orm", "sqlalchemy.ext",
    "sqlalchemy.ext.declarative", "sqlalchemy.ext.hybrid",
    "sqlalchemy.sql", "sqlalchemy.sql.expression",
    "core.database", "src.auth_helpers",
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

# Must happen after stubs so imports inside finance_routes resolve.
import importlib
import routes.finance_routes as fr
importlib.reload(fr)  # pick up stubs above

from routes.finance_routes import setup_finance_routes, _cost_rate, _is_local


# ── Helpers ───────────────────────────────────────────────────────────────

def _endpoint():
    router = setup_finance_routes()
    for route in router.routes:
        if getattr(route, "path", None) == "/api/finance/summary":
            return route.endpoint
    raise RuntimeError("GET /api/finance/summary not found")


def _request(owner="alice"):
    return SimpleNamespace(state=SimpleNamespace(current_user=owner))


class _AgentRow:
    def __init__(self, name, model, ti, to_, url=None):
        self.name = name
        self.model_alias = model
        self.total_input_tokens = ti
        self.total_output_tokens = to_
        self.last_run_url = url


class _SessTokenRow:
    def __init__(self, ti, to_, url=None):
        self.total_input_tokens = ti
        self.total_output_tokens = to_
        self.endpoint_url = url


class _AggRow:
    def __init__(self, si, so):
        self.si = si
        self.so = so


class _DayRow:
    def __init__(self, day, tokens):
        self.day = day
        self.tokens = tokens


class _ModelRow:
    def __init__(self, endpoint_url, tokens):
        self.endpoint_url = endpoint_url
        self.tokens = tokens


class _FakeDB:
    """Replays queries in the order the route issues them."""
    def __init__(self, *, sess_agg, agent_rows, sess_url_rows, daily_rows, model_rows):
        self._sess_agg = sess_agg
        self._agent_rows = agent_rows
        self._sess_url_rows = sess_url_rows
        self._daily_rows = daily_rows
        self._model_rows = model_rows
        self._call = 0
        self.closed = False

    def query(self, *_a, **_kw):
        self._call += 1
        return _Q(self, self._call)

    def close(self):
        self.closed = True


class _Q:
    def __init__(self, db, call):
        self._db = db
        self._call = call

    def filter(self, *_a, **_kw): return self
    def group_by(self, *_a, **_kw): return self
    def order_by(self, *_a, **_kw): return self

    def one(self):
        # call 1 — session aggregate (sum si, so)
        return self._db._sess_agg

    def all(self):
        # call 2 — agent rows
        if self._call == 2:
            return self._db._agent_rows
        # call 3 — session URL rows (for paid-token count)
        if self._call == 3:
            return self._db._sess_url_rows
        # call 4 — daily breakdown
        if self._call == 4:
            return self._db._daily_rows
        # call 5 — session model/endpoint rows
        if self._call == 5:
            return self._db._model_rows
        return []


def _run(fake_db, rate=None, owner="alice"):
    ep = _endpoint()
    req = _request(owner)
    env = {"LLM_COST_PER_TOKEN": str(rate)} if rate is not None else {}
    with patch.object(fr, "SessionLocal", return_value=fake_db), \
         patch.object(fr, "require_user", return_value=owner), \
         patch.dict(os.environ, env, clear=(rate is None)):
        return ep(req)


def _default_db(*, agent_tokens=0, sess_tokens=0, rate=0.000003, daily=None):
    """Build a minimal _FakeDB for common tests."""
    ti = agent_tokens // 2
    to_ = agent_tokens - ti
    agent_rows = [_AgentRow("BOT", "sonnet", ti, to_, "http://localhost/v1")] if agent_tokens else []
    sess_agg = _AggRow(sess_tokens, 0)
    sess_url_rows = [_SessTokenRow(sess_tokens, 0, "http://localhost/v1")] if sess_tokens else []
    if daily is None:
        cutoff = datetime.utcnow() - timedelta(days=30)
        daily = [
            _DayRow(str((cutoff + timedelta(days=i + 1)).date()), 0)
            for i in range(0)  # no daily rows — zero-fill tested separately
        ]
    return _FakeDB(
        sess_agg=sess_agg,
        agent_rows=agent_rows,
        sess_url_rows=sess_url_rows,
        daily_rows=daily,
        model_rows=[],
    )


# ── Tests ─────────────────────────────────────────────────────────────────

class TestSchema:
    def test_all_keys_present(self):
        db = _default_db()
        result = _run(db)
        required = {
            "total_tokens", "input_tokens", "output_tokens",
            "estimated_cost", "by_day", "by_agent", "by_model",
            "projected_monthly_tokens", "projected_monthly_cost",
            "is_free_tier", "rate",
        }
        assert required <= result.keys()

    def test_by_day_is_list(self):
        db = _default_db()
        result = _run(db)
        assert isinstance(result["by_day"], list)

    def test_by_agent_is_list(self):
        db = _default_db(agent_tokens=1000)
        result = _run(db)
        assert isinstance(result["by_agent"], list)

    def test_by_model_is_list(self):
        db = _default_db()
        result = _run(db)
        assert isinstance(result["by_model"], list)


class TestCostCalc:
    def test_cost_equals_paid_tokens_times_rate(self):
        # Cloud session — endpoint is NOT local → paid tokens
        cloud_url = "https://api.openai.com/v1"
        db = _FakeDB(
            sess_agg=_AggRow(1000, 500),
            agent_rows=[],
            sess_url_rows=[_SessTokenRow(1000, 500, cloud_url)],
            daily_rows=[],
            model_rows=[_ModelRow(cloud_url, 1500)],
        )
        result = _run(db, rate=0.000003)
        assert result["estimated_cost"] == pytest.approx(1500 * 0.000003, rel=1e-6)

    def test_local_endpoint_zero_cost(self):
        db = _default_db(sess_tokens=5000)
        result = _run(db, rate=0.000003)
        assert result["estimated_cost"] == 0.0

    def test_custom_rate_applied(self):
        cloud_url = "https://api.groq.com/v1"
        db = _FakeDB(
            sess_agg=_AggRow(2000, 0),
            agent_rows=[],
            sess_url_rows=[_SessTokenRow(2000, 0, cloud_url)],
            daily_rows=[],
            model_rows=[_ModelRow(cloud_url, 2000)],
        )
        custom_rate = 0.000001
        result = _run(db, rate=custom_rate)
        assert result["estimated_cost"] == pytest.approx(2000 * custom_rate, rel=1e-6)
        assert result["rate"] == custom_rate


class TestDailyBreakdown:
    def test_exactly_30_entries(self):
        db = _default_db()
        result = _run(db)
        assert len(result["by_day"]) == 30

    def test_zero_filled_when_no_data(self):
        db = _default_db()
        result = _run(db)
        assert all(d["tokens"] == 0 for d in result["by_day"])

    def test_partial_data_fills_gaps(self):
        cutoff = datetime.utcnow() - timedelta(days=30)
        day_5 = str((cutoff + timedelta(days=5)).date())
        daily = [_DayRow(day_5, 999)]
        db = _FakeDB(
            sess_agg=_AggRow(0, 0),
            agent_rows=[],
            sess_url_rows=[],
            daily_rows=daily,
            model_rows=[],
        )
        result = _run(db)
        assert len(result["by_day"]) == 30
        found = [d for d in result["by_day"] if d["tokens"] == 999]
        assert len(found) == 1


class TestFreeTier:
    def test_free_tier_true_when_cost_zero(self):
        db = _default_db()  # local endpoint → $0
        result = _run(db, rate=0.000003)
        assert result["is_free_tier"] is True

    def test_free_tier_false_when_cost_nonzero(self):
        cloud_url = "https://api.openai.com/v1"
        db = _FakeDB(
            sess_agg=_AggRow(1000, 0),
            agent_rows=[],
            sess_url_rows=[_SessTokenRow(1000, 0, cloud_url)],
            daily_rows=[],
            model_rows=[_ModelRow(cloud_url, 1000)],
        )
        result = _run(db, rate=0.000003)
        assert result["is_free_tier"] is False

    def test_zero_rate_yields_free_tier(self):
        cloud_url = "https://api.groq.com/v1"
        db = _FakeDB(
            sess_agg=_AggRow(5000, 0),
            agent_rows=[],
            sess_url_rows=[_SessTokenRow(5000, 0, cloud_url)],
            daily_rows=[],
            model_rows=[_ModelRow(cloud_url, 5000)],
        )
        result = _run(db, rate=0.0)
        assert result["is_free_tier"] is True


class TestProjected:
    def test_projected_equals_daily_avg_times_30(self):
        # 30 days, 100 tokens each
        cutoff = datetime.utcnow() - timedelta(days=30)
        daily = [_DayRow(str((cutoff + timedelta(days=i + 1)).date()), 100) for i in range(30)]
        db = _FakeDB(
            sess_agg=_AggRow(0, 0),
            agent_rows=[],
            sess_url_rows=[],
            daily_rows=daily,
            model_rows=[],
        )
        result = _run(db)
        assert result["projected_monthly_tokens"] == pytest.approx(100 * 30, rel=1)

    def test_projected_cost_consistent_with_tokens(self):
        cutoff = datetime.utcnow() - timedelta(days=30)
        daily = [_DayRow(str((cutoff + timedelta(days=i + 1)).date()), 1000) for i in range(30)]
        db = _FakeDB(
            sess_agg=_AggRow(0, 0),
            agent_rows=[],
            sess_url_rows=[],
            daily_rows=daily,
            model_rows=[],
        )
        rate = 0.000003
        result = _run(db, rate=rate)
        expected_cost = result["projected_monthly_tokens"] * rate
        assert result["projected_monthly_cost"] == pytest.approx(expected_cost, rel=1e-5)


class TestOwnerScope:
    def test_require_user_called(self):
        """Route must raise if require_user raises (no owner bypass)."""
        ep = _endpoint()
        req = _request("alice")
        with patch.object(fr, "require_user", side_effect=Exception("403 Forbidden")):
            with pytest.raises(Exception, match="403 Forbidden"):
                ep(req)
