"""
kalshi_data.py — read-only Kalshi public REST API client.

Phase 1 invariant: this module fetches data ONLY. It contains zero order
code, zero auth for trading endpoints, and no reference to any Kalshi
order-submission path. Any call that could place, modify, or cancel an
order belongs in Phase 3 and must NOT be added here.

The Kalshi REST v2 Markets API is public (no auth required for reads):
  GET /trade-api/rest/v2/markets         — list active markets
  GET /trade-api/rest/v2/markets/{ticker} — single market detail

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
    "KALSHI_API_BASE", "https://api.elections.kalshi.com/trade-api/rest/v2"
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
      ticker, title, yes_bid, yes_ask, no_bid, no_ask,
      volume, open_interest, expiration_time, status, category
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
    return sorted(result, key=lambda x: x.get("volume", 0), reverse=True)


def _midpoint(market: dict[str, Any]) -> float | None:
    """Compute best-available midpoint from a Kalshi market dict."""
    # Prefer bid+ask average; fall back to last_price
    yes_bid = market.get("yes_bid")
    yes_ask = market.get("yes_ask")
    if yes_bid is not None and yes_ask is not None:
        try:
            return (float(yes_bid) + float(yes_ask)) / 2.0
        except (TypeError, ValueError):
            pass
    last = market.get("last_price") or market.get("yes_bid") or market.get("yes_ask")
    if last is not None:
        try:
            return float(last)
        except (TypeError, ValueError):
            pass
    return None


async def get_filtered_markets(
    *,
    min_midpoint: float = DEFAULT_MAKER_THRESHOLD,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Convenience wrapper: fetch active markets and apply the maker threshold filter.

    This is the entry point for the brief_service pipeline. Returns markets
    sorted by volume descending with a '_midpoint' key injected.
    """
    try:
        resp = await get_active_markets(limit=limit)
        markets = resp.get("markets", [])
        filtered = filter_maker_threshold(markets, min_midpoint=min_midpoint)
        logger.info(
            "Kalshi: fetched %d markets, %d above %.0f¢ threshold",
            len(markets), len(filtered), min_midpoint * 100,
        )
        return filtered
    except KalshiDataError as e:
        logger.error("Kalshi data fetch failed: %s", e)
        return []


def enrich_with_timestamp(markets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Inject '_fetched_at' epoch so the execution layer can enforce staleness."""
    ts = int(time.time())
    return [{**m, "_fetched_at": ts} for m in markets]
