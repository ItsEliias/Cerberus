"""Atlas project activity, sorting, context, and scoring."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from src.cerberus_config import data_dir, load_finance, load_projects, load_reports, save_projects
from src.cerberus_project_index import load_index, load_summary
from src.cerberus_project_index import format_summaries_for_agents

logger = logging.getLogger(__name__)

PROPOSED_DIRECTION_PLACEHOLDER = (
    "Run Architect Plan or Business Analysis to generate a proper direction."
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


def _change_count(project: Dict[str, Any]) -> int:
    ch = project.get("recent_changes") or {}
    return int(ch.get("new_count") or 0) + int(ch.get("modified_count") or 0) + int(ch.get("deleted_count") or 0)


def compute_activity_score(project: Dict[str, Any], summary: Optional[Dict[str, Any]] = None) -> int:
    score = 0
    if project.get("pinned"):
        score += 1000
    score += int(_parse_ts(project.get("last_activity_at")))
    score += int(_parse_ts(project.get("last_indexed_at")) // 10)
    score += int(_parse_ts(project.get("last_chat_at")) // 5)
    score += int(_parse_ts(project.get("last_agent_report_at")) // 5)
    if summary and summary.get("recent_changes"):
        score += len(summary["recent_changes"]) * 2
    score += _change_count(project)
    return score


def refresh_project_activity_fields(
    project: Dict[str, Any],
    *,
    summary: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    out = dict(project)
    out["activity_score"] = compute_activity_score(out, summary)
    latest = max(
        _parse_ts(out.get("last_activity_at")),
        _parse_ts(out.get("last_indexed_at")),
        _parse_ts(out.get("last_chat_at")),
        _parse_ts(out.get("last_agent_report_at")),
        _parse_ts(out.get("last_seen_at")),
    )
    if latest:
        out["last_activity_at"] = out.get("last_activity_at") or datetime.fromtimestamp(
            latest, tz=timezone.utc
        ).replace(microsecond=0).isoformat()
    return out


def sort_recent_projects(projects: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    def sort_key(p: Dict[str, Any]) -> Tuple:
        pinned = 0 if p.get("pinned") else 1
        activity = -(p.get("activity_score") or compute_activity_score(p))
        name = (p.get("name") or "").lower()
        return (pinned, activity, name)

    enriched = []
    ddir = data_dir()
    for p in projects:
        summ = load_summary(ddir, p.get("id") or "")
        enriched.append(refresh_project_activity_fields(p, summary=summ))
    return sorted(enriched, key=sort_key)


def get_recent_projects(limit: int = 20) -> List[Dict[str, Any]]:
    projects = [p for p in load_projects() if (p.get("status") or "active").lower() != "archived"]
    return sort_recent_projects(projects)[:limit]


def toggle_pin(project_id: str, pinned: Optional[bool] = None) -> Dict[str, Any]:
    projects = load_projects()
    project = next((p for p in projects if p.get("id") == project_id), None)
    if not project:
        return {"ok": False, "message": "Project not found"}
    new_val = (not project.get("pinned")) if pinned is None else bool(pinned)
    project["pinned"] = new_val
    project["last_activity_at"] = _now_iso()
    project = refresh_project_activity_fields(project)
    for i, p in enumerate(projects):
        if p.get("id") == project_id:
            projects[i] = project
            break
    save_projects(projects)
    return {"ok": True, "project": project, "pinned": new_val}


def record_activity(project_id: str, activity_type: str = "view") -> Dict[str, Any]:
    projects = load_projects()
    project = next((p for p in projects if p.get("id") == project_id), None)
    if not project:
        return {"ok": False, "message": "Project not found"}
    now = _now_iso()
    project["last_activity_at"] = now
    if activity_type == "chat":
        project["last_chat_at"] = now
    elif activity_type == "agent_report":
        project["last_agent_report_at"] = now
    project = refresh_project_activity_fields(project)
    for i, p in enumerate(projects):
        if p.get("id") == project_id:
            projects[i] = project
            break
    save_projects(projects)
    return {"ok": True, "project": project}


def folder_size_bytes(project_id: str) -> int:
    idx = load_index(data_dir(), project_id)
    if not idx:
        return 0
    total = 0
    for f in idx.get("files") or []:
        total += int(f.get("size") or 0)
    return total


def compute_potential_score(
    project: Dict[str, Any],
    summary: Optional[Dict[str, Any]] = None,
    finance_entry: Optional[Dict[str, Any]] = None,
) -> int:
    score = 0
    if project.get("last_indexed_at") or project.get("indexed"):
        score += 30
    imp = (summary or {}).get("important_files") or []
    imp_lower = [x.lower() for x in imp]
    if any("readme" in x or "package.json" in x or "pyproject" in x for x in imp_lower):
        score += 20
    if _change_count(project) or (summary or {}).get("recent_changes"):
        score += 20
    if (finance_entry or {}).get("monetisation_strategy") or (finance_entry or {}).get("notes"):
        score += 10
    if project.get("pinned") or (project.get("status") or "").lower() == "active":
        score += 20
    return max(0, min(100, score))


def reports_for_project(project_id: str, limit: int = 8) -> List[Dict[str, Any]]:
    pid = (project_id or "").lower()
    pname = ""
    for p in load_projects():
        if p.get("id") == project_id:
            pname = (p.get("name") or "").lower()
            break
    out = []
    for r in load_reports():
        rid = (r.get("project_id") or "").lower()
        title = (r.get("title") or "").lower()
        if rid == pid:
            out.append(r)
        elif pname and pname in title:
            out.append(r)
    out.sort(key=lambda x: _parse_ts(x.get("created_at")), reverse=True)
    return out[:limit]


def finance_for_project(project_id: str) -> Optional[Dict[str, Any]]:
    fin = load_finance()
    for e in fin.get("entries") or []:
        if e.get("id") == project_id:
            return e
    return None


def build_project_context(project_id: str) -> Dict[str, Any]:
    ddir = data_dir()
    projects = load_projects()
    project = next((p for p in projects if p.get("id") == project_id), None)
    if not project:
        return {"ok": False, "message": "Project not found"}

    summary = load_summary(ddir, project_id)
    index = load_index(ddir, project_id)
    finance = finance_for_project(project_id)
    reports = reports_for_project(project_id)
    size_bytes = folder_size_bytes(project_id)
    is_v2 = bool(summary and (summary.get("index_version") == 2 or summary.get("potential_score") is not None))
    potential = (
        summary.get("potential_score")
        if is_v2 and summary.get("potential_score") is not None
        else compute_potential_score(project, summary, finance)
    )
    direction = PROPOSED_DIRECTION_PLACEHOLDER
    if is_v2 and summary:
        direction = (
            (summary.get("recommended_next_steps") or [None])[0]
            or summary.get("what_it_appears_to_do")
            or direction
        )
    elif summary and summary.get("summary"):
        direction = summary["summary"][:240]

    return {
        "ok": True,
        "project": refresh_project_activity_fields(project, summary=summary),
        "summary": summary,
        "summary_v2": summary if is_v2 else None,
        "index_meta": {
            "file_count": (index or {}).get("file_count", project.get("file_count", 0)),
            "folder_size_bytes": size_bytes,
            "important_files": (index or {}).get("important_files") or [],
            "recent_files": (index or {}).get("recent_files") or [],
        },
        "recent_changes": project.get("recent_changes") or (summary or {}).get("recent_changes"),
        "reports": [
            {
                "id": r.get("id"),
                "title": r.get("title"),
                "agent_id": r.get("agent_id"),
                "agent_name": r.get("agent_name"),
                "status": r.get("status"),
                "created_at": r.get("created_at"),
                "summary": r.get("summary"),
            }
            for r in reports
        ],
        "finance": finance,
        "potential_score": potential,
        "proposed_direction": direction,
        "current_stage": (summary or {}).get("current_stage"),
    }


def build_chat_project_context(project_id: str) -> str:
    """Metadata-only block for Assistant prompts."""
    ctx = build_project_context(project_id)
    if not ctx.get("ok"):
        return ""
    p = ctx["project"]
    lines = [
        "## Active Project Context",
        f"Project: **{p.get('name')}**",
        f"Path: {p.get('display_path') or p.get('path')}",
        f"Stack: {', '.join(p.get('detected_stack') or []) or 'unknown'}",
        f"Files: {ctx['index_meta'].get('file_count', 0)}",
    ]
    ch = ctx.get("recent_changes") or {}
    modified = ch.get("modified_files") or (ctx.get("summary") or {}).get("recent_changes") or []
    if modified:
        lines.append(f"Recent changes: {', '.join(modified[:10])}")
    if ctx.get("summary") and ctx["summary"].get("summary"):
        lines.append(f"Summary: {ctx['summary']['summary']}")
    lines.append(
        "Treat the user's questions as relating to this project unless they clear context or ask otherwise."
    )
    lines.append("Use metadata only — do not assume full file contents.")
    return "\n".join(lines)


def format_last_activity(project: Dict[str, Any]) -> str:
    ts = (
        project.get("last_activity_at")
        or project.get("last_indexed_at")
        or project.get("last_seen_at")
        or project.get("created_at")
    )
    if not ts:
        return "No activity yet"
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return dt.strftime("%d %b %Y %H:%M")
    except ValueError:
        return ts[:16]
