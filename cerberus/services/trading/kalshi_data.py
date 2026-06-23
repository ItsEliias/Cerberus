"""
kalshi_data.py — read-only Kalshi public REST API client.

Phase 1 invariant: this module fetches data ONLY. It contains zero order
code, zero auth for trading endpoints, and no reference to any Kalshi
order-submission path. Any call that could place, modify, or cancel an
order belongs in Phase 3 and must NOT be added here.

The Kalshi REST v2 Markets API is public (no auth required for reads):
  GET /trade-api/v2/markets         — list active markets
  GET /trade-api/v2/markets/{ticker} — single market detail

Architecture ref: docs/TRADER_AGENT_ARCHITECTURE.md §3 (MVP Market — Kalshi)
Risk ref:         docs/TRADER_AGENT_RISK_AND_PHASING.md §2 (Hard Safeguards)
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

KALSHI_API_BASE = os.environ.get(
    "KALSHI_API_BASE", "https://api.elections.kalshi.com/trade-api/v2"
).rstrip("/")

# GWU 2026 documented edge threshold: contracts where midpoint ≥ 50¢
# show +2.6% maker ROI. Configurable so paper-trading experiments can vary it.
DEFAULT_MAKER_THRESHOLD = float(os.environ.get("KALSHI_MAKER_THRESHOLD", "0.50"))

_HTTP_TIMEOUT = httpx.Timeout(10.0)
_HEADERS = {"Accept": "application/json"}


class KalshiDataError(Exception):
    """Raised when the Kalshi API returns an unexpected response."""


async def get_active_markets(
    *,
    limit: int = 100,
    cursor: str | None = None,
    status: str = "open",
    series_ticker: str | None = None,
) -> dict[str, Any]:
    """Fetch a page of active Kalshi markets.

    Returns the raw API response dict:
      {"markets": [...], "cursor": "...", ...}

    Each market dict includes:
      ticker, title, yes_bid_dollars, yes_ask_dollars, no_bid_dollars, no_ask_dollars,
      last_price_dollars, response_price_units, volume, open_interest,
      expiration_time, status, category
    """
    params: dict[str, Any] = {"limit": min(limit, 200), "status": status}
    if cursor:
        params["cursor"] = cursor
    if series_ticker:
        params["series_ticker"] = series_ticker

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT, headers=_HEADERS) as client:
            resp = await client.get(f"{KALSHI_API_BASE}/markets", params=params)
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as e:
        raise KalshiDataError(f"Kalshi API error {e.response.status_code}: {e.response.text}") from e
    except httpx.RequestError as e:
        raise KalshiDataError(f"Kalshi request failed: {e}") from e


async def get_contract(ticker: str) -> dict[str, Any]:
    """Fetch a single Kalshi market by ticker.

    Returns the raw market dict from {"market": {...}}.
    Raises KalshiDataError on HTTP error or missing ticker.
    """
    if not ticker or not ticker.strip():
        raise ValueError("ticker must be a non-empty string")

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT, headers=_HEADERS) as client:
            resp = await client.get(f"{KALSHI_API_BASE}/markets/{ticker.strip()}")
            resp.raise_for_status()
            data = resp.json()
            return data.get("market", data)
    except httpx.HTTPStatusError as e:
        raise KalshiDataError(f"Kalshi API error {e.response.status_code}: {e.response.text}") from e
    except httpx.RequestError as e:
        raise KalshiDataError(f"Kalshi request failed: {e}") from e


def _volume_fp(market: dict[str, Any]) -> float:
    """Parse volume_fp (traded float volume) from a market dict, fallback to volume."""
    for key in ("volume_fp", "volume"):
        try:
            v = float(market.get(key) or 0)
            if v > 0:
                return v
        except (TypeError, ValueError):
            pass
    return 0.0


def _is_traded(market: dict[str, Any]) -> bool:
    """Return True if the market has any trading activity (volume or live price).

    Kalshi's open-markets list contains thousands of dormant sub-markets at
    $0.00 with zero volume. This predicate keeps only the ones actually trading.
    """
    if _volume_fp(market) > 0:
        return True
    for key in ("yes_bid_dollars", "last_price_dollars"):
        try:
            if float(market.get(key) or 0) > 0:
                return True
        except (TypeError, ValueError):
            pass
    return False


def filter_maker_threshold(
    markets: list[dict[str, Any]], *, min_midpoint: float = DEFAULT_MAKER_THRESHOLD
) -> list[dict[str, Any]]:
    """Return markets where the YES/NO midpoint >= min_midpoint.

    Midpoint = (yes_bid + yes_ask) / 2  (or best available from the response).

    The GWU 2026 paper documents that markets priced ≥ 0.50 show a structural
    favourite-longshot bias where market makers capture +2.6% average ROI.
    This filter is the first deterministic step in the analyst pipeline.
    """
    result = []
    for m in markets:
        mid = _midpoint(m)
        if mid is not None and mid >= min_midpoint:
            result.append({**m, "_midpoint": round(mid, 4)})
    return sorted(result, key=_volume_fp, reverse=True)


def _midpoint(market: dict[str, Any]) -> float | None:
    """Compute best-available midpoint from a Kalshi market dict.

    Primary (current API): *_dollars string fields — values are already in
      dollar units (e.g. "0.5200" == $0.52), directly comparable to the 0.50
      threshold. Markets where both sides are "0.0000" return None (no live price).
    Fallback (legacy API): yes_bid / yes_ask integer cent fields (÷100 → dollars).
    """
    def _dollar(key: str) -> float | None:
        v = market.get(key)
        if v is None:
            return None
        try:
            f = float(v)
            return f if f > 0.0 else None
        except (TypeError, ValueError):
            return None

    # ── Primary: *_dollars string fields (current Kalshi API) ────────────────
    bid_d = _dollar("yes_bid_dollars")
    ask_d = _dollar("yes_ask_dollars")
    if bid_d is not None and ask_d is not None:
        return (bid_d + ask_d) / 2.0

    # Single-side or last-price dollar fallback
    last_d = _dollar("last_price_dollars")
    if last_d is not None:
        return last_d
    # One side missing but the other is live
    one_d = bid_d or ask_d
    if one_d is not None:
        return one_d

    # ── Legacy: integer cent fields (÷100 → dollars) ─────────────────────────
    bid_i = market.get("yes_bid")
    ask_i = market.get("yes_ask")
    if bid_i is not None and ask_i is not None:
        try:
            mid = (float(bid_i) + float(ask_i)) / 2.0 / 100.0
            return mid if mid > 0.0 else None
        except (TypeError, ValueError):
            pass
    last_i = market.get("last_price") or market.get("yes_bid") or market.get("yes_ask")
    if last_i is not None:
        try:
            f = float(last_i) / 100.0
            return f if f > 0.0 else None
        except (TypeError, ValueError):
            pass

    return None


_PAGE_SIZE = 200      # Kalshi per-request max
_MAX_PAGES  = 5       # cap at 5 pages = 1000 markets total (stays polite at ~30 req/s)


async def get_traded_markets(
    *,
    max_fetch: int = 1000,
    page_size: int = _PAGE_SIZE,
    series_ticker: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """Paginate through Kalshi open markets and return only those actually trading.

    Kalshi's open-markets list is dominated by thousands of dormant $0.00
    sub-markets. This function paginates (up to max_fetch total, using the
    response cursor) and keeps only markets where volume_fp > 0 or a live
    price exists — the ones that matter for the maker strategy.

    Returns (traded_markets, total_fetched):
      traded_markets  — list sorted by volume_fp descending
      total_fetched   — total raw markets scanned (useful for diagnostics)
    """
    traded: list[dict[str, Any]] = []
    total_fetched = 0
    cursor: str | None = None
    page_size = min(page_size, _PAGE_SIZE)
    max_pages = max(1, max_fetch // page_size + (1 if max_fetch % page_size else 0))
    max_pages = min(max_pages, _MAX_PAGES)

    for _ in range(max_pages):
        fetch = min(page_size, max(1, max_fetch - total_fetched))
        try:
            resp = await get_active_markets(
                limit=fetch, cursor=cursor, series_ticker=series_ticker
            )
        except KalshiDataError:
            break
        page = resp.get("markets", [])
        if not page:
            break
        total_fetched += len(page)
        for m in page:
            if _is_traded(m):
                traded.append(m)
        cursor = resp.get("cursor") or ""
        if not cursor or total_fetched >= max_fetch:
            break

    traded.sort(key=_volume_fp, reverse=True)
    logger.info(
        "Kalshi get_traded_markets: scanned %d markets, %d traded (volume>0 or live price)%s",
        total_fetched,
        len(traded),
        f" [series={series_ticker}]" if series_ticker else "",
    )
    return traded, total_fetched


async def get_series_markets(
    series_ticker: str,
    *,
    max_fetch: int = 500,
) -> tuple[list[dict[str, Any]], int]:
    """Fetch traded markets for a specific Kalshi series (e.g. KXFED, KXELECTION).

    Liquid series (Fed decisions, elections, econ indicators) reliably have
    priced markets. Targets a known-liquid series rather than the full firehose.

    Returns (traded_markets, total_fetched) same as get_traded_markets.
    Future use: brief pipeline can target a series by ticker.
    """
    if not series_ticker or not series_ticker.strip():
        raise ValueError("series_ticker must be a non-empty string")
    return await get_traded_markets(
        max_fetch=max_fetch,
        series_ticker=series_ticker.strip(),
    )


async def get_filtered_markets(
    *,
    min_midpoint: float = DEFAULT_MAKER_THRESHOLD,
    max_fetch: int = 1000,
    series_ticker: str | None = None,
) -> dict[str, Any]:
    """Fetch traded markets and apply the maker threshold filter.

    Paginates through Kalshi markets (up to max_fetch), keeps only traded
    markets (volume_fp > 0 or live price), then applies the ≥ min_midpoint
    filter. Returns a dict so callers can surface thin-liquidity diagnostics:

      {
        "markets":       [...],  # qualifying markets, sorted by volume_fp desc
        "active_count":  N,      # traded markets before threshold filter
        "total_fetched": M,      # raw markets scanned
      }

    When active_count > 0 but markets == [] it means traded markets exist but
    none are ≥ min_midpoint right now (thin overnight liquidity — correct result,
    not a broken fetch).
    """
    try:
        traded, total_fetched = await get_traded_markets(
            max_fetch=max_fetch, series_ticker=series_ticker
        )
        active_count = len(traded)
        filtered = filter_maker_threshold(traded, min_midpoint=min_midpoint)
        logger.info(
            "Kalshi: scanned %d total, %d traded, %d above %.0f¢ threshold",
            total_fetched, active_count, len(filtered), min_midpoint * 100,
        )
        return {
            "markets": filtered,
            "active_count": active_count,
            "total_fetched": total_fetched,
        }
    except KalshiDataError as e:
        logger.error("Kalshi data fetch failed: %s", e)
        return {"markets": [], "active_count": 0, "total_fetched": 0}


def enrich_with_timestamp(markets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Inject '_fetched_at' epoch so the execution layer can enforce staleness."""
    ts = int(time.time())
    return [{**m, "_fetched_at": ts} for m in markets]
