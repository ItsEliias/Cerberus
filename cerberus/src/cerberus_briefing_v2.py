"""Atlas Daily Briefing V2 — structured briefing from live local data."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from src.cerberus_config import (
    _read_json,
    _write_json,
    data_dir,
    load_agents,
    load_aurelius_profile,
    load_pipeline,
    load_projects,
    load_reports,
    resolve_dynamic_focus,
)
from src.cerberus_council import council_context_block
from src.cerberus_mount_workspace import get_workspace_status, is_mounted
from src.cerberus_personal_finance import compute_overview
from src.cerberus_project_index import load_all_summaries, load_summary
from src.cerberus_workspace import load_workspace

_BRIEFING_SETTINGS = "briefing_settings.json"
_DEFAULT_SETTINGS: Dict[str, Any] = {
    "speak_on_home_start": False,
    "briefing_style": "short",
    "include_finance": True,
    "include_projects": True,
    "include_agents": True,
    "focus_mode": "dynamic",
}


def load_briefing_settings() -> Dict[str, Any]:
    data = _read_json(_BRIEFING_SETTINGS)
    if not data:
        return dict(_DEFAULT_SETTINGS)
    out = dict(_DEFAULT_SETTINGS)
    out.update(data)
    return out


def save_briefing_settings(patch: Dict[str, Any]) -> Dict[str, Any]:
    current = load_briefing_settings()
    current.update(patch)
    _write_json(_BRIEFING_SETTINGS, current)
    return current


def _greeting_sir(profile: Dict[str, Any]) -> str:
    from src.cerberus_personality import get_greeting
    from src.cerberus_user_settings import load_user_settings

    settings = load_user_settings()
    return get_greeting(settings)


def _project_score(p: Dict[str, Any], summary: Optional[Dict[str, Any]]) -> int:
    score = int(p.get("activity_score") or 0)
    if summary and summary.get("potential_score"):
        score = max(score, int(summary.get("potential_score") or 0))
    if (p.get("priority") or "").lower() == "high":
        score += 15
    if p.get("pinned"):
        score += 10
    ch = p.get("recent_changes") or {}
    score += min(20, (ch.get("new_count") or 0) + (ch.get("modified_count") or 0))
    return min(100, score)


def generate_briefing_v2() -> Dict[str, Any]:
    settings = load_briefing_settings()
    profile = load_aurelius_profile()
    projects = load_projects()
    agents = load_agents()
    reports = load_reports()
    pipeline_items = load_pipeline()
    ddir = data_dir()
    ws = load_workspace(ddir)
    summaries = {s.get("project_id"): s for s in load_all_summaries(ddir)}

    greeting = _greeting_sir(profile)
    with_path = [p for p in projects if (p.get("path") or "").strip()]
    indexed = [p for p in with_path if p.get("last_indexed_at") or p.get("indexed")]
    not_indexed = [p for p in with_path if p not in indexed]

    priorities: List[Dict[str, Any]] = []
    project_changes: List[Dict[str, Any]] = []
    finance_lines: List[Dict[str, Any]] = []
    agent_lines: List[Dict[str, Any]] = []

    if settings.get("include_projects", True):
        ranked = sorted(
            with_path,
            key=lambda p: _project_score(p, summaries.get(p.get("id"))),
            reverse=True,
        )
        for p in ranked[:5]:
            summ = summaries.get(p.get("id"))
            priorities.append({
                "project_id": p.get("id"),
                "name": p.get("name"),
                "score": _project_score(p, summ),
                "stage": (summ or {}).get("current_stage") or "unknown",
                "potential_score": (summ or {}).get("potential_score"),
                "next_step": (summ or {}).get("recommended_next_steps", [None])[0]
                    if isinstance((summ or {}).get("recommended_next_steps"), list)
                    else p.get("suggested_next_action"),
            })
        for p in with_path:
            ch = p.get("recent_changes") or {}
            total = (ch.get("new_count") or 0) + (ch.get("modified_count") or 0)
            if total:
                project_changes.append({
                    "project_id": p.get("id"),
                    "name": p.get("name"),
                    "new_count": ch.get("new_count", 0),
                    "modified_count": ch.get("modified_count", 0),
                })

    dynamic_focus = resolve_dynamic_focus() if settings.get("focus_mode", "dynamic") == "dynamic" else None
    top_rec = priorities[0] if priorities else None
    recommendation = ""
    if dynamic_focus and dynamic_focus.get("label"):
        step = ""
        if top_rec and (top_rec.get("project_id") in {p.get("id") for p in dynamic_focus.get("projects") or []}):
            step = top_rec.get("next_step") or f"review {dynamic_focus['label']}"
        else:
            step = dynamic_focus.get("detail") or f"focus on {dynamic_focus['label']}"
        recommendation = f"What to do first ({dynamic_focus.get('reason', 'dynamic')}): {step}."
    elif top_rec:
        name = top_rec.get("name", "your top project")
        step = top_rec.get("next_step") or f"review {name} and run a council report"
        recommendation = f"What to do first: {step}."
    elif not_indexed:
        recommendation = f"Index {not_indexed[0].get('name', 'unindexed projects')} for deeper Atlas understanding."
    else:
        recommendation = "Scan your workspace and index projects to unlock council reports."

    if settings.get("include_finance", True):
        try:
            overview = compute_overview()
            for bill in (overview.get("upcoming_bills") or [])[:4]:
                days = bill.get("days_until")
                if days is not None and days <= 14:
                    finance_lines.append({
                        "type": "bill",
                        "name": bill.get("name"),
                        "amount": bill.get("amount"),
                        "days_until": days,
                        "due_date": bill.get("next_due_date"),
                    })
            if overview.get("weekly_net"):
                finance_lines.append({
                    "type": "pay_estimate",
                    "weekly_net": overview.get("weekly_net"),
                    "weekly_gross": overview.get("weekly_gross"),
                    "friday_payout": overview.get("friday_payout_date"),
                })
        except Exception:
            pass

    if settings.get("include_agents", True):
        pending_reports = [
            r for r in reports
            if r.get("status") == "waiting_for_review"
        ]
        for r in pending_reports[:5]:
            agent_lines.append({
                "report_id": r.get("id"),
                "agent": r.get("agent_name"),
                "title": r.get("title"),
                "project_id": r.get("project_id"),
            })
        waiting_pipeline = [
            i for i in pipeline_items
            if (i.get("status") or "") in ("waiting", "pending_approval", "awaiting_approval")
        ]
        for item in waiting_pipeline[:3]:
            agent_lines.append({
                "type": "pipeline",
                "title": item.get("title"),
                "stage": item.get("stage"),
                "project_id": item.get("project_id"),
            })

    mount_ok = is_mounted()
    mount_status = get_workspace_status(ws)
    headline_parts = []
    if mount_ok:
        headline_parts.append(f"{len(with_path)} projects in workspace")
        headline_parts.append(f"{len(indexed)} indexed")
    else:
        headline_parts.append(mount_status.get("warning") or "Workspace not mounted")
    if not_indexed:
        headline_parts.append(f"{len(not_indexed)} need indexing")
    if agent_lines:
        headline_parts.append(f"{len(agent_lines)} pending approvals")

    headline = " · ".join(headline_parts) if headline_parts else "Cerberus is online"

    spoken_parts = [greeting + "."]
    if mount_ok and settings.get("include_projects", True):
        spoken_parts.append(
            f"You have {len(with_path)} project{'s' if len(with_path) != 1 else ''} discovered"
            f" and {len(indexed)} indexed."
        )
        if not_indexed:
            names = ", ".join(p.get("name", "Project") for p in not_indexed[:3])
            spoken_parts.append(f"Not indexed yet: {names}.")
        if project_changes:
            ch_names = ", ".join(c["name"] for c in project_changes[:3])
            spoken_parts.append(f"Recent changes in {ch_names}.")
    if top_rec:
        spoken_parts.append(
            f"Highest priority: {top_rec.get('name')}. {recommendation}"
        )
    elif recommendation:
        spoken_parts.append(recommendation)
    if finance_lines and settings.get("include_finance", True):
        bill = next((f for f in finance_lines if f.get("type") == "bill"), None)
        if bill:
            spoken_parts.append(
                f"Finance reminder: {bill.get('name')} due in {bill.get('days_until')} days."
            )
    if agent_lines and settings.get("include_agents", True):
        spoken_parts.append(
            f"You have {len(agent_lines)} agent report{'s' if len(agent_lines) != 1 else ''} awaiting review."
        )

    ready = [a for a in agents if (a.get("status") or "").lower() == "ready"]
    if ready:
        names = [a.get("name", "Agent") for a in ready[:3]]
        spoken_parts.append(f"{' and '.join(names)} ready.")

    style = settings.get("briefing_style") or "short"
    if style == "short":
        spoken = " ".join(spoken_parts[:6])
    else:
        spoken = " ".join(spoken_parts)

    return {
        "ok": True,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "settings": settings,
        "spoken": spoken,
        "visual": {
            "headline": headline,
            "greeting": greeting,
            "priorities": priorities,
            "project_changes": project_changes,
            "finance": finance_lines,
            "agent_reports": agent_lines,
            "recommendation": recommendation,
            "workspace_mounted": mount_ok,
            "unindexed_count": len(not_indexed),
            "indexed_count": len(indexed),
            "project_count": len(with_path),
        },
        "council_note": council_context_block()[:200] if council_context_block() else "",
    }
