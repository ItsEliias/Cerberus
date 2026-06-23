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
    """Build a market dict using the current Kalshi *_dollars string fields."""
    return {
        "ticker": ticker,
        "yes_bid_dollars": f"{yes_bid:.4f}",
        "yes_ask_dollars": f"{yes_ask:.4f}",
        "response_price_units": "usd_cent",
        "volume": volume,
    }


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
        markets = [{"ticker": "X", "volume": 10}]  # no *_dollars fields
        result = filter_maker_threshold(markets, min_midpoint=0.50)
        assert result == []

    def test_zero_dollar_prices_excluded(self):
        """Markets with $0.00 bid/ask (not actively traded) must be excluded."""
        markets = [
            {"ticker": "DEAD", "yes_bid_dollars": "0.0000", "yes_ask_dollars": "0.0000",
             "response_price_units": "usd_cent", "volume": 0},
        ]
        assert filter_maker_threshold(markets, min_midpoint=0.50) == []

    def test_real_dollar_prices_pass(self):
        """A market with yes_bid_dollars='0.5200' and yes_ask_dollars='0.5400' passes."""
        markets = [
            {"ticker": "LIVE", "yes_bid_dollars": "0.5200", "yes_ask_dollars": "0.5400",
             "response_price_units": "usd_cent", "volume": 1000},
        ]
        result = filter_maker_threshold(markets, min_midpoint=0.50)
        assert len(result) == 1
        assert abs(result[0]["_midpoint"] - 0.53) < 0.001


class TestMidpoint:
    def test_bid_ask_average(self):
        m = _market("X", 0.60, 0.64)
        assert abs(_midpoint(m) - 0.62) < 0.001

    def test_falls_back_to_last_price_dollars(self):
        m = {"ticker": "X", "last_price_dollars": "0.7000"}
        assert abs(_midpoint(m) - 0.70) < 0.001

    def test_zero_dollar_prices_return_none(self):
        """Both sides at $0.00 → no midpoint (market not actively traded)."""
        m = {"ticker": "X", "yes_bid_dollars": "0.0000", "yes_ask_dollars": "0.0000"}
        assert _midpoint(m) is None

    def test_returns_none_when_no_price(self):
        assert _midpoint({"ticker": "X"}) is None

    def test_legacy_integer_cent_fallback(self):
        """Old yes_bid/yes_ask integer cent fields (÷100) still work as fallback."""
        m = {"ticker": "X", "yes_bid": 52, "yes_ask": 56}
        assert abs(_midpoint(m) - 0.54) < 0.001

    def test_legacy_zero_cents_excluded(self):
        m = {"ticker": "X", "yes_bid": 0, "yes_ask": 0}
        assert _midpoint(m) is None


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
        mock_gfm.return_value = {"markets": [], "active_count": 5, "total_fetched": 200}
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

        mock_gfm.return_value = {"markets": [market], "active_count": 1, "total_fetched": 200}
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


# ── Traded-market filtering and pagination tests ──────────────────────────────

def test_is_traded_volume_fp():
    """_is_traded returns True when volume_fp > 0."""
    from services.trading.kalshi_data import _is_traded
    assert _is_traded({"ticker": "A", "volume_fp": 108141.0})
    assert _is_traded({"ticker": "A", "volume_fp": "500"})  # string also works


def test_is_traded_live_bid():
    """_is_traded returns True when yes_bid_dollars > 0 (even with zero volume)."""
    from services.trading.kalshi_data import _is_traded
    assert _is_traded({"ticker": "A", "volume_fp": 0, "yes_bid_dollars": "0.5200"})


def test_is_traded_last_price():
    """_is_traded returns True when last_price_dollars > 0."""
    from services.trading.kalshi_data import _is_traded
    assert _is_traded({"ticker": "A", "last_price_dollars": "0.1300"})


def test_is_traded_false_for_dormant():
    """_is_traded returns False for $0.00 / zero-volume markets (the graveyard)."""
    from services.trading.kalshi_data import _is_traded
    assert not _is_traded({"ticker": "A"})
    assert not _is_traded({"ticker": "A", "volume_fp": 0, "yes_bid_dollars": "0.0000",
                            "last_price_dollars": "0.0000"})


