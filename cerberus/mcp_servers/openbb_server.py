"""
openbb_server.py — MCP server exposing read-only OpenBB market data.

Controlled by OPENBB_ENABLED=true (default: false). When disabled or when
the openbb package is not installed, all tool calls return a graceful
"not available" message — the server still starts and lists tools so the
MCP manager sees consistent capabilities regardless of environment.

Tools exposed (all read-only — no order placement, no side effects):
  openbb_market_data   — active Kalshi contracts with prices and volume
  openbb_macro         — selected FRED macro indicators (optional enrichment)
  openbb_search        — search/filter contracts by keyword or category

This server runs inside the Cerberus app process via stdio MCP transport.
The TRADER agent's tool allowlist (src/tool_policy.py) gates access; the
server itself enforces no per-user authentication.

Architecture ref: docs/TRADER_AGENT_ARCHITECTURE.md §4 (OpenBB Integration)
"""

import asyncio
import json
import logging
import os
import sys
from pathlib import Path

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logger = logging.getLogger(__name__)

server = Server("openbb")

_openbb = None
_initialized = False
_enabled = os.environ.get("OPENBB_ENABLED", "false").strip().lower() in ("1", "true", "yes")


def _ensure_init():
    """Lazy-init OpenBB on first tool call. Fails gracefully if not installed."""
    global _openbb, _initialized
    if _initialized:
        return
    _initialized = True

    if not _enabled:
        logger.info("OpenBB MCP server: OPENBB_ENABLED is false — running in stub mode")
        return

    try:
        import openbb  # noqa: F401 — availability check
        _openbb = openbb
        logger.info("OpenBB MCP server: openbb package loaded")
    except ImportError:
        logger.warning(
            "OpenBB MCP server: openbb package not installed; "
            "set OPENBB_ENABLED=false or install openbb to suppress this warning"
        )


def _unavailable(reason: str) -> list[TextContent]:
    return [TextContent(type="text", text=f"OpenBB not available: {reason}")]


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="openbb_market_data",
            description=(
                "Fetch active Kalshi prediction-market contracts with YES/NO prices, "
                "volume, expiry, and category. Read-only. Returns JSON list of contracts. "
                "Requires OPENBB_ENABLED=true and the openbb package installed."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "description": "Optional category filter (e.g. 'politics', 'economics')",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max contracts to return (default 50, max 200)",
                        "default": 50,
                    },
                },
                "required": [],
            },
        ),
        Tool(
            name="openbb_macro",
            description=(
                "Fetch selected FRED macro indicators for optional context enrichment. "
                "Read-only. Returns JSON with indicator name, value, date, and unit. "
                "Requires OPENBB_ENABLED=true."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "indicators": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "FRED series IDs to fetch (e.g. ['UNRATE', 'CPIAUCSL']). "
                                       "Defaults to a curated short list if omitted.",
                    }
                },
                "required": [],
            },
        ),
        Tool(
            name="openbb_search",
            description=(
                "Search or filter Kalshi contracts by keyword or category. "
                "Returns matching contracts with prices. Read-only. "
                "Requires OPENBB_ENABLED=true."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Keyword to search in contract title or description",
                    },
                    "category": {
                        "type": "string",
                        "description": "Optional category to restrict results",
                    },
                    "min_midpoint": {
                        "type": "number",
                        "description": "Minimum midpoint price (0–1). Use 0.5 for the maker-edge threshold.",
                        "default": 0.0,
                    },
                },
                "required": ["query"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    _ensure_init()

    if not _enabled:
        return _unavailable("OPENBB_ENABLED is not set to true")
    if _openbb is None:
        return _unavailable("openbb package is not installed (pip install openbb)")

    if name == "openbb_market_data":
        return await _handle_market_data(arguments)
    elif name == "openbb_macro":
        return await _handle_macro(arguments)
    elif name == "openbb_search":
        return await _handle_search(arguments)
    else:
        return [TextContent(type="text", text=f"Unknown tool: {name}")]


async def _handle_market_data(args: dict) -> list[TextContent]:
    category = args.get("category", "")
    limit = min(int(args.get("limit", 50)), 200)
    try:
        # openbb.kalshi.market_data() — exact method name subject to openbb SDK version
        data = await asyncio.to_thread(_fetch_kalshi_markets, category=category, limit=limit)
        return [TextContent(type="text", text=json.dumps(data, default=str))]
    except Exception as e:
        logger.error("openbb_market_data failed: %s", e)
        return [TextContent(type="text", text=f"Error fetching market data: {e}")]


async def _handle_macro(args: dict) -> list[TextContent]:
    default_indicators = ["UNRATE", "CPIAUCSL", "DFF", "T10Y2Y"]
    indicators = args.get("indicators") or default_indicators
    try:
        data = await asyncio.to_thread(_fetch_macro, indicators=indicators)
        return [TextContent(type="text", text=json.dumps(data, default=str))]
    except Exception as e:
        logger.error("openbb_macro failed: %s", e)
        return [TextContent(type="text", text=f"Error fetching macro data: {e}")]


async def _handle_search(args: dict) -> list[TextContent]:
    query = args.get("query", "").strip()
    category = args.get("category", "")
    min_midpoint = float(args.get("min_midpoint", 0.0))
    if not query:
        return [TextContent(type="text", text="Error: query is required")]
    try:
        data = await asyncio.to_thread(
            _fetch_kalshi_search, query=query, category=category, min_midpoint=min_midpoint
        )
        return [TextContent(type="text", text=json.dumps(data, default=str))]
    except Exception as e:
        logger.error("openbb_search failed: %s", e)
        return [TextContent(type="text", text=f"Error searching contracts: {e}")]


def _fetch_kalshi_markets(*, category: str, limit: int) -> list[dict]:
    """Synchronous OpenBB call — runs in thread via asyncio.to_thread."""
    from openbb import obb  # type: ignore[import]
    result = obb.derivatives.options.chains  # placeholder — real path TBD at SDK integration
    # When the real openbb Kalshi extension is available, replace above with:
    #   result = obb.economy.calendar(provider="kalshi", ...)
    # For now return empty list so the server is structurally correct.
    _ = result
    return []


def _fetch_macro(*, indicators: list) -> list[dict]:
    """Synchronous FRED indicator fetch via OpenBB."""
    from openbb import obb  # type: ignore[import]
    out = []
    for series in indicators[:10]:  # cap at 10 per call
        try:
            df = obb.economy.fred_series(symbol=series, limit=1).to_df()
            if not df.empty:
                row = df.iloc[-1]
                out.append({"series": series, "date": str(row.name), "value": float(row.iloc[0])})
        except Exception:
            pass
    return out


def _fetch_kalshi_search(*, query: str, category: str, min_midpoint: float) -> list[dict]:
    """Search Kalshi contracts via OpenBB — filtered by keyword and midpoint floor."""
    from openbb import obb  # type: ignore[import]
    _ = obb
    # Placeholder — real implementation filters markets by query string and
    # (yes_price + no_price) / 2 >= min_midpoint
    return []


async def run():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(run())
