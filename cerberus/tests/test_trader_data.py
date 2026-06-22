"""Tests for TRADER Phase 1 data layer.

Covers:
  - kalshi_data: filter_maker_threshold, _midpoint, enrich_with_timestamp
  - kalshi_data: get_active_markets / get_contract (mocked httpx)
  - brief_service: _validate_model blocks Llama 3.3
  - brief_service: run_brief_cycle with stubbed LLM + Kalshi
  - TraderBrief DB model: _migrate_create_trader_briefs_table is idempotent
  - trader_routes: /api/trader/markets/threshold returns filtered data

Phase 1 invariant: no order code, no trading key, no paper execution.
"""

import json
import sys
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock
import pytest

# ── Stub heavy deps before any import ────────────────────────────────────────

for _mod in [
    "sqlalchemy", "sqlalchemy.orm", "sqlalchemy.ext",
    "sqlalchemy.ext.declarative", "sqlalchemy.sql",
    "src.auth_helpers",
    "src.llm_core", "src.endpoint_resolver", "src.prompt_security",
    "src.settings",
    # services.__init__ pulls in docs/research/memory/shell which need numpy/cryptography
    "numpy", "cryptography",
    "services.docs", "services.research", "services.memory", "services.shell",
    "services.search", "src.rag_manager", "src.rag_vector",
    "services.docs.service", "services.research.service",
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

# Stub prompt_security.untrusted_context_message to return a simple dict
sys.modules["src.prompt_security"].untrusted_context_message = (
    lambda label, content: {"role": "user", "content": f"[UNTRUSTED:{label}] {content}"}
)

# ── kalshi_data tests ─────────────────────────────────────────────────────────

from services.trading.kalshi_data import (
    filter_maker_threshold,
    enrich_with_timestamp,
    _midpoint,
)


def _market(ticker, yes_bid, yes_ask, volume=100):
    return {"ticker": ticker, "yes_bid": yes_bid, "yes_ask": yes_ask, "volume": volume}


class TestFilterMakerThreshold:
    def test_keeps_above_threshold(self):
        markets = [_market("A", 0.52, 0.54), _market("B", 0.40, 0.44)]
        result = filter_maker_threshold(markets, min_midpoint=0.50)
        assert len(result) == 1
        assert result[0]["ticker"] == "A"

    def test_injects_midpoint_key(self):
        markets = [_market("X", 0.60, 0.64)]
        result = filter_maker_threshold(markets, min_midpoint=0.50)
        assert "_midpoint" in result[0]
        assert abs(result[0]["_midpoint"] - 0.62) < 0.001

    def test_sorts_by_volume_desc(self):
        markets = [
            _market("LOW", 0.60, 0.62, volume=10),
            _market("HIGH", 0.55, 0.57, volume=500),
        ]
        result = filter_maker_threshold(markets, min_midpoint=0.50)
        assert result[0]["ticker"] == "HIGH"

    def test_empty_input(self):
        assert filter_maker_threshold([], min_midpoint=0.50) == []

    def test_all_below_threshold(self):
        markets = [_market("A", 0.10, 0.12), _market("B", 0.20, 0.24)]
        assert filter_maker_threshold(markets, min_midpoint=0.50) == []

    def test_boundary_exactly_at_threshold(self):
        markets = [_market("A", 0.49, 0.51)]  # midpoint = 0.50 exactly
        result = filter_maker_threshold(markets, min_midpoint=0.50)
        assert len(result) == 1

    def test_missing_prices_skipped(self):
        markets = [{"ticker": "X", "volume": 10}]  # no yes_bid / yes_ask
        result = filter_maker_threshold(markets, min_midpoint=0.50)
        assert result == []


class TestMidpoint:
    def test_bid_ask_average(self):
        m = _market("X", 0.60, 0.64)
        assert abs(_midpoint(m) - 0.62) < 0.001

    def test_falls_back_to_last_price(self):
        m = {"ticker": "X", "last_price": 0.70}
        assert abs(_midpoint(m) - 0.70) < 0.001

    def test_returns_none_when_no_price(self):
        assert _midpoint({"ticker": "X"}) is None


class TestEnrichWithTimestamp:
    def test_injects_fetched_at(self):
        before = int(time.time())
        markets = [{"ticker": "A"}, {"ticker": "B"}]
        result = enrich_with_timestamp(markets)
        assert all("_fetched_at" in m for m in result)
        assert all(m["_fetched_at"] >= before for m in result)

    def test_does_not_mutate_input(self):
        orig = {"ticker": "A"}
        markets = [orig]
        enrich_with_timestamp(markets)
        assert "_fetched_at" not in orig


@pytest.mark.asyncio
async def test_get_active_markets_calls_kalshi_api():
    import httpx
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {"markets": [_market("DEMO", 0.60, 0.62)], "cursor": ""}

    with patch("services.trading.kalshi_data.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
            get=AsyncMock(return_value=mock_resp)
        ))
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        from services.trading.kalshi_data import get_active_markets
        data = await get_active_markets(limit=10)
        assert "markets" in data
        assert data["markets"][0]["ticker"] == "DEMO"


