"""Atlas agent workflow pipeline — reports and plans only, no execution."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

STAGES = ["research", "business", "architect", "developer", "marketing", "completed"]

STAGE_AGENT = {
    "research": "research",
    "business": "business",
    "architect": "architect",
    "developer": "developer",
    "marketing": "marketing",
}

STAGE_ACTION = {
    "research": "business_ideas",
    "business": "business_strategy",
    "architect": "architecture_plan",
    "developer": "developer_review",
    "marketing": "marketing_ideas",
}

NEXT_STAGE = {
    "research": "business",
    "business": "architect",
    "architect": "developer",
    "developer": "marketing",
    "marketing": "completed",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _next_stage(current: str) -> Optional[str]:
    return NEXT_STAGE.get(current)


def create_item(
    title: str,
    *,
    source_agent: str = "research",
    source_report_id: Optional[str] = None,
    status: str = "active",
) -> Dict[str, Any]:
    stage = source_agent if source_agent in STAGES else "research"
    return {
        "id": str(uuid.uuid4()),
        "title": title,
        "source_agent": source_agent,
        "source_report_id": source_report_id,
        "current_stage": stage,
        "status": status,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "reports": [],
        "next_agent": STAGE_AGENT.get(_next_stage(stage) or "", ""),
        "user_approval_required": True,
    }


def apply_action(item: Dict[str, Any], action: str) -> Dict[str, Any]:
    action = (action or "").strip().lower()
    stage = item.get("current_stage", "research")

    if action == "reject":
        item["status"] = "rejected"
        item["updated_at"] = _now_iso()
        return {"ok": True, "item": item, "message": "Pipeline item rejected"}

    if action == "revise":
        item["status"] = "revision"
        item["user_approval_required"] = True
        item["updated_at"] = _now_iso()
        return {"ok": True, "item": item, "message": "Revision requested"}

    if action == "approve":
        nxt = _next_stage(stage)
        if not nxt:
            item["status"] = "completed"
            item["current_stage"] = "completed"
            item["next_agent"] = ""
            item["user_approval_required"] = False
        else:
            item["current_stage"] = nxt
            item["status"] = "active"
            item["next_agent"] = STAGE_AGENT.get(nxt, "")
            item["user_approval_required"] = True
        item["updated_at"] = _now_iso()
        return {"ok": True, "item": item, "message": f"Approved — moved to {item['current_stage']}"}

    send_map = {
        "send_to_business": "business",
        "send_to_architect": "architect",
        "send_to_developer": "developer",
        "send_to_marketing": "marketing",
    }
    if action in send_map:
        target = send_map[action]
        item["current_stage"] = target
        item["status"] = "active"
        item["next_agent"] = STAGE_AGENT.get(target, "")
        item["user_approval_required"] = True
        item["updated_at"] = _now_iso()
        agent_action = STAGE_ACTION.get(target)
        return {
            "ok": True,
            "item": item,
            "message": f"Sent to {target} agent",
            "run_agent_id": STAGE_AGENT.get(target),
            "run_action": agent_action,
        }

    return {"ok": False, "message": f"Unknown pipeline action: {action}"}


def attach_report(item: Dict[str, Any], report_id: str) -> None:
    reports = item.get("reports")
    if not isinstance(reports, list):
        reports = []
    if report_id not in reports:
        reports.append(report_id)
    item["reports"] = reports[-20:]
    item["updated_at"] = _now_iso()