@pytest.mark.asyncio
async def test_get_traded_markets_paginates():
    """get_traded_markets follows cursor across pages and returns only traded markets."""
    from services.trading.kalshi_data import get_traded_markets

    traded_market = {
        "ticker": "KXELONMARS-99",
        "yes_bid_dollars": "0.1200",
        "last_price_dollars": "0.1300",
        "volume_fp": 108141.0,
    }
    dormant = {"ticker": "DEAD", "yes_bid_dollars": "0.0000",
               "last_price_dollars": "0.0000", "volume_fp": 0}

    page1 = {"markets": [dormant] * 3, "cursor": "page2cursor"}
    page2 = {"markets": [traded_market, dormant], "cursor": ""}

    with patch("services.trading.kalshi_data.get_active_markets", new_callable=AsyncMock) as mock_ga:
        mock_ga.side_effect = [page1, page2]
        markets, total = await get_traded_markets(max_fetch=400, page_size=200)

    assert total == 5                        # 3 + 2 markets fetched
    assert len(markets) == 1                # only the traded one survives
    assert markets[0]["ticker"] == "KXELONMARS-99"


@pytest.mark.asyncio
async def test_get_traded_markets_stops_at_empty_cursor():
    """get_traded_markets stops when cursor is empty (no more pages)."""
    from services.trading.kalshi_data import get_traded_markets

    page = {"markets": [{"ticker": "A", "volume_fp": 100}], "cursor": ""}
    with patch("services.trading.kalshi_data.get_active_markets", new_callable=AsyncMock) as mock_ga:
        mock_ga.return_value = page
        markets, total = await get_traded_markets()

    assert mock_ga.call_count == 1  # stopped after the first empty cursor


@pytest.mark.asyncio
async def test_get_series_markets_passes_series_ticker():
    """get_series_markets passes series_ticker to get_active_markets."""
    from services.trading.kalshi_data import get_series_markets

    page = {"markets": [{"ticker": "KXFED-99", "volume_fp": 5000}], "cursor": ""}
    with patch("services.trading.kalshi_data.get_active_markets", new_callable=AsyncMock) as mock_ga:
        mock_ga.return_value = page
        markets, total = await get_series_markets("KXFED")

    call_kwargs = mock_ga.call_args[1]  # keyword args
    assert call_kwargs.get("series_ticker") == "KXFED"
    assert len(markets) == 1


@pytest.mark.asyncio
async def test_get_series_markets_rejects_empty_ticker():
    from services.trading.kalshi_data import get_series_markets
    with pytest.raises(ValueError):
        await get_series_markets("")


@pytest.mark.asyncio
async def test_get_filtered_markets_returns_dict_with_active_count():
    """get_filtered_markets returns dict with markets, active_count, total_fetched."""
    from services.trading.kalshi_data import get_filtered_markets

    traded = [_market("A", 0.55, 0.57)]    # passes ≥0.50 threshold
    traded[0]["volume_fp"] = 1000

    with patch("services.trading.kalshi_data.get_traded_markets", new_callable=AsyncMock) as mock_gt:
        mock_gt.return_value = (traded, 200)
        result = await get_filtered_markets(min_midpoint=0.50)

    assert "markets" in result
    assert "active_count" in result
    assert "total_fetched" in result
    assert result["active_count"] == 1
    assert result["total_fetched"] == 200
    assert len(result["markets"]) == 1


@pytest.mark.asyncio
async def test_get_filtered_markets_thin_liquidity():
    """active_count > 0 but markets == [] means thin liquidity (not broken)."""
    from services.trading.kalshi_data import get_filtered_markets

    traded = [_market("A", 0.12, 0.14)]    # below threshold
    traded[0]["volume_fp"] = 500

    with patch("services.trading.kalshi_data.get_traded_markets", new_callable=AsyncMock) as mock_gt:
        mock_gt.return_value = (traded, 1000)
        result = await get_filtered_markets(min_midpoint=0.50)

    assert result["active_count"] == 1      # traded markets exist
    assert result["markets"] == []          # but none ≥50¢ right now


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


