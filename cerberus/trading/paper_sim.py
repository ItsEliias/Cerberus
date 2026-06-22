"""services/trading/paper_sim.py — paper-trading simulator.

100 % SIMULATED.  No real exchange order.  No trade key.  No real money.
No real order-submission code exists in this file or this branch.

Implements:
  PaperSimulator.start_session(balance)   — initialise a paper account
  PaperSimulator.place_paper_order(...)   — simulate a fill with pre-trade gate
  PaperSimulator.get_state()              — UI snapshot (positions, P&L)
  PaperSimulator.close_position(trade_id) — mark a simulated fill as closed

Pre-trade gate (all enforced in-process before any fill is recorded):
  1. Kill switch  — data/trader/KILL file halts everything immediately
  2. MANDATE      — position size, exposure, daily-loss cap, max trades/day
  3. Circuit breaker — today's realised loss ≥ daily_loss_cap_pct → reject
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session as DbSession

from core.database import PaperTrade, PaperLedgerEntry, utcnow_naive
from trading.mandate import Mandate, MandateError
from trading import ledger as _ledger
from src.constants import DATA_DIR

KILL_SWITCH_PATH = Path(DATA_DIR) / "trader" / "KILL"

# Kalshi contracts are priced 0–100 cents; cap sanity check
_MIN_PRICE_CENTS = 1
_MAX_PRICE_CENTS = 99

# Simulated maker fee per contract (Kalshi is free for makers, but model a
# conservative 0 fee since we're paper-only; keep the hook for Phase 3)
_FEE_CENTS_PER_CONTRACT = 0


class GateRejection(Exception):
    """A paper order was rejected by the pre-trade gate.  .reason is human-readable."""
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class KillSwitchTripped(Exception):
    """The kill switch file is present — all trading halted."""


def _kill_switch_armed() -> bool:
    return KILL_SWITCH_PATH.exists()


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _cents(v: float) -> int:
    """Round a float price (0–100) to integer cents."""
    return int(Decimal(str(v)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


class PaperSimulator:
    """Stateless per-request helper backed by the DB.

    Each method opens no long-lived state — all data lives in the DB rows.
    Caller is responsible for the db session lifecycle.
    """

    def __init__(self, owner: str, mandate: Mandate, db: DbSession):
        self._owner   = owner
        self._mandate = mandate
        self._db      = db

    # ── public API ────────────────────────────────────────────────────────

    def start_session(self, balance: float = 100.0) -> dict:
        """Record a new paper session start in the ledger.  Idempotent: calling
        again is fine — it just logs another start event.  Raises KillSwitchTripped
        if the kill file is present.
        """
        if _kill_switch_armed():
            raise KillSwitchTripped("data/trader/KILL is present — no paper sessions")
        if balance <= 0:
            raise ValueError("balance must be positive")
        entry = _ledger.append(
            "session.started",
            {"balance": balance, "mandate": {
                "max_position_pct":   self._mandate.max_position_pct,
                "max_exposure_pct":   self._mandate.max_exposure_pct,
                "daily_loss_cap_pct": self._mandate.daily_loss_cap_pct,
                "max_trades_per_day": self._mandate.max_trades_per_day,
            }},
            self._owner,
            self._db,
        )
        self._db.commit()
        return {"session_started": True, "balance": balance, "ledger_id": entry.id}

    def place_paper_order(
        self,
        contract:    str,
        side:        str,        # "buy" | "sell"
        size:        int,        # number of contracts
        price_cents: int,        # simulated fill price in cents (1–99)
        balance:     float,      # current paper balance for limit calculations
    ) -> dict:
        """Simulate a paper fill after running the full pre-trade gate.
        Raises GateRejection on any limit violation, KillSwitchTripped if armed.
        Returns the recorded PaperTrade as a dict.
        """
        # ── Gate 0: kill switch ──────────────────────────────────────────
        if _kill_switch_armed():
            _ledger.append(
                "kill.halted",
                {"contract": contract, "side": side, "size": size},
                self._owner, self._db,
            )
            self._db.commit()
            raise KillSwitchTripped("data/trader/KILL is present — order halted")

        # ── Gate 1: basic input validation ──────────────────────────────
        if side not in ("buy", "sell"):
            raise GateRejection(f"invalid side '{side}'; must be 'buy' or 'sell'")
        if size <= 0:
            raise GateRejection("size must be ≥ 1 contract")
        if not (_MIN_PRICE_CENTS <= price_cents <= _MAX_PRICE_CENTS):
            raise GateRejection(
                f"price_cents {price_cents} out of range [{_MIN_PRICE_CENTS}, {_MAX_PRICE_CENTS}]"
            )
        if not contract or len(contract) > 200:
            raise GateRejection("contract identifier missing or too long")

        # ── Gate 2: circuit breaker — daily loss cap ─────────────────────
        daily_loss = self._daily_realised_loss(balance)
        if daily_loss >= self._mandate.daily_loss_cap_pct * balance:
            reason = (
                f"circuit breaker: daily loss ${daily_loss:.2f} ≥ "
                f"{self._mandate.daily_loss_cap_pct*100:.1f}% cap"
            )
            _ledger.append(
                "circuit.tripped",
                {"reason": reason, "daily_loss": daily_loss},
                self._owner, self._db,
            )
            self._db.commit()
            raise GateRejection(reason)

        # ── Gate 3: position size ────────────────────────────────────────
        cost = size * price_cents / 100  # dollars
        max_pos = self._mandate.max_position_pct * balance
        if cost > max_pos:
            reason = (
                f"position size ${cost:.2f} exceeds max "
                f"{self._mandate.max_position_pct*100:.0f}% of balance (${max_pos:.2f})"
            )
            _ledger.append("order.rejected", {"reason": reason, "contract": contract},
                           self._owner, self._db)
            self._db.commit()
            raise GateRejection(reason)

        # ── Gate 4: total exposure ───────────────────────────────────────
        current_exposure = self._open_exposure()
        max_exp = self._mandate.max_exposure_pct * balance
        if current_exposure + cost > max_exp:
            reason = (
                f"total exposure ${current_exposure + cost:.2f} would exceed "
                f"{self._mandate.max_exposure_pct*100:.0f}% cap (${max_exp:.2f})"
            )
            _ledger.append("order.rejected", {"reason": reason, "contract": contract},
                           self._owner, self._db)
            self._db.commit()
            raise GateRejection(reason)

        # ── Gate 5: max trades per day ───────────────────────────────────
        today_count = self._today_trade_count()
        if today_count >= self._mandate.max_trades_per_day:
            reason = f"max trades/day ({self._mandate.max_trades_per_day}) reached"
            _ledger.append("order.rejected", {"reason": reason}, self._owner, self._db)
            self._db.commit()
            raise GateRejection(reason)

        # ── Simulated fill ───────────────────────────────────────────────
        trade = PaperTrade(
            id           = str(uuid.uuid4()),
            owner        = self._owner,
            contract     = contract,
            side         = side,
            size         = size,
            fill_price   = str(price_cents),
            pnl_cents    = None,   # open
            closed_at    = None,
        )
        self._db.add(trade)
        _ledger.append(
            "order.placed",
            {"trade_id": trade.id, "contract": contract, "side": side,
             "size": size, "fill_price_cents": price_cents},
            self._owner, self._db,
        )
        self._db.commit()
        return self._trade_to_dict(trade)

    def close_position(self, trade_id: str, exit_price_cents: int) -> dict:
        """Mark a paper trade as closed and record realised P&L."""
        trade = (
            self._db.query(PaperTrade)
            .filter(PaperTrade.id == trade_id, PaperTrade.owner == self._owner)
            .first()
        )
        if not trade:
            raise GateRejection(f"trade {trade_id} not found")
        if trade.closed_at is not None:
            raise GateRejection(f"trade {trade_id} already closed")

        entry_cents = int(trade.fill_price)
        if trade.side == "buy":
            pnl = (exit_price_cents - entry_cents) * trade.size
        else:
            pnl = (entry_cents - exit_price_cents) * trade.size
        pnl -= _FEE_CENTS_PER_CONTRACT * trade.size

        trade.pnl_cents = pnl
        trade.closed_at = utcnow_naive()
        _ledger.append(
            "order.closed",
            {"trade_id": trade_id, "exit_price_cents": exit_price_cents, "pnl_cents": pnl},
            self._owner, self._db,
        )
        self._db.commit()
        return self._trade_to_dict(trade)

    def get_state(self, balance: float) -> dict:
        """Return a snapshot for the CC TRADER panel."""
        open_trades  = self._open_trades()
        closed_today = self._closed_today()
        daily_loss   = self._daily_realised_loss(balance)
        today_count  = self._today_trade_count()
        cbk_pct      = self._mandate.daily_loss_cap_pct * 100
        cbk_used     = (daily_loss / (self._mandate.daily_loss_cap_pct * balance) * 100
                        if self._mandate.daily_loss_cap_pct > 0 else 0)
        return {
            "kill_armed":    _kill_switch_armed(),
            "balance":       balance,
            "open_trades":   [self._trade_to_dict(t) for t in open_trades],
            "open_exposure": self._open_exposure(),
            "daily_loss":    daily_loss,
            "today_fills":   today_count,
            "circuit_used_pct": round(cbk_used, 1),
            "circuit_cap_pct":  cbk_pct,
            "mandate": {
                "max_position_pct":   self._mandate.max_position_pct,
                "max_exposure_pct":   self._mandate.max_exposure_pct,
                "daily_loss_cap_pct": self._mandate.daily_loss_cap_pct,
                "max_trades_per_day": self._mandate.max_trades_per_day,
            },
        }

    # ── private helpers ───────────────────────────────────────────────────

    def _open_trades(self) -> list[PaperTrade]:
        return (
            self._db.query(PaperTrade)
            .filter(PaperTrade.owner == self._owner, PaperTrade.closed_at.is_(None))
            .order_by(PaperTrade.created_at.desc())
            .all()
        )

    def _open_exposure(self) -> float:
        trades = self._open_trades()
        return sum(t.size * int(t.fill_price) / 100 for t in trades)

    def _daily_realised_loss(self, balance: float) -> float:
        """Sum of negative P&L from trades closed today (in dollars, positive = loss)."""
        today = _today()
        closed = (
            self._db.query(PaperTrade)
            .filter(
                PaperTrade.owner     == self._owner,
                PaperTrade.closed_at != None,
                PaperTrade.pnl_cents != None,
            )
            .all()
        )
        loss = 0.0
        for t in closed:
            if t.closed_at and t.closed_at.date() == today and t.pnl_cents < 0:
                loss += abs(t.pnl_cents) / 100
        return loss

    def _today_trade_count(self) -> int:
        today = _today()
        all_today = (
            self._db.query(PaperTrade)
            .filter(PaperTrade.owner == self._owner)
            .all()
        )
        return sum(1 for t in all_today if t.created_at and t.created_at.date() == today)

    def _closed_today(self) -> list[PaperTrade]:
        today = _today()
        closed = (
            self._db.query(PaperTrade)
            .filter(PaperTrade.owner == self._owner, PaperTrade.closed_at != None)
            .all()
        )
        return [t for t in closed if t.closed_at and t.closed_at.date() == today]

    @staticmethod
    def _trade_to_dict(t: PaperTrade) -> dict:
        return {
            "id":           t.id,
            "contract":     t.contract,
            "side":         t.side,
            "size":         t.size,
            "fill_price_cents": int(t.fill_price),
            "pnl_cents":    t.pnl_cents,
            "open":         t.closed_at is None,
            "created_at":   t.created_at.isoformat() if t.created_at else None,
            "closed_at":    t.closed_at.isoformat()  if t.closed_at  else None,
        }
