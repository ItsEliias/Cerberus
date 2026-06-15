"""Community Edition — one-time wipe of personal/demo user data."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger(__name__)

_CONFIG_FILES = (
    "cerberus_identity.json",
    "aurelius_profile.json",
    "projects.json",
    "agents.json",
    "reports.json",
    "finance.json",
    "pipeline.json",
    "workspace.json",
    "personal_finance.json",
    "desktop_permissions.json",
    "briefing_settings.json",
    "council.json",
    "goals.json",
    "user_settings.json",
    "default_profile.json",
)

_EMPTY_PERSONAL: Dict[str, Any] = {
    "bills": [],
    "work_log": [],
    "weekly_deductions": [],
    "settings": {
        "full_day_rate": 0,
        "half_day_rate": 0,
        "payout_weekday": 5,
    },
    "calendar_reminders": [],
}


def wipe_personal_finance() -> Dict[str, Any]:
    from src.cerberus_personal_finance import save_personal_finance
    return save_personal_finance(dict(_EMPTY_PERSONAL))


def wipe_goals() -> Dict[str, Any]:
    from src.cerberus_goals import save_goals
    return save_goals({"goals": []})


def wipe_calendar_events() -> Dict[str, Any]:
    try:
        from core.database import CalendarEvent, SessionLocal
        db = SessionLocal()
        try:
            count = db.query(CalendarEvent).delete()
            db.commit()
            return {"ok": True, "deleted_events": count}
        finally:
            db.close()
    except Exception as exc:
        logger.warning("[ce-wipe] calendar wipe failed: %s", exc)
        return {"ok": False, "message": str(exc), "deleted_events": 0}


def reset_ce_data_from_defaults() -> Dict[str, Any]:
    """Overwrite runtime data/atlas with bundled CE defaults and clear indexes."""
    from src.cerberus_config import data_dir

    root = Path(__file__).resolve().parents[1]
    defaults = root / "config" / "atlas"
    data = data_dir()
    data.mkdir(parents=True, exist_ok=True)
    restored: list[str] = []
    for name in _CONFIG_FILES:
        src = defaults / name
        if not src.is_file():
            continue
        dest = data / name
        shutil.copy2(src, dest)
        restored.append(name)
    indexes = data / "project_indexes"
    removed = 0
    if indexes.is_dir():
        for f in indexes.glob("*.json"):
            try:
                f.unlink()
                removed += 1
            except OSError as exc:
                logger.warning("[ce-wipe] could not remove %s: %s", f, exc)
    # Personal project summaries (left behind by pre-CE builds) must go too —
    # they carry project names/details a CE install should never show.
    summaries = data / "project_summaries"
    removed_summaries = 0
    if summaries.is_dir():
        for f in summaries.glob("*.json"):
            try:
                f.unlink()
                removed_summaries += 1
            except OSError as exc:
                logger.warning("[ce-wipe] could not remove %s: %s", f, exc)
    return {
        "ok": True,
        "restored": restored,
        "removed_indexes": removed,
        "removed_summaries": removed_summaries,
    }


def wipe_all_personal_data() -> Dict[str, Any]:
    reset = reset_ce_data_from_defaults()
    finance = wipe_personal_finance()
    goals = wipe_goals()
    calendar = wipe_calendar_events()
    return {
        "ok": True,
        "reset": reset,
        "finance": finance,
        "goals": goals,
        "calendar": calendar,
    }