# ── Trader endpoint resolution priority ──────────────────────────────────────

def test_trader_prefix_tried_first():
    """_resolve_trader_endpoint must try 'trader' prefix before 'utility'."""
    import inspect
    import services.trading.brief_service as mod
    src = inspect.getsource(mod._resolve_trader_endpoint)
    # "trader" must appear before "utility" in the function body
    trader_pos = src.index('"trader"')
    utility_pos = src.index('"utility"')
    assert trader_pos < utility_pos, (
        "'trader' prefix must be resolved before 'utility' in _resolve_trader_endpoint"
    )


@pytest.mark.asyncio
async def test_trader_endpoint_returned_when_configured():
    """When trader endpoint is configured, its url+key+model are returned."""
    with patch("services.trading.brief_service.resolve_endpoint") as mock_re:
        # Simulate: trader endpoint configured → returns url+model+headers
        def side_effect(prefix, owner=None):
            if prefix == "trader":
                return ("https://api.anthropic.com/v1/messages", "claude-3-5-sonnet-20241022", {"x-api-key": "sk-ant-test"})
            if prefix == "utility":
                return ("https://api.groq.com/openai/v1/chat/completions", "llama-3.1-70b", {"Authorization": "Bearer gsk_test"})
            return (None, None, None)
        mock_re.side_effect = side_effect

        import services.trading.brief_service as svc
        # clear cached TRADER_REASONING_MODEL so env override doesn't mask the result
        orig = svc.TRADER_REASONING_MODEL
        svc.TRADER_REASONING_MODEL = ""
        try:
            url, model, headers = await svc._resolve_trader_endpoint("testuser")
        finally:
            svc.TRADER_REASONING_MODEL = orig

        assert url == "https://api.anthropic.com/v1/messages", "should use trader url, not utility"
        assert model == "claude-3-5-sonnet-20241022", "should use trader model"
        assert headers.get("x-api-key") == "sk-ant-test", "should use trader api key"
        # Ensure 'trader' prefix was the first call
        assert mock_re.call_args_list[0][0][0] == "trader"


@pytest.mark.asyncio
async def test_trader_falls_back_to_utility_when_unconfigured():
    """When trader endpoint is NOT configured, falls back to utility endpoint."""
    with patch("services.trading.brief_service.resolve_endpoint") as mock_re:
        def side_effect(prefix, owner=None):
            if prefix == "trader":
                return (None, None, None)  # not configured
            if prefix == "utility":
                return ("https://api.groq.com/openai/v1/chat/completions", "llama-3.1-70b", {"Authorization": "Bearer gsk_test"})
            return (None, None, None)
        mock_re.side_effect = side_effect

        import services.trading.brief_service as svc
        orig = svc.TRADER_REASONING_MODEL
        svc.TRADER_REASONING_MODEL = ""
        try:
            url, model, headers = await svc._resolve_trader_endpoint("testuser")
        finally:
            svc.TRADER_REASONING_MODEL = orig

        assert url == "https://api.groq.com/openai/v1/chat/completions", "should fall back to utility url"
        assert model == "llama-3.1-70b"


@pytest.mark.asyncio
async def test_trader_falls_back_to_default_when_utility_also_unconfigured():
    """Fallback chain: trader → utility → default."""
    with patch("services.trading.brief_service.resolve_endpoint") as mock_re:
        def side_effect(prefix, owner=None):
            if prefix == "default":
                return ("https://api.openai.com/v1/chat/completions", "gpt-4o", {"Authorization": "Bearer sk-test"})
            return (None, None, None)
        mock_re.side_effect = side_effect

        import services.trading.brief_service as svc
        orig = svc.TRADER_REASONING_MODEL
        svc.TRADER_REASONING_MODEL = ""
        try:
            url, model, headers = await svc._resolve_trader_endpoint("testuser")
        finally:
            svc.TRADER_REASONING_MODEL = orig

        assert url == "https://api.openai.com/v1/chat/completions"
        assert model == "gpt-4o"


