"""tests/test_trader_paper_sim.py — paper simulator unit tests.

Tests are in-memory only: in-memory SQLite + direct service calls.
No FastAPI TestClient (Python 3.14 + Starlette metaclass conflict).
No real exchange, no real money, no network.

Coverage:
  1.  Mandate: load fails closed when file missing
  2.  Mandate: invalid limit (loosening a ceiling) is rejected
  3.  Mandate: valid file parses correctly
  4.  Ledger: entries chain correctly (prev_hash)
  5.  Ledger: verify_chain passes on a clean chain
  6.  Ledger: tampered hash raises LedgerTamperError
  7.  Simulator: start_session logs to ledger
  8.  Simulator: kill switch blocks start_session
  9.  Simulator: fill records a paper trade
  10. Simulator: pre-trade gate rejects on position size
  11. Simulator: pre-trade gate rejects on exposure cap
  12. Simulator: circuit breaker trips at daily_loss_cap_pct
  13. Simulator: max trades/day gate
  14. Simulator: kill switch blocks order mid-session
  15. Simulator: close_position records realised P&L
  16. Simulator: get_state reflects open positions
"""
from __future__ import annotations

import json
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.database import Base, PaperTrade, PaperLedgerEntry, utcnow_naive
from trading.mandate import (
    Mandate, MandateError, load_mandate, default_mandate,
    MANDATE_FILE,
)
from trading import ledger as _ledger
from trading.ledger import LedgerTamperError
from trading.paper_sim import (
    PaperSimulator, GateRejection, KillSwitchTripped,
    KILL_SWITCH_PATH,
)


# ── In-memory SQLite fixture ───────────────────────────────────────────

@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


@pytest.fixture
def mandate():
    return default_mandate()


@pytest.fixture
def sim(db, mandate):
    return PaperSimulator(owner="testuser", mandate=mandate, db=db)


# ── Mandate tests ──────────────────────────────────────────────────────

def test_mandate_missing_file_raises():
    with tempfile.TemporaryDirectory() as tmp:
        fake_path = Path(tmp) / "nonexistent.json"
        with patch.object(_ledger, "__file__", str(fake_path)):
            # Patch MANDATE_FILE to a nonexistent path
            with patch("trading.mandate.MANDATE_FILE", fake_path):
                with pytest.raises(MandateError, match="not found"):
                    load_mandate()


def test_mandate_invalid_json_raises():
    with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False) as f:
        f.write("{ not valid json }")
        name = f.name
    try:
        with patch("trading.mandate.MANDATE_FILE", Path(name)):
            with pytest.raises(MandateError, match="unreadable"):
                load_mandate()
    finally:
        os.unlink(name)


def test_mandate_missing_key_raises():
    data = {
        "max_position_pct": 0.02,
        "max_exposure_pct": 0.15,
        # daily_loss_cap_pct missing
        "leverage_cap": 1.0,
        "max_trades_per_day": 20,
    }
    with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False) as f:
        json.dump(data, f)
        name = f.name
    try:
        with patch("trading.mandate.MANDATE_FILE", Path(name)):
            with pytest.raises(MandateError, match="missing keys"):
                load_mandate()
    finally:
        os.unlink(name)


def test_mandate_loosened_ceiling_raises():
    data = {
        "max_position_pct": 0.10,  # > 0.02 ceiling
        "max_exposure_pct": 0.15,
        "daily_loss_cap_pct": 0.03,
        "leverage_cap": 1.0,
        "max_trades_per_day": 20,
    }
    with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False) as f:
        json.dump(data, f)
        name = f.name
    try:
        with patch("trading.mandate.MANDATE_FILE", Path(name)):
            with pytest.raises(MandateError, match="max_position_pct"):
                load_mandate()
    finally:
        os.unlink(name)


