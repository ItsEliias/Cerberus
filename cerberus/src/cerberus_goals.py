"""Cerberus OS goals — local JSON persistence."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.cerberus_config import data_dir

_DEFAULT_GOALS = {
    "goals": []
}


def _goals_path() -> Path:
    return data_dir() / "goals.json"


def load_goals() -> Dict[str, Any]:
    path = _goals_path()
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        save_goals(_DEFAULT_GOALS)
        return dict(_DEFAULT_GOALS)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get("goals"), list):
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return dict(_DEFAULT_GOALS)


def save_goals(data: Dict[str, Any]) -> Dict[str, Any]:
    path = _goals_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    goals = data.get("goals")
    if not isinstance(goals, list):
        goals = _DEFAULT_GOALS["goals"]
    out = {"goals": goals}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    return out


def patch_goal(goal_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    data = load_goals()
    for g in data.get("goals") or []:
        if g.get("id") == goal_id:
            for key in ("title", "type", "current", "target", "currency"):
                if key in updates and updates[key] is not None:
                    g[key] = updates[key]
            save_goals(data)
            return g
    return None