@pytest.mark.asyncio
async def test_env_override_replaces_model_not_url():
    """TRADER_REASONING_MODEL overrides model name but not url/key."""
    with patch("services.trading.brief_service.resolve_endpoint") as mock_re:
        mock_re.return_value = ("https://api.anthropic.com/v1/messages", "claude-3-5-haiku", {"x-api-key": "sk-ant-test"})

        import services.trading.brief_service as svc
        orig = svc.TRADER_REASONING_MODEL
        svc.TRADER_REASONING_MODEL = "claude-3-5-sonnet-20241022"
        try:
            url, model, headers = await svc._resolve_trader_endpoint("testuser")
        finally:
            svc.TRADER_REASONING_MODEL = orig

        assert url == "https://api.anthropic.com/v1/messages", "url must come from endpoint, not env"
        assert model == "claude-3-5-sonnet-20241022", "model overridden by env var"
        assert headers.get("x-api-key") == "sk-ant-test", "api key must come from endpoint"


@pytest.mark.asyncio
async def test_llama33_blocked_on_trader_endpoint():
    """Llama 3.3 must be blocked even when it comes from the trader endpoint directly."""
    with patch("services.trading.brief_service.resolve_endpoint") as mock_re:
        mock_re.return_value = ("https://api.groq.com/v1/chat/completions", "llama-3.3-70b-versatile", {})

        import services.trading.brief_service as svc
        orig = svc.TRADER_REASONING_MODEL
        svc.TRADER_REASONING_MODEL = ""
        try:
            with pytest.raises(ValueError, match="prohibited"):
                await svc._resolve_trader_endpoint("testuser")
        finally:
            svc.TRADER_REASONING_MODEL = orig


def test_trader_settings_keys_in_defaults():
    """trader_endpoint_id and trader_model must appear in DEFAULT_SETTINGS block."""
    # src.settings is stubbed in this test module (it imports src.constants which
    # requires heavy deps). Use source inspection instead of live import.
    with open("src/settings.py") as f:
        src = f.read()
    assert '"trader_endpoint_id"' in src, "trader_endpoint_id missing from DEFAULT_SETTINGS"
    assert '"trader_model"' in src, "trader_model missing from DEFAULT_SETTINGS"


def test_trader_settings_keys_in_per_user():
    """trader_endpoint_id and trader_model must appear in _PER_USER_KEYS."""
    with open("src/settings.py") as f:
        src = f.read()
    per_user_block_start = src.index("_PER_USER_KEYS")
    per_user_block_end = src.index("}", per_user_block_start)
    per_user_block = src[per_user_block_start:per_user_block_end]
    assert '"trader_endpoint_id"' in per_user_block, "trader_endpoint_id missing from _PER_USER_KEYS"
    assert '"trader_model"' in per_user_block, "trader_model missing from _PER_USER_KEYS"


def test_trader_in_endpoint_setting_fields():
    """model_routes._ENDPOINT_SETTING_FIELDS must register trader_endpoint_id."""
    with open("routes/model_routes.py") as f:
        src = f.read()
    assert '"trader_endpoint_id"' in src, "trader_endpoint_id missing from _ENDPOINT_SETTING_FIELDS"


# ── No order code in Phase 1 modules ─────────────────────────────────────────

def test_kalshi_base_url_has_no_rest_segment():
    """Base URL must be /trade-api/v2 not /trade-api/rest/v2 (the /rest/ path returns 404)."""
    import services.trading.kalshi_data as mod
    assert "/rest/" not in mod.KALSHI_API_BASE, (
        f"KALSHI_API_BASE contains '/rest/' which returns 404: {mod.KALSHI_API_BASE!r}"
    )
    assert mod.KALSHI_API_BASE.endswith("/v2"), (
        f"KALSHI_API_BASE should end with '/v2': {mod.KALSHI_API_BASE!r}"
    )


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