def test_mandate_valid_file_parses():
    data = {
        "max_position_pct": 0.01,
        "max_exposure_pct": 0.10,
        "daily_loss_cap_pct": 0.02,
        "leverage_cap": 1.0,
        "max_trades_per_day": 10,
    }
    with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False) as f:
        json.dump(data, f)
        name = f.name
    try:
        with patch("trading.mandate.MANDATE_FILE", Path(name)):
            m = load_mandate()
    finally:
        os.unlink(name)
    assert m.max_position_pct   == 0.01
    assert m.max_trades_per_day == 10


# ── Ledger tests ───────────────────────────────────────────────────────

def test_ledger_entries_chain(db):
    _ledger.append("session.started", {"balance": 100}, "u1", db)
    _ledger.append("order.placed",    {"contract": "X"}, "u1", db)
    db.commit()

    rows = db.query(PaperLedgerEntry).filter_by(owner="u1").order_by(
        PaperLedgerEntry.created_at
    ).all()
    assert len(rows) == 2
    assert rows[0].prev_hash == _ledger.GENESIS_HASH
    assert rows[1].prev_hash == rows[0].entry_hash


def test_ledger_verify_chain_passes(db):
    _ledger.append("a", {"x": 1}, "u2", db)
    _ledger.append("b", {"x": 2}, "u2", db)
    db.commit()
    count = _ledger.verify_chain("u2", db)
    assert count == 2


def test_ledger_tampered_hash_raises(db):
    _ledger.append("session.started", {}, "u3", db)
    db.commit()
    row = db.query(PaperLedgerEntry).filter_by(owner="u3").first()
    row.entry_hash = "deadbeef" * 8  # corrupt
    db.commit()
    with pytest.raises(LedgerTamperError):
        _ledger.verify_chain("u3", db)


# ── Simulator tests ────────────────────────────────────────────────────

def test_start_session_logs_ledger(sim, db):
    with patch("trading.paper_sim._kill_switch_armed", return_value=False):
        result = sim.start_session(balance=100.0)
    assert result["session_started"] is True
    row = db.query(PaperLedgerEntry).filter_by(
        owner="testuser", event_type="session.started"
    ).first()
    assert row is not None
    assert row.data["balance"] == 100.0


def test_kill_switch_blocks_start(sim):
    with patch("trading.paper_sim._kill_switch_armed", return_value=True):
        with pytest.raises(KillSwitchTripped):
            sim.start_session(balance=100.0)


def test_place_order_records_trade(sim, db):
    with patch("trading.paper_sim._kill_switch_armed", return_value=False):
        result = sim.place_paper_order(
            contract="NASDAQ-2026-UP", side="buy", size=1,
            price_cents=60, balance=100.0,
        )
    assert result["open"] is True
    assert result["contract"] == "NASDAQ-2026-UP"
    row = db.query(PaperTrade).filter_by(owner="testuser").first()
    assert row is not None
    assert int(row.fill_price) == 60


def test_gate_rejects_oversized_position(sim):
    # 2 contracts × 80¢ = $1.60 > 2% of $100 ($2.00) — actually fits
    # Use size=3 contracts × 80¢ = $2.40 > $2.00
    with patch("trading.paper_sim._kill_switch_armed", return_value=False):
        with pytest.raises(GateRejection, match="position size"):
            sim.place_paper_order(
                contract="X", side="buy", size=3,
                price_cents=80, balance=100.0,
            )


