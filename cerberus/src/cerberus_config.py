"""Cerberus OS local identity, profile, projects, and agents configuration."""

from __future__ import annotations

import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parent.parent
_DEFAULTS_DIR = _REPO_ROOT / "config" / "atlas"
_DATA_DIR = _REPO_ROOT / "data" / "atlas"

_CORRUPT_CONFIG_MARKERS = (
    "exploring the codebase",
    "built atlas reasoning audit",
    "reasoning audit v1",
    "cursor summary prose",
)

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
)


def _ensure_data_dir() -> None:
    """Seed data/cerberus from bundled defaults when local files are missing."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    for name in _CONFIG_FILES:
        dest = _DATA_DIR / name
        if dest.exists():
            continue
        src = _DEFAULTS_DIR / name
        if src.exists():
            shutil.copy2(src, dest)
            logger.info("[cerberus] seeded %s", dest)
        else:
            logger.warning("[cerberus] missing default config %s", src)


def _is_corrupted_config_text(text: str) -> bool:
    stripped = (text or "").strip()
    if not stripped:
        return False
    low = stripped.lower()
    if any(marker in low for marker in _CORRUPT_CONFIG_MARKERS):
        return True
    try:
        json.loads(stripped)
        return False
    except json.JSONDecodeError:
        return True


def _load_json_file(path: Path) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
        return data if isinstance(data, dict) else {}


def _read_json(filename: str) -> Dict[str, Any]:
    _ensure_data_dir()
    path = _DATA_DIR / filename
    fallback = _DEFAULTS_DIR / filename
    try:
        if path.exists():
            raw = path.read_text(encoding="utf-8")
            if _is_corrupted_config_text(raw):
                logger.warning("[cerberus] corrupted runtime config %s — restoring from defaults", path)
                if fallback.exists():
                    return _load_json_file(fallback)
                return {}
            return _load_json_file(path)
        if fallback.exists():
            return _load_json_file(fallback)
        return {}
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("[cerberus] could not read %s: %s", path, exc)
        if fallback.exists():
            return _load_json_file(fallback)
        return {}


def normalize_aurelius_profile(profile: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Merge legacy profile fields with V2 dynamic-focus profile shape."""
    raw = dict(profile or load_aurelius_profile())
    out = dict(raw)
    if not out.get("address_as"):
        out["address_as"] = out.get("preferred_name") or "Sir"
    if not out.get("preferred_name"):
        out["preferred_name"] = out.get("address_as") or "Sir"
    if isinstance(out.get("business_preferences"), list):
        out["business_preferences_text"] = ", ".join(out["business_preferences"])
    elif isinstance(out.get("business_preferences"), str):
        out["business_preferences_text"] = out["business_preferences"]
    else:
        out["business_preferences_text"] = ""
    comm = out.get("communication_style") or {}
    if isinstance(comm, dict):
        if not out.get("work_style") and comm.get("tone"):
            out["work_style"] = comm["tone"]
        if not out.get("assistant_style") and comm.get("voice_mode"):
            out["assistant_style"] = comm["voice_mode"]
    out.setdefault(
        "focus_selection_rule",
        "Choose focus dynamically from pinned projects, recent activity, scores, and active project context.",
    )
    return out


def profile_address(profile: Optional[Dict[str, Any]] = None) -> str:
    p = normalize_aurelius_profile(profile)
    return (p.get("preferred_name") or p.get("address_as") or "Sir").strip() or "Sir"


