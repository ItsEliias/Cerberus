"""routes/trader_paper_routes.py — paper-trading simulator endpoints.

All routes are admin-only (require_admin). 100% simulated:
  No real exchange order, no trade key, no real money.
  No real order-submission code exists in this file or this branch.

Routes:
  GET  /api/trader/status         — kill-switch state + paper account snapshot
  POST /api/trader/paper/start    — log a new paper session start
  POST /api/trader/paper/order    — place a simulated paper order (pre-trade gated)
  POST /api/trader/paper/close    — close an open paper position
  GET  /api/trader/paper/stats    — aggregate paper performance (win rate, P&L, CLV)
  GET  /api/trader/ledger         — recent audit-ledger entries
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from core.database import SessionLocal
from core.middleware import require_admin
from trading.mandate import load_mandate, MandateError
from trading.paper_sim import PaperSimulator, GateRejection, KillSwitchTripped
from trading import ledger as _ledger
from src.auth_helpers import get_current_user
from src.constants import DATA_DIR

logger = logging.getLogger(__name__)

KILL_SWITCH_PATH = Path(DATA_DIR) / "trader" / "KILL"
_DEFAULT_BALANCE = 100.0


# ── Pydantic models ────────────────────────────────────────────────────

class StartSessionBody(BaseModel):
    balance: float = Field(default=_DEFAULT_BALANCE, gt=0, le=100_000)


class PlaceOrderBody(BaseModel):
    contract:     str   = Field(min_length=1, max_length=200)
    side:         str   = Field(pattern="^(buy|sell)$")
    size:         int   = Field(ge=1, le=1000)
    price_cents:  int   = Field(ge=1, le=99)
    balance:      float = Field(gt=0, le=100_000)


class ClosePositionBody(BaseModel):
    trade_id:         str
    exit_price_cents: int = Field(ge=1, le=99)


# ── Route factory ──────────────────────────────────────────────────────

def setup_trader_paper_routes() -> APIRouter:
    router = APIRouter(prefix="/api/trader", tags=["trader-paper"])

    @router.get("/status")
    def trader_status(request: Request) -> Dict[str, Any]:
        require_admin(request)
        owner = get_current_user(request) or "admin"

        kill_armed = KILL_SWITCH_PATH.exists()

        mandate_ok = True
        mandate_err: Optional[str] = None
        mandate_data: Optional[dict] = None
        try:
            m = load_mandate()
            mandate_data = {
                "max_position_pct":   m.max_position_pct,
                "max_exposure_pct":   m.max_exposure_pct,
                "daily_loss_cap_pct": m.daily_loss_cap_pct,
                "max_trades_per_day": m.max_trades_per_day,
                "leverage_cap":       m.leverage_cap,
            }
        except MandateError as exc:
            mandate_ok  = False
            mandate_err = str(exc)

        state: Dict[str, Any] = {
            "kill_armed":  kill_armed,
            "mandate_ok":  mandate_ok,
            "mandate_err": mandate_err,
            "mandate":     mandate_data,
            "phase":       "PAPER" if (mandate_ok and not kill_armed) else "HALTED",
        }

        if mandate_ok:
            try:
                m = load_mandate()
                with SessionLocal() as db:
                    sim = PaperSimulator(owner=owner, mandate=m, db=db)
                    state["paper"] = sim.get_state(balance=_DEFAULT_BALANCE)
            except Exception as exc:
                logger.warning("trader_status: get_state failed: %s", exc)
                state["paper"] = None

        return state

    @router.post("/paper/start")
    def paper_start(body: StartSessionBody, request: Request) -> Dict[str, Any]:
        require_admin(request)
        owner = get_current_user(request) or "admin"

        try:
            m = load_mandate()
        except MandateError as exc:
            raise HTTPException(409, f"MANDATE not ready: {exc}")

        try:
            with SessionLocal() as db:
                sim = PaperSimulator(owner=owner, mandate=m, db=db)
                return sim.start_session(balance=body.balance)
        except KillSwitchTripped as exc:
            raise HTTPException(409, str(exc))
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    @router.post("/paper/order")
    def paper_order(body: PlaceOrderBody, request: Request) -> Dict[str, Any]:
        require_admin(request)
        owner = get_current_user(request) or "admin"

        try:
            m = load_mandate()
        except MandateError as exc:
            raise HTTPException(409, f"MANDATE not ready: {exc}")

        try:
            with SessionLocal() as db:
                sim = PaperSimulator(owner=owner, mandate=m, db=db)
                return sim.place_paper_order(
                    contract    = body.contract,
                    side        = body.side,
                    size        = body.size,
                    price_cents = body.price_cents,
                    balance     = body.balance,
                )
        except KillSwitchTripped as exc:
            raise HTTPException(409, str(exc))
        except GateRejection as exc:
            raise HTTPException(422, exc.reason)

    @router.post("/paper/close")
    def paper_close(body: ClosePositionBody, request: Request) -> Dict[str, Any]:
        require_admin(request)
        owner = get_current_user(request) or "admin"

        try:
            m = load_mandate()
        except MandateError as exc:
            raise HTTPException(409, f"MANDATE not ready: {exc}")

        try:
            with SessionLocal() as db:
                sim = PaperSimulator(owner=owner, mandate=m, db=db)
                return sim.close_position(body.trade_id, body.exit_price_cents)
        except GateRejection as exc:
            raise HTTPException(422, exc.reason)

    @router.get("/paper/stats")
    def paper_stats(request: Request) -> Dict[str, Any]:
        """Aggregate paper-trading performance for the PAPER PERFORMANCE panel.

        Metrics:
          total_trades       — all paper trades ever placed
          closed_trades      — trades that have been closed
          win_rate_pct       — % of closed trades with pnl_cents > 0
          total_pnl_cents    — sum of realised P&L (cents); negative = net loss
          daily_loss_cents   — today's realised losses (absolute value, cents)
          today_fills        — trades placed today
          clv_equivalent_pct — % closed trades with positive P&L (proxy for CLV:
                               true CLV needs closing-line data; positive P&L is
                               the available surrogate for Phase 2 paper trades)
          mandate_cap        — max trades/day from loaded mandate (0 if mandate missing)
        """
        require_admin(request)
        owner = get_current_user(request) or "admin"

        from core.database import PaperTrade
        from datetime import date, datetime, timezone

        today = datetime.now(timezone.utc).date()

        with SessionLocal() as db:
            all_trades = (
                db.query(PaperTrade)
                .filter(PaperTrade.owner == owner)
                .all()
            )

        total  = len(all_trades)
        closed = [t for t in all_trades if t.closed_at is not None and t.pnl_cents is not None]
        wins   = [t for t in closed if t.pnl_cents > 0]
        today_all  = [t for t in all_trades if t.created_at and t.created_at.date() == today]
        today_loss = [
            t for t in closed
            if t.closed_at and t.closed_at.date() == today and t.pnl_cents < 0
        ]

        win_rate   = round(len(wins) / len(closed) * 100, 1) if closed else 0.0
        total_pnl  = sum(t.pnl_cents for t in closed)
        daily_loss = sum(abs(t.pnl_cents) for t in today_loss)
        clv_pct    = win_rate  # proxy: positive-P&L rate as CLV surrogate

        mandate_cap = 0
        try:
            from trading.mandate import load_mandate
            m = load_mandate()
            mandate_cap = m.max_trades_per_day
        except Exception:
            pass

        return {
            "total_trades":       total,
            "closed_trades":      len(closed),
            "win_rate_pct":       win_rate,
            "total_pnl_cents":    total_pnl,
            "daily_loss_cents":   daily_loss,
            "today_fills":        len(today_all),
            "clv_equivalent_pct": clv_pct,
            "mandate_cap":        mandate_cap,
        }

    @router.get("/ledger")
    def trader_ledger(request: Request, limit: int = 50) -> Dict[str, Any]:
        require_admin(request)
        owner = get_current_user(request) or "admin"

        limit = max(1, min(limit, 200))
        with SessionLocal() as db:
            entries = _ledger.recent(owner=owner, db=db, limit=limit)
        return {"entries": entries, "count": len(entries)}

    return router
