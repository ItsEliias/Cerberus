"""Atlas Reasoning Audit V1 — read-only workspace/project/agent context audit."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from src.cerberus_agents import get_agent_system_prompts
from src.cerberus_briefing_v2 import load_briefing_settings
from src.cerberus_command_centre import _index_stale, load_active_project
from src.cerberus_config import (
    active_focus_projects,
    data_dir,
    load_agents,
    load_aurelius_profile,
    load_projects,
    resolve_dynamic_focus,
)
from src.cerberus_project_index import load_all_summaries, load_index, load_summary
from src.cerberus_projects import build_project_context
from src.cerberus_workspace import load_workspace

_SEED_NAMES: frozenset[str] = frozenset()
_HARDCODE_MARKERS: tuple[str, ...] = ()
_AUTH_PATH_RE = re.compile(
    r"(auth|login|signin|signup|session|jwt|oauth|middleware|protected|guard)",
    re.I,
)
_DB_PATH_RE = re.compile(
    r"(schema|migration|supabase|prisma|drizzle|entities|base44|database)",
    re.I,
)
_ROUTE_PATH_RE = re.compile(
    r"(routes?[/\\]|router|pages[/\\]|dashboard|app\.(tsx|jsx|vue)|layout\.(tsx|jsx))",
    re.I,
)
_AUTH_TEXT_RE = re.compile(r"\b(build|add|implement|create)\s+(auth|login|authentication)\b", re.I)


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _read_text(path: Path, max_chars: int = 200_000) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")[:max_chars]
    except OSError:
        return ""


def _line_is_seed_bias(rel: str, line: str) -> bool:
    """Flag hardcoded focus bias, not legitimate discovered project entries."""
    low = line.lower()
    if "projects.json" in rel.replace("\\", "/"):
        return False
    if "current_focus" in low:
        return any(m in low for m in _HARDCODE_MARKERS)
    if rel.endswith("aurelius_profile.json"):
        return "current_focus" in low and any(m in low for m in _HARDCODE_MARKERS)
    if "cerberus_agents.py" in rel:
        if "do not assume" in low or "dynamic focus" in low:
            return False
        bias_patterns = (
            'get("current_focus"',
        )
        return any(p in low for p in bias_patterns) or (
            any(k in low for k in ("fallback", "default", "primary", "target =", "focus ="))
            and "current_focus" in low
        )
    if "agents.json" in rel and "config/atlas" in rel.replace("\\", "/"):
        if any(k in low for k in ("current_task", "last_report")):
            return any(m in low for m in _HARDCODE_MARKERS)
    return False


def _scan_hardcoded_in_source() -> List[Dict[str, Any]]:
    findings: List[Dict[str, Any]] = []
    root = Path(__file__).resolve().parent.parent
    targets = [
        root / "src" / "cerberus_agents.py",
        root / "src" / "cerberus_config.py",
        root / "src" / "cerberus_briefing_v2.py",
        root / "config" / "atlas" / "aurelius_profile.json",
        root / "config" / "atlas" / "agents.json",
    ]
    ddir = data_dir()
    targets.extend([
        ddir / "aurelius_profile.json",
        ddir / "agents.json",
    ])
    seen: set[str] = set()
    for path in targets:
        if not path.is_file():
            continue
        text = _read_text(path)
        rel = str(path.relative_to(root)) if path.is_relative_to(root) else str(path)
        for i, line in enumerate(text.splitlines(), 1):
            if not _line_is_seed_bias(rel, line):
                continue
            low = line.lower()
            marker = next((m for m in _HARDCODE_MARKERS if m in low), "hardcoded_focus_bias")
            key = f"{rel}:{i}"
            if key in seen:
                continue
            seen.add(key)
            findings.append({
                "file": rel,
                "line": i,
                "marker": marker,
                "excerpt": line.strip()[:160],
            })
    return findings


def _active_focus_audit() -> Dict[str, Any]:
    profile = load_aurelius_profile()
    projects = load_projects()
    active = active_focus_projects()
    dynamic = resolve_dynamic_focus()
    ws = load_workspace(data_dir())
    briefing = load_briefing_settings()
    active_file = load_active_project()
    ddir = data_dir()

    sources: List[Dict[str, Any]] = []
    sources.append({
        "source": "data/atlas/projects.json",
        "type": "active_projects",
        "value": [p.get("name") for p in active],
        "ids": [p.get("id") for p in active],
    })
    sources.append({
        "source": "resolve_dynamic_focus()",
        "type": "dynamic_focus",
        "value": dynamic.get("label"),
        "reason": dynamic.get("reason"),
        "project_ids": [p.get("id") for p in dynamic.get("projects") or []],
    })
    sources.append({
        "source": "data/atlas/aurelius_profile.json",
        "type": "focus_selection_rule",
        "value": profile.get("focus_selection_rule"),
        "legacy_current_focus": profile.get("current_focus"),
    })
    sources.append({
        "source": "data/atlas/workspace.json",
        "type": "workspace_root",
        "value": ws.get("workspace_root"),
        "last_scan_at": ws.get("last_scan_at"),
    })
    sources.append({
        "source": "data/atlas/briefing_settings.json",
        "type": "briefing_settings",
        "value": briefing,
    })
    sources.append({
        "source": "data/atlas/active_project.json",
        "type": "active_project_id",
        "value": (active_file or {}).get("project_id"),
        "set_at": (active_file or {}).get("set_at"),
    })

    pinned = [p.get("name") for p in projects if p.get("pinned")]
    if pinned:
        sources.append({"source": "projects.json", "type": "pinned_projects", "value": pinned})

    seed_hits = []
    for p in projects:
        if not (p.get("path") or "").strip():
            seed_hits.append(p.get("name") or p.get("id") or "unknown")

    config_exists = (Path(__file__).resolve().parent.parent / "config" / "atlas" / "projects.json").is_file()

    return {
        "sources": sources,
        "active_project_names": [p.get("name") for p in active],
        "dynamic_focus": dynamic,
        "profile_focus_text": profile.get("current_focus"),
        "focus_selection_rule": profile.get("focus_selection_rule"),
        "pinned_projects": pinned,
        "runtime_data_dir": str(ddir),
        "config_seed_present": config_exists,
        "unlinked_seed_projects": seed_hits,
        "client_storage_keys_to_check": [
            "cerberus-active-project-id",
            "cerberus_voice_settings",
            "lastSessionId",
            "odysseus-session-sort",
        ],
    }


def _file_paths_from_index(index: Optional[Dict[str, Any]]) -> List[str]:
    if not index:
        return []
    paths: List[str] = []
    for imp in index.get("important_files") or []:
        if isinstance(imp, dict):
            paths.append(imp.get("path") or "")
        else:
            paths.append(str(imp))
    for f in index.get("files") or []:
        paths.append(f.get("path") or "")
    return [p for p in paths if p]


def _detect_feature_groups(paths: List[str]) -> Dict[str, Any]:
    auth_files: List[str] = []
    db_files: List[str] = []
    route_files: List[str] = []
    supabase_files: List[str] = []
    for p in paths:
        norm = p.replace("\\", "/")
        low = norm.lower()
        if _AUTH_PATH_RE.search(low):
            auth_files.append(norm)
        if _DB_PATH_RE.search(low):
            db_files.append(norm)
        if "supabase" in low or "base44" in low:
            supabase_files.append(norm)
        if _ROUTE_PATH_RE.search(low):
            route_files.append(norm)
    return {
        "auth_files": sorted(set(auth_files))[:30],
        "database_schema_files": sorted(set(db_files))[:30],
        "supabase_base44_files": sorted(set(supabase_files))[:30],
        "routes_pages_files": sorted(set(route_files))[:30],
        "has_auth": bool(auth_files),
        "has_database": bool(db_files),
        "has_supabase": bool(supabase_files),
        "has_routes": bool(route_files),
    }


def _summary_source(summary: Optional[Dict[str, Any]]) -> str:
    if not summary:
        return "none"
    if summary.get("index_version") == 2:
        if summary.get("llm_enriched"):
            return "deep_index_v2_llm"
        if summary.get("potential_score") is not None:
            return "deep_index_v2_heuristic"
        return "deep_index_v2"
    if summary.get("summary"):
        return "index_v1"
    return "empty"


def _confidence_score(project: Dict[str, Any], summary: Optional[Dict[str, Any]], ctx: Dict[str, Any]) -> int:
    score = 0
    if project.get("last_indexed_at"):
        score += 20
    if summary:
        score += 15
    if summary and summary.get("index_version") == 2:
        score += 25
    if (ctx.get("index_meta") or {}).get("file_count", 0) > 0:
        score += 10
    extracts = (summary or {}).get("safe_key_file_extracts") or []
    if extracts:
        score += 15
    if not _index_stale(project, summary):
        score += 15
    return min(100, score)


def _audit_project(project: Dict[str, Any], ddir: Path) -> Dict[str, Any]:
    pid = project.get("id") or ""
    ctx = build_project_context(pid)
    summary = ctx.get("summary") or load_summary(ddir, pid)
    index = load_index(ddir, pid)
    paths = _file_paths_from_index(index)
    features = _detect_feature_groups(paths)
    stale = _index_stale(project, summary)
    is_v2 = bool(summary and (summary.get("index_version") == 2 or summary.get("potential_score") is not None))
    missing = (summary or {}).get("missing_pieces") or []
    auth_warnings: List[str] = []
    if features["has_auth"]:
        for piece in missing:
            if _AUTH_TEXT_RE.search(str(piece)):
                auth_warnings.append(
                    "Possible outdated/incomplete project summary: summary suggests building auth but auth files exist."
                )
                break
        for step in (summary or {}).get("recommended_next_steps") or []:
            if _AUTH_TEXT_RE.search(str(step)):
                auth_warnings.append(
                    "Recommended next step mentions building auth but indexed auth files were detected."
                )
                break

    important_read = len((ctx.get("index_meta") or {}).get("important_files") or [])
    if summary and summary.get("safe_key_file_extracts"):
        important_read = max(important_read, len(summary["safe_key_file_extracts"]))

    return {
        "project_id": pid,
        "name": project.get("name"),
        "path": project.get("display_path") or project.get("path"),
        "indexed": bool(project.get("last_indexed_at") or project.get("indexed")),
        "deep_indexed": is_v2,
        "file_count": (ctx.get("index_meta") or {}).get("file_count") or project.get("file_count", 0),
        "important_files_read": important_read,
        "detected_stack": project.get("detected_stack") or [],
        "summary_source": _summary_source(summary),
        "last_indexed_at": project.get("last_indexed_at") or (summary or {}).get("last_indexed_at"),
        "recent_changes": ctx.get("recent_changes") or {},
        "stale_summary": stale,
        "confidence_score": _confidence_score(project, summary, ctx),
        "potential_score": ctx.get("potential_score"),
        "current_stage": ctx.get("current_stage"),
        "features_detected": features,
        "auth_summary_warnings": auth_warnings,
        "missing_pieces": missing[:8],
        "using_real_files": bool(paths) and bool(project.get("path")),
    }


def _audit_flagged_project(projects_audit: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Return feature audit for the first project with auth/summary warnings."""
    flagged = next((p for p in projects_audit if p.get("auth_summary_warnings")), None)
    if not flagged:
        return None
    feats = flagged.get("features_detected") or {}
    checks = {
        "auth_files": feats.get("has_auth"),
        "database_schema": feats.get("has_database"),
        "supabase_base44": feats.get("has_supabase"),
        "routes_pages": feats.get("has_routes"),
        "dashboard_logic": any("dashboard" in (f or "").lower() for f in feats.get("routes_pages_files") or []),
        "login_auth_logic": feats.get("has_auth"),
    }
    return {
        "project_id": flagged.get("project_id"),
        "project_name": flagged.get("name"),
        "checks": checks,
        "detected_files": feats,
        "warnings": flagged.get("auth_summary_warnings") or [],
        "indexed_features_count": sum(1 for v in checks.values() if v),
        "appears_base44_download": feats.get("has_supabase") or feats.get("has_database"),
    }