def resolve_dynamic_focus() -> Dict[str, Any]:
    """Select focus project(s) from live Atlas data — never hardcoded seed names."""
    from src.cerberus_command_centre import load_active_project
    from src.cerberus_project_index import load_all_summaries
    from src.cerberus_projects import sort_recent_projects

    ddir = data_dir()
    projects = [p for p in load_projects() if (p.get("status") or "").lower() != "archived"]
    summaries = {s.get("project_id"): s for s in load_all_summaries(ddir)}
    reports = load_reports()
    pipeline = load_pipeline()

    def _score(p: Dict[str, Any]) -> int:
        s = summaries.get(p.get("id"))
        score = int(p.get("activity_score") or 0)
        if s and s.get("potential_score"):
            score = max(score, int(s.get("potential_score") or 0))
        if p.get("pinned"):
            score += 1000
        if (p.get("priority") or "").lower() == "high":
            score += 50
        ch = p.get("recent_changes") or {}
        score += min(30, (ch.get("new_count") or 0) + (ch.get("modified_count") or 0))
        return score

    def _pack(items: List[Dict[str, Any]], reason: str, detail: str = "") -> Dict[str, Any]:
        names = [p.get("name") for p in items if p.get("name")]
        return {
            "projects": items,
            "names": names,
            "label": " and ".join(names[:3]) if names else "",
            "reason": reason,
            "detail": detail,
        }

    active_file = load_active_project()
    if active_file and active_file.get("project_id"):
        p = next((x for x in projects if x.get("id") == active_file["project_id"]), None)
        if p:
            return _pack([p], "active_project", "Set via active_project.json")

    pinned = [p for p in projects if p.get("pinned")]
    if pinned:
        ordered = sorted(pinned, key=_score, reverse=True)
        return _pack(ordered[:3], "pinned", "Pinned projects")

    pending_reports = [
        r for r in reports if (r.get("status") or "") in ("waiting_for_review", "awaiting_approval")
    ]
    for r in pending_reports:
        pid = r.get("project_id")
        if pid:
            p = next((x for x in projects if x.get("id") == pid), None)
            if p:
                return _pack([p], "pending_council", r.get("title") or "Pending report")

    waiting_pipeline = [
        i for i in pipeline
        if (i.get("status") or "") in ("waiting", "pending_approval", "awaiting_approval")
        and i.get("project_id")
    ]
    if waiting_pipeline:
        pid = waiting_pipeline[0].get("project_id")
        p = next((x for x in projects if x.get("id") == pid), None)
        if p:
            return _pack([p], "pipeline", waiting_pipeline[0].get("title") or "Pipeline item")

    ranked = sort_recent_projects(projects)
    if ranked:
        top = ranked[0]
        return _pack([top], "recent_activity", f"Top activity score {_score(top)}")

    active = active_focus_projects()
    if active:
        return _pack(active[:3], "active_status", "Projects marked active in projects.json")

    return _pack([], "none", "No project focus resolved — ask user or scan workspace")


def load_cerberus_identity() -> Dict[str, Any]:
    return _read_json("cerberus_identity.json")


def load_aurelius_profile() -> Dict[str, Any]:
    return normalize_aurelius_profile(_read_json("aurelius_profile.json"))


def data_dir() -> Path:
    _ensure_data_dir()
    return _DATA_DIR


def load_projects() -> List[Dict[str, Any]]:
    data = _read_json("projects.json")
    projects = data.get("projects", [])
    if not isinstance(projects, list):
        return []
    return [_normalize_project(p) for p in projects]


