"""services/trading/mandate.py — MANDATE loader and validator.

Reads data/trader/mandate.json at each call (fail-closed design):
  - Missing file → MandateError (no trading)
  - Malformed / missing keys → MandateError (no trading)
  - Unknown keys are ignored

Absolute limits that cannot be weakened by the file:
  MAX_POSITION_FLOOR  = 0.02   (2 % of balance per contract)
  MAX_EXPOSURE_FLOOR  = 0.15   (15 % total open exposure)
  DAILY_LOSS_FLOOR    = 0.03   (3 % daily loss cap)
  LEVERAGE_CAP_FLOOR  = 1.0    (no leverage — paper only)
  MAX_TRADES_FLOOR    = 20     (trades per day)

The file may ONLY make limits more conservative, never looser.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from src.constants import DATA_DIR

MANDATE_FILE = Path(DATA_DIR) / "trader" / "mandate.json"

# Absolute ceilings — the file cannot loosen these
_MAX_POSITION_CEILING = 0.02
_MAX_EXPOSURE_CEILING = 0.15
_DAILY_LOSS_CEILING   = 0.03
_LEVERAGE_CEILING     = 1.0
_MAX_TRADES_CEILING   = 20

_REQUIRED_KEYS = {
    "max_position_pct",
    "max_exposure_pct",
    "daily_loss_cap_pct",
    "leverage_cap",
    "max_trades_per_day",
}


class MandateError(Exception):
    """Raised when the MANDATE is missing, malformed, or violated."""


@dataclass(frozen=True)
class Mandate:
    max_position_pct:  float  # max fraction of balance per single position
    max_exposure_pct:  float  # max fraction of balance in total open positions
    daily_loss_cap_pct: float  # circuit-breaker: halt if day's realised loss exceeds this
    leverage_cap:      float  # must be ≤ 1.0 — paper only
    max_trades_per_day: int   # hard cap on fills per UTC day


def load_mandate() -> Mandate:
    """Load and validate the MANDATE file.  Fail-closed: any problem raises MandateError."""
    if not MANDATE_FILE.exists():
        raise MandateError(
            f"MANDATE file not found at {MANDATE_FILE}. "
            "Create data/trader/mandate.json before starting a paper session."
        )
    try:
        raw: Any = json.loads(MANDATE_FILE.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        raise MandateError(f"MANDATE file unreadable: {exc}") from exc

    if not isinstance(raw, dict):
        raise MandateError("MANDATE file must be a JSON object")

    missing = _REQUIRED_KEYS - set(raw)
    if missing:
        raise MandateError(f"MANDATE missing keys: {sorted(missing)}")

    try:
        m = Mandate(
            max_position_pct  = float(raw["max_position_pct"]),
            max_exposure_pct  = float(raw["max_exposure_pct"]),
            daily_loss_cap_pct = float(raw["daily_loss_cap_pct"]),
            leverage_cap      = float(raw["leverage_cap"]),
            max_trades_per_day = int(raw["max_trades_per_day"]),
        )
    except (TypeError, ValueError) as exc:
        raise MandateError(f"MANDATE has invalid values: {exc}") from exc

    _validate(m)
    return m


def _validate(m: Mandate) -> None:
    """Reject any mandate that is looser than the absolute ceilings."""
    errors = []
    if m.max_position_pct  > _MAX_POSITION_CEILING:
        errors.append(f"max_position_pct {m.max_position_pct} > {_MAX_POSITION_CEILING}")
    if m.max_exposure_pct  > _MAX_EXPOSURE_CEILING:
        errors.append(f"max_exposure_pct {m.max_exposure_pct} > {_MAX_EXPOSURE_CEILING}")
    if m.daily_loss_cap_pct > _DAILY_LOSS_CEILING:
        errors.append(f"daily_loss_cap_pct {m.daily_loss_cap_pct} > {_DAILY_LOSS_CEILING}")
    if m.leverage_cap      > _LEVERAGE_CEILING:
        errors.append(f"leverage_cap {m.leverage_cap} > {_LEVERAGE_CEILING}")
    if m.max_trades_per_day > _MAX_TRADES_CEILING:
        errors.append(f"max_trades_per_day {m.max_trades_per_day} > {_MAX_TRADES_CEILING}")
    if m.max_position_pct  <= 0:
        errors.append("max_position_pct must be positive")
    if m.daily_loss_cap_pct <= 0:
        errors.append("daily_loss_cap_pct must be positive")
    if m.max_trades_per_day <= 0:
        errors.append("max_trades_per_day must be positive")
    if errors:
        raise MandateError("MANDATE validation failed: " + "; ".join(errors))


def default_mandate() -> Mandate:
    """Return the conservative defaults used when no file has been created yet.
    These are NOT loaded by load_mandate() — callers that want fail-closed
    behaviour should use load_mandate() directly.  This exists only for tests.
    """
    return Mandate(
        max_position_pct   = 0.02,
        max_exposure_pct   = 0.15,
        daily_loss_cap_pct = 0.03,
        leverage_cap       = 1.0,
        max_trades_per_day = 20,
    )
