"""Atlas AI Council — workflow rules and stage orchestration (reports only)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from src.cerberus_config import _read_json, _write_json

_COUNCIL_FILE = "council.json"

_DEFAULT: Dict[str, Any] = {
    "enabled": True,
    "approval_required": True,
    "stages": ["research", "business", "architect", "developer", "marketing"],
    "future_channels": {"sms": False, "whatsapp": False, "email": False},
    "rules": [
        "Agents generate reports only unless approved.",
        "No posting, payments, or code execution without approval.",
        "Business goal is to help the user make progress ethically and practically.",
    ],
}

STAGE_ACTIONS: Dict[str, str] = {
    "research": "market_opportunity_report",
    "business": "monetisation_report",
    "architect": "architecture_review",
    "developer": "codebase_review",
    "marketing": "launch_strategy",
}

STAGE_AGENTS: Dict[str, str] = {
    "research": "research",
    "business": "business",
    "architect": "architect",
    "developer": "developer",
    "marketing": "marketing",
}


def load_council() -> Dict[str, Any]:
    data = _read_json(_COUNCIL_FILE)
    if not data:
        return dict(_DEFAULT)
    out = dict(_DEFAULT)
    out.update(data)
    return out


def save_council(patch: Dict[str, Any]) -> Dict[str, Any]:
    current = load_council()
    current.update(patch)
    _write_json(_COUNCIL_FILE, current)
    return current


def council_context_block() -> str:
    c = load_council()
    if not c.get("enabled"):
        return ""
    stages = ", ".join(c.get("stages") or [])
    rules = c.get("rules") or []
    rules_txt = "\n".join(f"- {r}" for r in rules)
    approval = "required" if c.get("approval_required") else "optional"
    return (
        "## Atlas AI Council\n"
        f"Stages: {stages}\n"
        f"Approval between stages: {approval}\n"
        "Agents produce reports and recommendations only — no autonomous execution.\n"
        f"{rules_txt}\n"
    )


def next_stage(after: Optional[str]) -> Optional[str]:
    c = load_council()
    stages: List[str] = list(c.get("stages") or [])
    if not after:
        return stages[0] if stages else None
    try:
        idx = stages.index(after)
        return stages[idx + 1] if idx + 1 < len(stages) else None
    except ValueError:
        return None