def _normalize_project(p: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure extended project fields exist without breaking legacy entries."""
    from src.cerberus_mount_workspace import enrich_project
    from src.cerberus_workspace import load_workspace

    out = dict(p)
    out.setdefault("path", "")
    out.setdefault("type", "SaaS")
    out.setdefault("created_at", out.get("created_at") or datetime.now(timezone.utc).replace(microsecond=0).isoformat())
    out.setdefault("last_indexed_at", None)
    out.setdefault("file_count", 0)
    out.setdefault("recent_changes", {})
    out.setdefault("notes", "")
    out.setdefault("agents_allowed", True)
    out.setdefault("source", "manual")
    out.setdefault("detected_type", out.get("type"))
    out.setdefault("detected_stack", [])
    out.setdefault("last_seen_at", None)
    out.setdefault("indexed", bool(out.get("last_indexed_at")))
    out.setdefault("pinned", False)
    out.setdefault("last_chat_at", None)
    out.setdefault("last_agent_report_at", None)
    out.setdefault("last_activity_at", None)
    out.setdefault("activity_score", 0)
    out.setdefault("focus_mode", False)
    try:
        ws = load_workspace(data_dir())
        out = enrich_project(out, ws)
        from src.cerberus_projects import refresh_project_activity_fields
        return refresh_project_activity_fields(out)
    except Exception:
        out.setdefault("display_path", out.get("path", ""))
        out.setdefault("path_status", "empty" if not out.get("path") else "unknown")
        out.setdefault("can_relink", False)
        return out


def save_projects(projects: List[Dict[str, Any]]) -> None:
    _write_json("projects.json", {"projects": projects})


def load_finance() -> Dict[str, Any]:
    data = _read_json("finance.json")
    return data if data else {"entries": [], "notes": ""}


def save_finance(data: Dict[str, Any]) -> None:
    _write_json("finance.json", data)


def load_pipeline() -> List[Dict[str, Any]]:
    data = _read_json("pipeline.json")
    items = data.get("items", [])
    return items if isinstance(items, list) else []


def save_pipeline(items: List[Dict[str, Any]]) -> None:
    _write_json("pipeline.json", {"items": items})


def load_agents() -> List[Dict[str, Any]]:
    data = _read_json("agents.json")
    agents = data.get("agents", [])
    return agents if isinstance(agents, list) else []


def save_agents(agents: List[Dict[str, Any]]) -> None:
    """Persist agent state to data/cerberus/agents.json only."""
    _write_json("agents.json", {"agents": agents})


def load_reports() -> List[Dict[str, Any]]:
    data = _read_json("reports.json")
    reports = data.get("reports", [])
    return reports if isinstance(reports, list) else []


def save_reports(reports: List[Dict[str, Any]]) -> None:
    """Persist reports to data/cerberus/reports.json only."""
    _write_json("reports.json", {"reports": reports})


def _write_json(filename: str, data: Dict[str, Any]) -> None:
    _ensure_data_dir()
    path = _DATA_DIR / filename
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


def load_profile_bundle() -> Dict[str, Any]:
    return {
        "identity": load_cerberus_identity(),
        "profile": load_aurelius_profile(),
    }


def time_aware_greeting(profile: Optional[Dict[str, Any]] = None) -> str:
    profile = normalize_aurelius_profile(profile or load_aurelius_profile())
    address = profile_address(profile)
    hour = datetime.now().hour
    if hour < 12:
        part = "morning"
    elif hour < 17:
        part = "afternoon"
    else:
        part = "evening"
    return f"Good {part}, {address}. What shall we build today?"


def active_focus_projects() -> List[Dict[str, Any]]:
    return [p for p in load_projects() if (p.get("status") or "").lower() == "active"]


def generate_briefing() -> Dict[str, Any]:
    """Build a simple non-AI briefing from workspace, projects, and summaries."""
    from src.cerberus_workspace import load_workspace
    from src.cerberus_project_index import load_all_summaries, load_summary

    profile = load_aurelius_profile()
    focus = resolve_dynamic_focus()
    projects = focus.get("projects") or active_focus_projects()
    all_projects = load_projects()
    agents = load_agents()
    ddir = data_dir()
    ws = load_workspace(ddir)
    summaries = {s.get("project_id"): s for s in load_all_summaries(ddir)}

    greeting = time_aware_greeting(profile)
    focus_names = focus.get("names") or [p.get("name") for p in projects if p.get("name")]
    focus_text = focus.get("label") or " and ".join(focus_names) if focus_names else "No project focus yet — scan workspace"

    ready_agents = [a for a in agents if (a.get("status") or "").lower() == "ready"]
    dev_ready = next((a for a in agents if a.get("id") == "developer" and (a.get("status") or "") in ("ready", "idle")), None)

    from src.cerberus_mount_workspace import get_workspace_status, is_mounted

    mount_status = get_workspace_status(ws)
    workspace_lines: List[str] = []
    if not is_mounted():
        workspace_lines.append(mount_status.get("warning") or "Cerberus Workspace is not mounted.")
    elif not (ws.get("workspace_root") or "").strip():
        workspace_lines.append(
            "Configure Cerberus Workspace in Settings or Projects — create your managed workspace to get started."
        )
    else:
        with_path = [p for p in all_projects if (p.get("path") or "").strip()]
        indexed = [p for p in with_path if p.get("last_indexed_at") or p.get("indexed")]
        not_indexed = [p for p in with_path if p not in indexed]
        changed: List[str] = []
        for p in with_path:
            ch = p.get("recent_changes") or {}
            total = (ch.get("new_count") or 0) + (ch.get("modified_count") or 0)
            if total:
                changed.append(p.get("name", "Project"))

        workspace_lines.append(
            f"{len(with_path)} project(s) discovered in your workspace; {len(indexed)} indexed."
        )
        if not_indexed:
            names = ", ".join(p.get("name", "Project") for p in not_indexed[:4])
            suffix = f" and {len(not_indexed) - 4} more" if len(not_indexed) > 4 else ""
            workspace_lines.append(f"Not indexed yet: {names}{suffix}.")
        if changed:
            ch_names = ", ".join(changed[:4])
            suffix = f" and {len(changed) - 4} more" if len(changed) > 4 else ""
            workspace_lines.append(f"Recent changes in {ch_names}{suffix}.")
        elif ws.get("last_scan_at"):
            workspace_lines.append(f"Workspace last scanned {ws['last_scan_at']}.")

        for p in indexed[:2]:
            summ = summaries.get(p.get("id")) or load_summary(ddir, p.get("id") or "")
            if summ and summ.get("summary"):
                workspace_lines.append(summ["summary"])

        if dev_ready and indexed:
            indexed_name = indexed[0].get("name") or (focus_names[0] if focus_names else "your top project")
            workspace_lines.append(f"Developer Agent can review {indexed_name} when ready.")

    if len(ready_agents) == 1:
        ready_line = f"{ready_agents[0].get('name', 'Agent')} is ready."
    elif len(ready_agents) > 1:
        names = [a.get("name", "Agent") for a in ready_agents]
        ready_line = f"{', '.join(names[:-1])} and {names[-1]} are ready."
    else:
        ready_line = ""

    high_priority = sorted(
        projects,
        key=lambda p: 0 if (p.get("priority") or "").lower() == "high" else 1,
    )
    actions = [
        (p.get("suggested_next_action") or "").strip()
        for p in high_priority
        if (p.get("suggested_next_action") or "").strip()
    ]
    if workspace_lines:
        rec = workspace_lines[0]
    elif len(focus_names) >= 2:
        rec = (
            "Recommended next action: "
            f"Review {focus_names[0]} onboarding or define the {focus_names[1]} core workflow."
        )
    elif len(actions) == 1:
        rec = f"Recommended next action: {actions[0]}"
    else:
        rec = ""

    parts = [greeting.rstrip(".") + ".", "Cerberus is online."]
    if focus_text:
        parts.append(f"Your active focus is {focus_text}.")
    for line in workspace_lines[:3]:
        parts.append(line)
    if ready_line:
        parts.append(ready_line)
    if rec and rec not in parts:
        parts.append(rec)

    text = " ".join(parts)
    return {
        "text": text,
        "greeting": greeting,
        "focus": focus_names,
        "ready_agents": [a.get("name") for a in ready_agents],
        "recommended_actions": actions,
        "workspace_lines": workspace_lines,
    }


def build_cerberus_system_context() -> str:
    """Compact Cerberus OS context for assistant / agent system prompts."""
    from src.cerberus_project_index import format_summaries_for_agents, load_all_summaries

    identity = load_cerberus_identity()
    profile = load_aurelius_profile()
    focus = resolve_dynamic_focus()
    projects = focus.get("projects") or active_focus_projects()
    agents = load_agents()
    summaries = load_all_summaries(data_dir())

    address = profile_address(profile) or identity.get("address_user_as") or "Sir"
    reply_style = identity.get("reply_style") or (
        "Default to brief replies unless the user asks for detail. "
        "Voice: 1–4 sentences. Text: concise but useful. "
        "When responding by voice, be brief, natural, and refer to the user as sir "
        "without overusing punctuation."
    )

    lines = [
        "# Cerberus OS Context",
        f"You are {identity.get('name', 'Cerberus')}, {identity.get('role', 'a local AI operating system')}.",
        f"Mission: {identity.get('mission', '')}",
        f"Tone: {identity.get('tone', '')}",
        f"Style: {identity.get('style', '')}",
        f"Address the user as {address} (e.g. \"Yes sir\", \"Understood, Sir\", \"Good evening, Sir\").",
        f"Reply style: {reply_style}",
        "Avoid long essays, generic AI waffle, overexplaining, and repeating context.",
        "",
        f"## User: {profile.get('name', 'User')} ({address})",
        f"Role: {profile.get('role', '')}",
        f"Work style: {profile.get('work_style', '')}",
        f"Focus rule: {profile.get('focus_selection_rule', '')}",
        f"Dynamic focus ({focus.get('reason', 'unknown')}): {focus.get('label') or 'none'}",
        f"Skills: {', '.join(profile.get('skills', [])) if isinstance(profile.get('skills'), list) else ''}",
        f"Business preferences: {profile.get('business_preferences_text', '')}",
        f"Preferences: {profile.get('likes', '')}",
        f"How to assist: {profile.get('assistant_style', '')}",
        f"Cerberus role: {profile.get('cerberus_role', '')}",
    ]

    try:
        from src.cerberus_council import council_context_block
        council = council_context_block()
        if council:
            lines.append("")
            lines.append(council)
    except Exception:
        pass

    if projects:
        lines.append("")
        lines.append("## Active Projects")
        for p in projects:
            name = p.get("name", "Project")
            desc = p.get("description", "")
            nxt = p.get("suggested_next_action", "")
            pri = p.get("priority", "")
            lines.append(f"- {name} ({pri}): {desc}")
            if p.get("path"):
                lines.append(f"  Path: {p.get('path')} — {p.get('file_count', 0)} files indexed")
            ch = p.get("recent_changes") or {}
            if ch.get("new_count") or ch.get("modified_count"):
                lines.append(
                    f"  Recent changes: {ch.get('new_count', 0)} new, {ch.get('modified_count', 0)} modified"
                )
            if nxt:
                lines.append(f"  Next: {nxt}")

    if summaries:
        lines.append("")
        lines.append("## Project Index Summaries (metadata only — no raw file dumps)")
        lines.append(format_summaries_for_agents(summaries))

    if agents:
        lines.append("")
        lines.append("## Agent Personalities (reference roles — you may adopt the relevant lens)")
        for a in agents:
            lines.append(
                f"- {a.get('name', 'Agent')} [{a.get('status', 'idle')}]: {a.get('role', '')}"
            )

    return "\n".join(line for line in lines if line is not None).strip()
