"""Atlas Project Command Centre — aggregated project HQ data and actions."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.cerberus_config import data_dir, load_projects, load_reports, save_projects
from src.cerberus_council import STAGE_ACTIONS, STAGE_AGENTS, load_council, next_stage
from src.cerberus_desktop import desktop_capabilities_for_project, desktop_status
from src.cerberus_mount_workspace import enrich_project
from src.cerberus_project_index import load_index, load_summary
from src.cerberus_projects import (
    build_project_context,
    finance_for_project,
    format_last_activity,
    record_activity,
    reports_for_project,
    toggle_pin,
)
from src.cerberus_workspace import load_workspace

logger = logging.getLogger(__name__)

_ACTIVE_FILE = "active_project.json"

STAGE_LABELS = {
    "research": "Research",
    "business": "Business",
    "architect": "Architect",
    "developer": "Developer",
    "marketing": "Marketing",
}

VALID_STAGES = (
    "idea",
    "prototype",
    "active build",
    "launch-ready",
    "live",
    "paused",
    "unknown",
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _parse_ts(ts: Optional[str]) -> float:
    if not ts:
        return 0.0
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _active_path() -> Path:
    return data_dir() / _ACTIVE_FILE


def load_active_project() -> Optional[Dict[str, Any]]:
    path = _active_path()
    if not path.is_file():
        return None
    try:
        import json
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def save_active_project(project_id: str) -> Dict[str, Any]:
    import json
    payload = {"project_id": project_id, "set_at": _now_iso()}
    path = _active_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    return payload


def clear_active_project() -> None:
    path = _active_path()
    if path.is_file():
        try:
            path.unlink()
        except OSError:
            pass


def _index_stale(project: Dict[str, Any], summary: Optional[Dict[str, Any]]) -> bool:
    if not project.get("last_indexed_at") and not summary:
        return True
    ch = project.get("recent_changes") or {}
    change_total = (ch.get("new_count") or 0) + (ch.get("modified_count") or 0)
    if change_total > 0 and not project.get("last_indexed_at"):
        return True
    indexed_at = _parse_ts(project.get("last_indexed_at") or (summary or {}).get("last_indexed_at"))
    activity_at = max(
        _parse_ts(project.get("last_seen_at")),
        _parse_ts(project.get("last_activity_at")),
    )
    if activity_at and indexed_at and activity_at > indexed_at + 3600:
        return True
    if indexed_at:
        age_days = (datetime.now(timezone.utc).timestamp() - indexed_at) / 86400
        if age_days > 14:
            return True
    return False


def _score_breakdown(
    project: Dict[str, Any],
    summary: Optional[Dict[str, Any]],
    finance: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    overall = int((summary or {}).get("potential_score") or 0)
    if not overall:
        from src.cerberus_projects import compute_potential_score
        overall = compute_potential_score(project, summary, finance)

    strengths = (summary or {}).get("strengths") or []
    weaknesses = (summary or {}).get("weaknesses") or []
    monet_opts = (summary or {}).get("monetisation_options") or []
    stage = ((summary or {}).get("current_stage") or "unknown").lower()
    ch = project.get("recent_changes") or {}
    change_total = (ch.get("new_count") or 0) + (ch.get("modified_count") or 0)
    stack = project.get("detected_stack") or []
    file_count = int(project.get("file_count") or (summary or {}).get("file_count") or 0)

    launch_map = {
        "live": 90,
        "launch-ready": 80,
        "active build": 55,
        "prototype": 35,
        "idea": 15,
        "paused": 25,
    }
    launch = launch_map.get(stage, max(20, overall - 10))
    monet = 70 if (finance or {}).get("monetisation_strategy") else (55 if monet_opts else 25)
    technical = min(100, 30 + min(40, file_count // 20) + (15 if stack else 0) + (10 if strengths else 0))
    market = min(100, overall + (10 if len(monet_opts) > 1 else 0))
    activity = min(100, change_total * 8 + (20 if project.get("last_chat_at") else 0))
    automation = min(100, 40 + len(stack) * 5 + (15 if file_count > 50 else 0))

    return {
        "overall": overall,
        "launch_readiness": launch,
        "monetisation_clarity": monet,
        "technical_readiness": technical,
        "marketability": market,
        "recent_activity": activity,
        "ai_automation_potential": automation,
        "strengths_count": len(strengths),
        "weaknesses_count": len(weaknesses),
    }


def _stage_block(summary: Optional[Dict[str, Any]], project: Dict[str, Any]) -> Dict[str, Any]:
    current = ((summary or {}).get("current_stage") or "unknown").strip()
    explanation = (summary or {}).get("what_it_appears_to_do") or project.get("description") or ""
    next_steps = (summary or {}).get("recommended_next_steps") or []
    recommended_next = next_steps[0] if next_steps else project.get("suggested_next_action") or ""
    stage_order = ["idea", "prototype", "active build", "launch-ready", "live"]
    cur_lower = current.lower()
    rec_stage = recommended_next
    for s in stage_order:
        if s in (recommended_next or "").lower():
            rec_stage = s
            break
    else:
        try:
            idx = stage_order.index(cur_lower) if cur_lower in stage_order else -1
            rec_stage = stage_order[idx + 1] if 0 <= idx < len(stage_order) - 1 else cur_lower
        except ValueError:
            rec_stage = "active build"
    return {
        "current": current,
        "explanation": explanation[:400] if explanation else "Run Deep Index for stage analysis.",
        "recommended_next_stage": rec_stage,
        "valid_stages": list(VALID_STAGES),
    }


def _recent_changes_block(
    project: Dict[str, Any],
    index: Optional[Dict[str, Any]],
    summary: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    ch = project.get("recent_changes") or (index or {}).get("recent_changes") or {}
    modified = ch.get("modified_files") or (summary or {}).get("recent_changes") or []
    recent_files = (index or {}).get("recent_files") or modified[:12]
    return {
        "changed_file_count": (
            (ch.get("new_count") or 0)
            + (ch.get("modified_count") or 0)
            + (ch.get("deleted_count") or 0)
        ),
        "new_count": ch.get("new_count", 0),
        "modified_count": ch.get("modified_count", 0),
        "deleted_count": ch.get("deleted_count", 0),
        "recent_files": recent_files[:12],
        "last_modified": ch.get("last_modified") or project.get("last_seen_at"),
        "git_status": None,
        "git_available": False,
    }


def _pipeline_block(project_id: str) -> Dict[str, Any]:
    council = load_council()
    stages = list(council.get("stages") or [])
    reports = reports_for_project(project_id, limit=50)
    by_agent: Dict[str, Dict[str, Any]] = {}
    for r in reports:
        aid = (r.get("agent_id") or "").lower()
        if aid and aid not in by_agent:
            by_agent[aid] = r

    stage_rows: List[Dict[str, Any]] = []
    for stage in stages:
        action = STAGE_ACTIONS.get(stage, "")
        agent_id = STAGE_AGENTS.get(stage, "")
        report = by_agent.get((agent_id or "").lower())
        status = "not_started"
        if report:
            status = report.get("status") or "completed"
        approval_required = bool(council.get("approval_required", True))
        can_send = False
        if report and report.get("status") == "approved":
            nxt = next_stage(stage)
            can_send = bool(nxt)
        stage_rows.append({
            "stage": stage,
            "label": STAGE_LABELS.get(stage, stage.title()),
            "agent_id": agent_id,
            "action": action,
            "status": status,
            "approval_required": approval_required,
            "can_send_next": can_send,
            "next_stage": next_stage(stage),
            "latest_report": {
                "id": report.get("id"),
                "title": report.get("title"),
                "status": report.get("status"),
                "created_at": report.get("created_at"),
                "summary": report.get("summary"),
            } if report else None,
        })

    return {
        "stages": stage_rows,
        "approval_required": bool(council.get("approval_required", True)),
        "enabled": bool(council.get("enabled", True)),
    }


def _latest_reports_grouped(project_id: str) -> List[Dict[str, Any]]:
    reports = reports_for_project(project_id, limit=30)
    by_agent: Dict[str, List[Dict[str, Any]]] = {}
    for r in reports:
        aid = r.get("agent_id") or "unknown"
        by_agent.setdefault(aid, []).append({
            "id": r.get("id"),
            "title": r.get("title"),
            "status": r.get("status"),
            "summary": r.get("summary"),
            "created_at": r.get("created_at"),
            "action": r.get("action"),
        })
    out = []
    for agent_id, reps in by_agent.items():
        out.append({
            "agent_id": agent_id,
            "agent_name": reps[0].get("title", "").split(":")[0] if reps else agent_id,
            "reports": reps[:5],
        })
    return out


def _recommendation_block(
    project: Dict[str, Any],
    summary: Optional[Dict[str, Any]],
    pipeline: Dict[str, Any],
    stale: bool,
) -> Dict[str, Any]:
    next_steps = (summary or {}).get("recommended_next_steps") or []
    do_this = next_steps[0] if next_steps else project.get("suggested_next_action") or ""
    if stale:
        do_this = "Index may be stale. Run Deep Index."
    elif not do_this:
        incomplete = next(
            (s for s in pipeline.get("stages") or [] if s.get("status") == "not_started"),
            None,
        )
        if incomplete:
            do_this = f"Run {incomplete.get('label', 'council')} stage for this project."
        else:
            do_this = "Review latest council reports and approve next steps."

    return {
        "do_this_next": do_this,
        "summary": (summary or {}).get("what_it_appears_to_do") or "",
        "stale_index": stale,
        "stale_message": "Index may be stale. Run Deep Index." if stale else None,
    }


def build_command_centre(project_id: str) -> Dict[str, Any]:
    ctx = build_project_context(project_id)
    if not ctx.get("ok"):
        return ctx

    ddir = data_dir()
    ws = load_workspace(ddir)
    project = enrich_project(ctx["project"], ws)
    summary = ctx.get("summary")
    index = load_index(ddir, project_id)
    finance = ctx.get("finance")
    stale = _index_stale(project, summary)
    active = load_active_project()
    desktop = desktop_capabilities_for_project(project)
    pipeline = _pipeline_block(project_id)

    record_activity(project_id, "view")

    return {
        "ok": True,
        "project": {
            **project,
            "potential_score": ctx.get("potential_score"),
            "last_activity_label": format_last_activity(project),
            "is_active_context": (active or {}).get("project_id") == project_id,
            "index_stale": stale,
        },
        "score": _score_breakdown(project, summary, finance),
        "stage": _stage_block(summary, project),
        "recent_changes": _recent_changes_block(project, index, summary),
        "pipeline": pipeline,
        "latest_reports": _latest_reports_grouped(project_id),
        "recommendation": _recommendation_block(project, summary, pipeline, stale),
        "desktop": desktop,
        "summary_v2": ctx.get("summary_v2"),
    }


def make_active_project(project_id: str) -> Dict[str, Any]:
    projects = load_projects()
    project = next((p for p in projects if p.get("id") == project_id), None)
    if not project:
        return {"ok": False, "message": "Project not found"}
    payload = save_active_project(project_id)
    record_activity(project_id, "view")
    return {
        "ok": True,
        "active": payload,
        "project": project,
        "message": f"Active project set to {project.get('name', project_id)}",
    }