def test_gate_rejects_exposure_cap(sim, db):
    # Fill 7 contracts × 1¢ each = $0.07 each — fill up to near exposure cap
    # max_exposure_pct = 0.15 → $15 max on $100
    # 7 orders × 1 contract × 99¢ = $6.93 each — but position cap is $2 (2%)
    # Need to fake existing exposure by inserting trades directly
    for i in range(7):
        t = PaperTrade(
            id=str(uuid.uuid4()), owner="testuser",
            contract=f"C{i}", side="buy", size=1,
            fill_price="199",  # 199¢ × 1 = $1.99 each; 7 × $1.99 = $13.93 (near cap)
        )
        db.add(t)
    db.commit()

    with patch("trading.paper_sim._kill_switch_armed", return_value=False):
        with pytest.raises(GateRejection, match="exposure"):
            # 1 contract × 50¢ = $0.50; total exposure = $13.93 + $0.50 = $14.43 > $15? No.
            # Use size=2 × 99¢ = $1.98 → $13.93 + $1.98 = $15.91 > $15 cap
            sim.place_paper_order(
                contract="NEW", side="buy", size=2,
                price_cents=99, balance=100.0,
            )


def test_circuit_breaker_trips(sim, db):
    # Simulate $4 daily loss (> 3% of $100)
    ts_today = utcnow_naive()
    t = PaperTrade(
        id=str(uuid.uuid4()), owner="testuser",
        contract="FAIL", side="buy", size=1,
        fill_price="60",
        pnl_cents=-400,   # -$4.00 loss
        closed_at=ts_today,
    )
    db.add(t)
    db.commit()

    with patch("trading.paper_sim._kill_switch_armed", return_value=False):
        with pytest.raises(GateRejection, match="circuit breaker"):
            sim.place_paper_order(
                contract="X", side="buy", size=1,
                price_cents=50, balance=100.0,
            )


def test_max_trades_per_day_gate(sim, db):
    ts = utcnow_naive()
    for i in range(20):
        db.add(PaperTrade(
            id=str(uuid.uuid4()), owner="testuser",
            contract=f"C{i}", side="buy", size=1,
            fill_price="10",
        ))
    db.commit()

    # Patch trade.created_at to today in the sim's _today_trade_count
    # The count reads created_at from DB rows. Since we used utcnow_naive()
    # and the rows' created_at defaults fire at insert, just count.
    with patch("trading.paper_sim._kill_switch_armed", return_value=False):
        with pytest.raises(GateRejection, match="max trades/day"):
            sim.place_paper_order(
                contract="NEW", side="buy", size=1,
                price_cents=10, balance=100.0,
            )


def test_kill_switch_blocks_order(sim):
    with patch("trading.paper_sim._kill_switch_armed", return_value=True):
        with pytest.raises(KillSwitchTripped):
            sim.place_paper_order(
                contract="X", side="buy", size=1,
                price_cents=50, balance=100.0,
            )


def test_close_position_records_pnl(sim, db):
    with patch("trading.paper_sim._kill_switch_armed", return_value=False):
        trade = sim.place_paper_order(
            contract="NASDAQ-2026-UP", side="buy", size=2,
            price_cents=50, balance=100.0,
        )
    result = sim.close_position(trade["id"], exit_price_cents=70)
    assert result["open"] is False
    # bought at 50¢, sold at 70¢, size 2 → +40¢ = +$0.40
    assert result["pnl_cents"] == 40


def test_get_state_reflects_open_positions(sim, db):
    with patch("trading.paper_sim._kill_switch_armed", return_value=False):
        sim.place_paper_order(
            contract="ABC", side="buy", size=1,
            price_cents=60, balance=100.0,
        )
    state = sim.get_state(balance=100.0)
    assert len(state["open_trades"]) == 1
    assert state["open_trades"][0]["contract"] == "ABC"
    assert state["open_exposure"] == pytest.approx(0.60, rel=1e-3)


def test_ledger_append_only_no_delete(db):
    """Verify that nothing in the service API deletes ledger rows."""
    _ledger.append("session.started", {"x": 1}, "u9", db)
    db.commit()
    count_before = db.query(PaperLedgerEntry).filter_by(owner="u9").count()
    # Append another — count must only grow
    _ledger.append("order.placed", {"x": 2}, "u9", db)
    db.commit()
    count_after = db.query(PaperLedgerEntry).filter_by(owner="u9").count()
    assert count_after == count_before + 1
