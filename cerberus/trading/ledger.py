"""services/trading/ledger.py — append-only paper-trade audit ledger.

Every trader event (order placed, order rejected, circuit tripped, kill
halted, session started/ended) is recorded as an immutable entry linked
by SHA-256 hash chaining.  The chain root is the zero hash; each entry
stores its own hash and the previous entry's hash.

Verify the chain with verify_chain(owner, db) — any tampered entry
raises LedgerTamperError.

This module writes only. It never deletes or updates existing rows.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session as DbSession

from core.database import PaperLedgerEntry, utcnow_naive


GENESIS_HASH = "0" * 64


class LedgerError(Exception):
    """Raised when the ledger cannot be written."""


class LedgerTamperError(Exception):
    """Raised when chain verification detects a tampered entry."""


def _compute_hash(prev_hash: str, event_type: str, data: Any, ts: str) -> str:
    payload = json.dumps({
        "prev": prev_hash,
        "event": event_type,
        "data": data,
        "ts": ts,
    }, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def _last_hash(owner: str, db: DbSession) -> str:
    last = (
        db.query(PaperLedgerEntry)
        .filter(PaperLedgerEntry.owner == owner)
        .order_by(PaperLedgerEntry.created_at.desc())
        .first()
    )
    return last.entry_hash if last else GENESIS_HASH


def append(event_type: str, data: Any, owner: str, db: DbSession) -> PaperLedgerEntry:
    """Append one event to the ledger.  Returns the new entry."""
    # Pin the timestamp so verify_chain can recompute the same hash from r.created_at.
    ts_val = utcnow_naive()
    ts = ts_val.isoformat()
    prev = _last_hash(owner, db)
    h = _compute_hash(prev, event_type, data, ts)
    entry = PaperLedgerEntry(
        id         = str(uuid.uuid4()),
        owner      = owner,
        event_type = event_type,
        data       = data,
        prev_hash  = prev,
        entry_hash = h,
        created_at = ts_val,
        updated_at = ts_val,
    )
    db.add(entry)
    db.flush()
    return entry


def recent(owner: str, db: DbSession, limit: int = 50) -> list[dict]:
    """Return the most recent ledger entries as dicts, newest first."""
    rows = (
        db.query(PaperLedgerEntry)
        .filter(PaperLedgerEntry.owner == owner)
        .order_by(PaperLedgerEntry.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id":         r.id,
            "ts":         r.created_at.isoformat() if r.created_at else "",
            "event_type": r.event_type,
            "data":       r.data,
            "hash":       r.entry_hash,
        }
        for r in rows
    ]


def verify_chain(owner: str, db: DbSession) -> int:
    """Walk the full chain from genesis; raise LedgerTamperError on mismatch.
    Returns the number of entries verified.
    """
    rows = (
        db.query(PaperLedgerEntry)
        .filter(PaperLedgerEntry.owner == owner)
        .order_by(PaperLedgerEntry.created_at.asc())
        .all()
    )
    expected_prev = GENESIS_HASH
    for r in rows:
        if r.prev_hash != expected_prev:
            raise LedgerTamperError(
                f"Entry {r.id}: prev_hash mismatch (expected {expected_prev[:8]}…, "
                f"got {r.prev_hash[:8]}…)"
            )
        ts = r.created_at.isoformat() if r.created_at else ""
        recomputed = _compute_hash(r.prev_hash, r.event_type, r.data, ts)
        if recomputed != r.entry_hash:
            raise LedgerTamperError(
                f"Entry {r.id}: hash mismatch — entry has been tampered"
            )
        expected_prev = r.entry_hash
    return len(rows)