def _audit_agents(ddir: Path) -> List[Dict[str, Any]]:
    agents = load_agents()
    prompts = get_agent_system_prompts()
    summaries = load_all_summaries(ddir)
    has_any_summary = bool(summaries)
    has_v2 = any(s.get("index_version") == 2 for s in summaries)
    active = load_active_project()
    active_id = (active or {}).get("project_id")
    active_has_v2 = False
    if active_id:
        s = load_summary(ddir, active_id)
        active_has_v2 = bool(s and s.get("index_version") == 2)

    out: List[Dict[str, Any]] = []
    for agent in agents:
        aid = agent.get("id") or ""
        prompt = prompts.get(aid, "")
        last_report = agent.get("last_report") or ""
        using_fallback = (
            not has_any_summary
            or "offline" in last_report.lower()
            or "placeholder" in last_report.lower()
            or "no recent report" in last_report.lower()
        )
        seed_task = any(m in (agent.get("current_task") or "").lower() for m in _HARDCODE_MARKERS)
        out.append({
            "agent_id": aid,
            "name": agent.get("name"),
            "status": agent.get("status"),
            "system_prompt_excerpt": prompt[:500],
            "project_context_injected": has_any_summary,
            "has_summary_v2_access": has_v2,
            "active_project_has_v2": active_has_v2,
            "using_generic_fallback": using_fallback or not has_v2,
            "last_report_source": last_report[:200],
            "current_task": agent.get("current_task"),
            "seed_task_reference": seed_task,
        })
    return out


