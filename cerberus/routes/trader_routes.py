"""
trader_routes.py — Phase 1 TRADER API: market data + research briefs.

Phase 1 invariant (APPROVAL GATE):
  All routes in this file are READ-ONLY or trigger RESEARCH generation.
  No route places, modifies, or cancels an order. No route reads or writes
  exchange credentials. Adding order endpoints here is a Phase 3 task.
  Ref: docs/TRADER_AGENT_RISK_AND_PHASING.md §2 / docs/TRADER_AGENT_ARCHITECTURE.md §6

Routes:
  GET  /api/trader/markets              — all active Kalshi markets (paginated)
  GET  /api/trader/markets/threshold    — markets ≥ KALSHI_MAKER_THRESHOLD midpoint
  GET  /api/trader/markets/{ticker}     — single contract detail
  POST /api/trader/brief                — trigger a Council brief cycle (async)
  GET  /api/trader/briefs               — list persisted briefs for this owner
  GET  /api/trader/briefs/{id}          — single brief detail
"""

import logging
from datetime import datetime
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from core.database import SessionLocal, TraderBrief
from src.auth_helpers import require_user
from services.trading.kalshi_data import (
    get_active_markets,
    get_contract,
    get_filtered_markets,
    enrich_with_timestamp,
    KalshiDataError,
    DEFAULT_MAKER_THRESHOLD,
)

logger = logging.getLogger(__name__)

_PAGE_MAX = 200
_BRIEF_PAGE_MAX = 50


class BriefRequest(BaseModel):
    limit: int = 5  # max contracts to debate in one cycle


def setup_trader_routes() -> APIRouter:
    router = APIRouter(prefix="/api/trader", tags=["trader"])

    @router.get("/markets")
    async def list_markets(
        request: Request,
        limit: int = 50,
        cursor: str | None = None,
        status: str = "open",
    ):
        """Return active Kalshi markets (raw, unfiltered). Read-only."""
        require_user(request)
        try:
            data = await get_active_markets(
                limit=min(limit, _PAGE_MAX), cursor=cursor, status=status
            )
            return data
        except KalshiDataError as e:
            logger.warning("Kalshi market list failed: %s", e)
            raise HTTPException(502, detail=str(e))
        except Exception as e:
            logger.error("Unexpected error in list_markets: %s", e)
            raise HTTPException(500, detail="Market data unavailable")

    @router.get("/markets/threshold")
    async def list_threshold_markets(request: Request, limit: int = 50):
        """Return markets where YES/NO midpoint ≥ maker threshold (default 50¢)."""
        require_user(request)
        try:
            markets = await get_filtered_markets(
                min_midpoint=DEFAULT_MAKER_THRESHOLD, limit=min(limit, _PAGE_MAX)
            )
            markets = enrich_with_timestamp(markets)
            return {"markets": markets, "threshold": DEFAULT_MAKER_THRESHOLD, "count": len(markets)}
        except KalshiDataError as e:
            logger.warning("Kalshi threshold filter failed: %s", e)
            raise HTTPException(502, detail=str(e))
        except Exception as e:
            logger.error("Unexpected error in list_threshold_markets: %s", e)
            raise HTTPException(500, detail="Market data unavailable")

    @router.get("/markets/{ticker}")
    async def get_market(request: Request, ticker: str):
        """Return a single Kalshi contract by ticker. Read-only."""
        require_user(request)
        try:
            data = await get_contract(ticker)
            return data
        except KalshiDataError as e:
            if "404" in str(e):
                raise HTTPException(404, detail=f"Contract not found: {ticker}")
            logger.warning("Kalshi contract fetch failed: %s", e)
            raise HTTPException(502, detail=str(e))
        except ValueError as e:
            raise HTTPException(400, detail=str(e))
        except Exception as e:
            logger.error("Unexpected error in get_market(%s): %s", ticker, e)
            raise HTTPException(500, detail="Market data unavailable")

    @router.post("/brief")
    async def trigger_brief(request: Request, body: BriefRequest):
        """Generate Council research briefs for top threshold contracts.

        This is RESEARCH ONLY — no order is placed or implied.
        Runs the full Bull/Bear/Risk/Synthesis debate and persists results.
        """
        owner = require_user(request)
        limit = max(1, min(body.limit, 10))

        db = SessionLocal()
        try:
            from services.trading.brief_service import run_brief_cycle
            briefs = await run_brief_cycle(owner=owner, limit=limit, db_session=db)
            return {
                "generated": len(briefs),
                "briefs": [_brief_summary(b) for b in briefs],
            }
        except RuntimeError as e:
            raise HTTPException(503, detail=str(e))
        except Exception as e:
            logger.error("Brief cycle failed for owner=%s: %s", owner, e)
            raise HTTPException(500, detail="Brief generation failed")
        finally:
            db.close()

    @router.get("/briefs")
    def list_briefs(request: Request, limit: int = 20, offset: int = 0):
        """List persisted research briefs for this owner, newest first."""
        owner = require_user(request)
        db = SessionLocal()
        try:
            rows = (
                db.query(TraderBrief)
                .filter(TraderBrief.owner == owner)
                .order_by(TraderBrief.created_at.desc())
                .offset(offset)
                .limit(min(limit, _BRIEF_PAGE_MAX))
                .all()
            )
            return {"briefs": [_brief_summary(_row_to_dict(r)) for r in rows]}
        finally:
            db.close()

    @router.get("/briefs/{brief_id}")
    def get_brief(request: Request, brief_id: str):
        """Return full detail for a single research brief."""
        owner = require_user(request)
        db = SessionLocal()
        try:
            row = (
                db.query(TraderBrief)
                .filter(TraderBrief.id == brief_id, TraderBrief.owner == owner)
                .first()
            )
            if not row:
                raise HTTPException(404, detail="Brief not found")
            return _row_to_dict(row)
        finally:
            db.close()

    return router


def _brief_summary(b: dict) -> dict:
    """Strip long text fields for list views."""
    return {
        "id": b.get("id"),
        "contract_ticker": b.get("contract_ticker"),
        "contract_title": b.get("contract_title"),
        "midpoint": b.get("midpoint"),
        "direction": b.get("direction"),
        "confidence": b.get("confidence"),
        "rationale": b.get("rationale"),
        "risk_flags": b.get("risk_flags"),
        "model_used": b.get("model_used"),
        "created_at": b.get("created_at"),
    }


def _row_to_dict(row: TraderBrief) -> dict:
    return {
        "id": row.id,
        "owner": row.owner,
        "contract_ticker": row.contract_ticker,
        "contract_title": row.contract_title,
        "midpoint": row.midpoint,
        "fetched_at": row.fetched_at.isoformat() if row.fetched_at else None,
        "bull_analysis": row.bull_analysis,
        "bear_analysis": row.bear_analysis,
        "risk_review": row.risk_review,
        "synthesis_json": row.synthesis_json,
        "direction": row.direction,
        "confidence": row.confidence,
        "rationale": row.rationale,
        "risk_flags": row.risk_flags,
        "model_used": row.model_used,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
