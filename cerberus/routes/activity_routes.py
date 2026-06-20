"""Activity statistics — daily message/session aggregation for the dashboard heatmap.

  GET /api/stats/activity?days=30

Returns a complete `days` series (missing dates back-filled with zeros) plus
totals and current/longest streak metrics, so the dashboard can render a
GitHub-style activity heatmap without per-cell client logic.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any, Dict, List

from fastapi import APIRouter, Request
from sqlalchemy import func

from core.database import ChatMessage, Session as DbSession, SessionLocal
from src.auth_helpers import require_user

logger = logging.getLogger(__name__)

_DEFAULT_DAYS = 30
_MIN_DAYS = 1
_MAX_DAYS = 90


def _clamp_days(raw) -> int:
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return _DEFAULT_DAYS
    return max(_MIN_DAYS, min(v, _MAX_DAYS))


def _fill_missing_days(
    rows_by_date: Dict[date, Dict[str, int]],
    period_days: int,
    today: date,
) -> List[Dict[str, Any]]:
    """Return a contiguous `period_days`-long series ending at `today`,
    filling missing dates with zeros so the heatmap always gets a clean grid."""
    series: List[Dict[str, Any]] = []
    # `period_days` total entries ending TODAY → start day is today - (period_days-1).
    start = today - timedelta(days=period_days - 1)
    cur = start
    while cur <= today:
        row = rows_by_date.get(cur, {"messages": 0, "sessions": 0})
        series.append({
            "date": cur.isoformat(),
            "messages": int(row.get("messages", 0)),
            "sessions": int(row.get("sessions", 0)),
        })
        cur += timedelta(days=1)
    return series


def _current_streak(series: List[Dict[str, Any]]) -> int:
    """Consecutive days ending TODAY (the last entry) with at least 1 message."""
    streak = 0
    for entry in reversed(series):
        if entry["messages"] > 0:
            streak += 1
        else:
            break
    return streak


def _longest_streak(series: List[Dict[str, Any]]) -> int:
    """Longest run of consecutive days with >=1 message anywhere in the period."""
    longest = 0
    current = 0
    for entry in series:
        if entry["messages"] > 0:
            current += 1
            if current > longest:
                longest = current
        else:
            current = 0
    return longest


def setup_activity_routes() -> APIRouter:
    router = APIRouter(prefix="/api/stats", tags=["stats"])

    @router.get("/activity")
    def activity(request: Request, days: int = _DEFAULT_DAYS) -> Dict[str, Any]:
        owner = require_user(request)
        period = _clamp_days(days)

        # Aggregation is in UTC — both the cutoff and the DATE() bucket key are
        # derived from the timestamp column, which is utcnow_naive at write
        # time. Dates surface to the frontend as ISO strings; users near a
        # midnight boundary will see slight skew vs. their wall clock, which
        # is acceptable for a coarse heatmap.
        today = datetime.utcnow().date()
        cutoff = datetime.combine(
            today - timedelta(days=period - 1),
            datetime.min.time(),
        )

        rows_by_date: Dict[date, Dict[str, int]] = {}
        totals = {"messages": 0, "sessions_active_set": set()}
        db = SessionLocal()
        try:
            day_col = func.date(ChatMessage.timestamp).label("day")
            results = (
                db.query(
                    day_col,
                    func.count(ChatMessage.id).label("message_count"),
                    func.count(func.distinct(ChatMessage.session_id))
                        .label("session_count"),
                )
                .join(DbSession, DbSession.id == ChatMessage.session_id)
                .filter(DbSession.owner == owner)
                .filter(ChatMessage.timestamp >= cutoff)
                .group_by(day_col)
                .order_by(day_col.asc())
                .all()
            )
            for row in results:
                day_raw = row[0]
                if isinstance(day_raw, str):
                    try:
                        d = date.fromisoformat(day_raw)
                    except ValueError:
                        continue
                elif isinstance(day_raw, datetime):
                    d = day_raw.date()
                elif isinstance(day_raw, date):
                    d = day_raw
                else:
                    continue
                rows_by_date[d] = {
                    "messages": int(row[1] or 0),
                    "sessions": int(row[2] or 0),
                }
                totals["messages"] += int(row[1] or 0)

            # Distinct sessions across the WHOLE period (not summed per-day,
            # which would double-count multi-day sessions).
            total_sessions = (
                db.query(func.count(func.distinct(ChatMessage.session_id)))
                .join(DbSession, DbSession.id == ChatMessage.session_id)
                .filter(DbSession.owner == owner)
                .filter(ChatMessage.timestamp >= cutoff)
                .scalar()
            ) or 0
        finally:
            db.close()

        series = _fill_missing_days(rows_by_date, period, today)
        return {
            "days": series,
            "total_messages": totals["messages"],
            "total_sessions": int(total_sessions),
            "current_streak": _current_streak(series),
            "longest_streak": _longest_streak(series),
            "period_days": period,
        }

    return router