@pytest.mark.asyncio
async def test_get_contract_raises_on_empty_ticker():
    from services.trading.kalshi_data import get_contract
    with pytest.raises(ValueError):
        await get_contract("")


# ── brief_service tests ───────────────────────────────────────────────────────

from services.trading.brief_service import _validate_model


class TestValidateModel:
    def test_blocks_llama_3_3(self):
        for name in ("llama-3.3", "Llama3.3", "llama 3.3", "llama-3.3-70b"):
            with pytest.raises(ValueError, match="prohibited"):
                _validate_model(name)

    def test_allows_other_models(self):
        for name in ("mistral-nemo", "gemma3", "qwen2.5", "llama-3.1", "llama-3.2"):
            _validate_model(name)  # must not raise

    def test_none_is_allowed(self):
        _validate_model(None)  # no override set — no error


@pytest.mark.asyncio
async def test_run_brief_cycle_returns_empty_when_no_markets():
    """If Kalshi returns no ≥50¢ markets, cycle returns []."""
    with patch("services.trading.brief_service.get_filtered_markets", new_callable=AsyncMock) as mock_gfm:
        mock_gfm.return_value = []
        from services.trading.brief_service import run_brief_cycle
        result = await run_brief_cycle(owner="testuser", limit=3)
        assert result == []


@pytest.mark.asyncio
async def test_run_brief_cycle_generates_briefs():
    """Happy path: one market above threshold → one brief."""
    market = {**_market("DEMO-24", 0.60, 0.64), "_midpoint": 0.62, "_fetched_at": int(time.time())}
    synth_json = json.dumps({
        "direction": "YES", "confidence": 72,
        "rationale": "Test rationale", "risk_flags": [],
    })

    with patch("services.trading.brief_service.get_filtered_markets", new_callable=AsyncMock) as mock_gfm, \
         patch("services.trading.brief_service.enrich_with_timestamp", side_effect=lambda m: m), \
         patch("services.trading.brief_service._resolve_trader_endpoint", new_callable=AsyncMock) as mock_ep, \
         patch("services.trading.brief_service.llm_call_async", new_callable=AsyncMock) as mock_llm:

        mock_gfm.return_value = [market]
        mock_ep.return_value = ("http://localhost:11434", "mistral-nemo", {})
        # First 3 calls: bull, bear, risk; 4th: synthesis
        mock_llm.side_effect = ["Bull text.", "Bear text.", "Risk text.", synth_json]

        from services.trading.brief_service import run_brief_cycle
        briefs = await run_brief_cycle(owner="testuser", limit=1)

    assert len(briefs) == 1
    b = briefs[0]
    assert b["contract_ticker"] == "DEMO-24"
    assert b["direction"] == "YES"
    assert b["confidence"] == 72
    assert b["bull_analysis"] == "Bull text."
    assert b["rationale"] == "Test rationale"


# ── DB migration idempotency ──────────────────────────────────────────────────

def test_migrate_create_trader_briefs_is_idempotent(tmp_path):
    """Running the migration twice must not raise."""
    import sqlite3
    db_file = tmp_path / "cerberus.db"
    conn = sqlite3.connect(str(db_file))
    conn.close()

    with patch("core.database.DATABASE_URL", f"sqlite:///{db_file}"):
        from core.database import _migrate_create_trader_briefs_table
        _migrate_create_trader_briefs_table()
        _migrate_create_trader_briefs_table()  # second call must be a no-op

    conn = sqlite3.connect(str(db_file))
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    conn.close()
    assert "trader_briefs" in tables


# ── No order code in Phase 1 modules ─────────────────────────────────────────

def test_no_order_code_in_kalshi_data():
    """kalshi_data.py must not reference any Kalshi order endpoints."""
    import inspect
    import services.trading.kalshi_data as mod
    src = inspect.getsource(mod)
    forbidden = ["/portfolio/orders", "place_order", "submit_order", "create_order"]
    for frag in forbidden:
        assert frag not in src, f"Phase 1 invariant violated: '{frag}' found in kalshi_data.py"


def test_no_order_code_in_brief_service():
    """brief_service.py must not reference any order placement logic."""
    import inspect
    import services.trading.brief_service as mod
    src = inspect.getsource(mod)
    forbidden = ["/portfolio/orders", "place_order", "submit_order", "approve_and_execute"]
    for frag in forbidden:
        assert frag not in src, f"Phase 1 invariant violated: '{frag}' found in brief_service.py"


def test_no_order_code_in_trader_routes():
    """trader_routes.py must not expose any order-placement endpoints."""
    import inspect
    import routes.trader_routes as mod
    import re
    src = inspect.getsource(mod)
    # Strip docstrings before checking — Phase 2 docstring references
    # /api/trader/paper/order as the human-submission endpoint, which would
    # otherwise trigger the /order pattern against non-code text.
    code = re.sub(r'""".*?"""', '', src, flags=re.DOTALL)
    code = re.sub(r"'''.*?'''", '', code, flags=re.DOTALL)
    forbidden = ["place_order", "submit_order", "approve_and_execute", "/order", "POST.*order"]
    for frag in forbidden:
        assert not re.search(frag, code, re.IGNORECASE), (
            f"Phase 1 invariant violated: '{frag}' found in trader_routes.py"
        )