def _build_recommendations(
    focus: Dict[str, Any],
    projects: List[Dict[str, Any]],
    agents: List[Dict[str, Any]],
    hardcoded: List[Dict[str, Any]],
    flagged_project: Optional[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    recs: List[Dict[str, Any]] = []

    if focus.get("unlinked_seed_projects"):
        recs.append({
            "priority": 1,
            "area": "active_focus",
            "issue": "Projects without workspace paths",
            "fix": "Run workspace scan and link projects to real folders, or archive unused entries.",
        })
    if focus.get("profile_focus_text") and any(
        m in (focus.get("profile_focus_text") or "").lower() for m in _HARDCODE_MARKERS
    ):
        recs.append({
            "priority": 2,
            "area": "active_focus",
            "issue": "Profile still has legacy current_focus with seed project names",
            "fix": "Remove current_focus from aurelius_profile.json; rely on focus_selection_rule and resolve_dynamic_focus().",
        })
    elif not focus.get("focus_selection_rule"):
        recs.append({
            "priority": 2,
            "area": "active_focus",
            "issue": "Profile missing focus_selection_rule for dynamic focus",
            "fix": "Add focus_selection_rule to aurelius_profile.json and set briefing focus_mode to dynamic.",
        })
    if hardcoded:
        recs.append({
            "priority": 2,
            "area": "hardcoded_context",
            "issue": f"{len(hardcoded)} hardcoded focus-bias references in prompts or seed config",
            "fix": "Remove seed project names from cerberus_agents.py fallbacks and profile current_focus fields.",
        })

    needs_deep = [p["name"] for p in projects if not p.get("deep_indexed") and p.get("path")]
    if needs_deep:
        recs.append({
            "priority": 1,
            "area": "indexing",
            "issue": f"{len(needs_deep)} projects lack Deep Index V2",
            "fix": "Run Deep Index V2 on: " + ", ".join(needs_deep[:5]),
            "projects": needs_deep,
        })

    stale = [p["name"] for p in projects if p.get("stale_summary")]
    if stale:
        recs.append({
            "priority": 2,
            "area": "indexing",
            "issue": f"{len(stale)} projects have stale summaries",
            "fix": "Re-index or Deep Index stale projects after recent workspace changes.",
            "projects": stale,
        })

    if flagged_project and flagged_project.get("warnings"):
        pname = flagged_project.get("project_name") or flagged_project.get("project_id") or "project"
        recs.append({
            "priority": 1,
            "area": "project_summary",
            "issue": f"{pname} summary may be outdated vs indexed auth/schema files",
            "fix": f"Re-run Deep Index V2 on {pname} and verify missing_pieces reflects existing auth.",
        })

    fallback_agents = [a["name"] for a in agents if a.get("using_generic_fallback")]
    if fallback_agents:
        recs.append({
            "priority": 2,
            "area": "agents",
            "issue": "Agents may be using generic/fallback context",
            "fix": "Deep-index active projects and inject summary_v2 + recent changes into agent prompts.",
            "agents": fallback_agents,
        })

    seed_agents = [a["name"] for a in agents if a.get("seed_task_reference")]
    if seed_agents:
        recs.append({
            "priority": 3,
            "area": "agents",
            "issue": "Agent current_task still references seed project names",
            "fix": "Sync agents after real project activity or clear stale current_task strings in agents.json.",
        })

    recs.sort(key=lambda r: r.get("priority", 99))
    return recs


def run_reasoning_audit() -> Dict[str, Any]:
    """Read-only audit of Atlas reasoning context sources."""
    ddir = data_dir()
    focus = _active_focus_audit()
    hardcoded = _scan_hardcoded_in_source()
    projects_raw = [p for p in load_projects() if (p.get("status") or "active").lower() != "archived"]
    projects_audit = [_audit_project(p, ddir) for p in projects_raw]
    flagged_project = _audit_flagged_project(projects_audit)
    agents_audit = _audit_agents(ddir)
    recommendations = _build_recommendations(focus, projects_audit, agents_audit, hardcoded, flagged_project)

    using_real = any(p.get("using_real_files") for p in projects_audit)
    needs_deep = [p["project_id"] for p in projects_audit if not p.get("deep_indexed") and p.get("path")]
    stale = [p["project_id"] for p in projects_audit if p.get("stale_summary")]
    dummy = list({f["marker"] for f in hardcoded})
    if focus.get("unlinked_seed_projects"):
        dummy.extend(focus["unlinked_seed_projects"])
    fallback_agents = [a["agent_id"] for a in agents_audit if a.get("using_generic_fallback")]

    return {
        "ok": True,
        "generated_at": _now_iso(),
        "workspace_health": {
            "workspace_root": next(
                (s["value"] for s in focus["sources"] if s.get("type") == "workspace_root"),
                None,
            ),
            "last_scan_at": next(
                (s.get("last_scan_at") for s in focus["sources"] if s.get("type") == "workspace_root"),
                None,
            ),
            "project_count": len(projects_audit),
            "indexed_count": sum(1 for p in projects_audit if p.get("indexed")),
            "deep_indexed_count": sum(1 for p in projects_audit if p.get("deep_indexed")),
            "using_real_project_files": using_real,
        },
        "active_focus": focus,
        "old_seed_warnings": {
            "hardcoded_references": hardcoded,
            "unlinked_seed_projects": focus.get("unlinked_seed_projects") or [],
            "profile_seed_focus": any(
                m in (focus.get("profile_focus_text") or "").lower() for m in _HARDCODE_MARKERS
            ),
        },
        "projects": projects_audit,
        "flagged_project_audit": flagged_project,
        "agents": agents_audit,
        "recommended_fixes": recommendations,
        "summary": {
            "using_real_project_files": using_real,
            "projects_needing_deep_index": needs_deep,
            "stale_summaries": stale,
            "dummy_or_seed_data_detected": sorted(set(dummy)),
            "agents_using_fallback_context": fallback_agents,
            "fix_first": [r.get("fix") for r in recommendations[:3]],
        },
    }
