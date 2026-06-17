"""Atlas Project Indexing V2 — safe key-file reads + enriched summaries."""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from src.cerberus_config import data_dir, load_projects, save_projects
from src.cerberus_project_index import (
    diff_indexes,
    index_project,
    load_index,
    load_summary,
    save_summary,
    scan_directory,
    _normalize_project_path,
    _read_snippet,
    _ws_config,
)

logger = logging.getLogger(__name__)

V2_KEY_PATTERNS: List[Tuple[str, str]] = [
    ("README.md", "readme"),
    ("readme.md", "readme"),
    ("package.json", "manifest"),
    ("pyproject.toml", "python-config"),
    ("requirements.txt", "python-deps"),
    ("Dockerfile", "docker"),
    ("docker-compose.yml", "docker"),
    ("docker-compose.yaml", "docker"),
    ("schema.sql", "schema"),
    ("app.py", "entrypoint"),
    ("main.py", "entrypoint"),
    ("main.ts", "entrypoint"),
    ("main.tsx", "entrypoint"),
    ("main.jsx", "entrypoint"),
    ("index.html", "web"),
]

V2_PATH_SUBSTRINGS = (
    "supabase/config.toml",
    "supabase/migrations",
    "src/app.",
    "src/App.",
    "src/routes",
    "src/router",
    "routes/",
    "app/routes",
)

MAX_EXTRACT_CHARS = 1200
MAX_EXTRACTS = 12
MAX_LLM_CONTEXT_CHARS = 6000


def _folder_size_mb(files: List[Dict[str, Any]]) -> float:
    total = sum(int(f.get("size") or 0) for f in files)
    return round(total / (1024 * 1024), 2)


def _match_key_file(rel: str) -> Optional[str]:
    norm = rel.replace("\\", "/")
    low = norm.lower()
    for fname, role in V2_KEY_PATTERNS:
        if low == fname.lower() or low.endswith("/" + fname.lower()):
            return role
    for part in V2_PATH_SUBSTRINGS:
        if part.lower() in low:
            return "source"
    return None


def collect_safe_key_extracts(root: Path, index: Dict[str, Any], data_dir_path: Path) -> List[Dict[str, Any]]:
    ws = _ws_config(data_dir_path)
    extracts: List[Dict[str, Any]] = []
    seen: set[str] = set()

    for imp in index.get("important_files") or []:
        rel = imp.get("path") or ""
        if not rel or rel in seen:
            continue
        role = imp.get("role") or _match_key_file(rel) or "important"
        text = _read_snippet(root, rel, ws, max_chars=MAX_EXTRACT_CHARS)
        if text:
            seen.add(rel)
            extracts.append({"path": rel, "role": role, "extract": text[:MAX_EXTRACT_CHARS]})

    for f in index.get("files") or []:
        if len(extracts) >= MAX_EXTRACTS:
            break
        rel = f.get("path") or ""
        if not rel or rel in seen:
            continue
        role = _match_key_file(rel)
        if not role:
            continue
        text = _read_snippet(root, rel, ws, max_chars=MAX_EXTRACT_CHARS)
        if text:
            seen.add(rel)
            extracts.append({"path": rel, "role": role, "extract": text[:MAX_EXTRACT_CHARS]})

    return extracts[:MAX_EXTRACTS]


def _infer_project_type(project: Dict[str, Any], stack: List[str], extracts: List[Dict[str, Any]]) -> str:
    stack_l = " ".join(stack).lower()
    paths = " ".join(e["path"].lower() for e in extracts)
    if "game" in stack_l or "unity" in paths or "godot" in paths:
        return "Game"
    if "saas" in (project.get("type") or "").lower():
        return "SaaS"
    if "next" in stack_l or "react" in stack_l or "vue" in stack_l:
        return "App"
    if "html" in paths and "package.json" not in paths:
        return "Website"
    if stack:
        return "Tool"
    return "Unknown"


def _infer_stage(project: Dict[str, Any], index: Dict[str, Any], extracts: List[Dict[str, Any]]) -> str:
    fc = index.get("file_count") or 0
    status = (project.get("status") or "").lower()
    if status == "paused":
        return "paused"
    if fc < 5:
        return "idea"
    if fc < 40:
        return "prototype"
    has_docker = any("docker" in (e.get("role") or "") for e in extracts)
    has_readme = any("readme" in (e.get("role") or "") for e in extracts)
    if has_docker and fc > 100:
        return "launch-ready"
    if status == "active" and fc > 80:
        return "active build"
    if has_readme and fc > 20:
        return "active build"
    return "prototype"


def compute_potential_score(
    project: Dict[str, Any],
    index: Dict[str, Any],
    extracts: List[Dict[str, Any]],
    *,
    project_type: str,
    stage: str,
) -> int:
    score = 20
    fc = index.get("file_count") or 0
    ch = index.get("recent_changes") or project.get("recent_changes") or {}
    activity = (ch.get("new_count") or 0) + (ch.get("modified_count") or 0)

    # completeness
    if any(e.get("role") == "readme" for e in extracts):
        score += 10
    if any(e.get("role") == "manifest" for e in extracts):
        score += 8
    if len(extracts) >= 4:
        score += 8
    if fc > 50:
        score += 6

    # monetisation clarity
    if project.get("suggested_next_action"):
        score += 5
    if project_type in ("SaaS", "App", "Tool"):
        score += 8

    # activity
    score += min(15, activity * 2)
    if (project.get("priority") or "").lower() == "high":
        score += 8

    # technical readiness
    if any(e.get("role") == "docker" for e in extracts):
        score += 6
    if stage in ("active build", "launch-ready", "live"):
        score += 10

    # marketability
    if project_type in ("SaaS", "Website", "App"):
        score += 6

    # launch readiness
    if stage == "launch-ready":
        score += 12
    elif stage == "live":
        score += 15

    # AI automation potential
    if fc > 30 and project.get("agents_allowed", True):
        score += 8

    return max(0, min(100, score))


def _metadata_fallback_summary(
    project: Dict[str, Any],
    index: Dict[str, Any],
    changes: Dict[str, Any],
    extracts: List[Dict[str, Any]],
) -> Dict[str, Any]:
    stack = project.get("detected_stack") or []
    project_type = _infer_project_type(project, stack, extracts)
    stage = _infer_stage(project, index, extracts)
    score = compute_potential_score(project, index, extracts, project_type=project_type, stage=stage)
    name = project.get("name", "Project")
    what = (
        f"{name} appears to be a {project_type} project"
        f" with {index.get('file_count', 0)} tracked files"
        f" ({', '.join(stack[:3]) or 'mixed stack'})."
    )
    strengths = []
    weaknesses = []
    missing = []
    monetisation = []
    next_steps = []
    risks = []

    if any(e.get("role") == "readme" for e in extracts):
        strengths.append("Has README documentation")
    else:
        missing.append("README.md")
    if any(e.get("role") == "manifest" for e in extracts):
        strengths.append("Package manifest present")
    if any(e.get("role") == "docker" for e in extracts):
        strengths.append("Container setup detected")
    else:
        missing.append("Deployment/Docker setup")
    if changes.get("modified_count") or changes.get("new_count"):
        strengths.append("Recent file activity")
    if stage == "idea":
        weaknesses.append("Early-stage — limited codebase")
        next_steps.append("Define MVP scope and index after first build")
    elif stage == "prototype":
        next_steps.append("Run Business Agent monetisation report")
    else:
        next_steps.append("Run Developer Agent codebase review")
    if project.get("suggested_next_action"):
        next_steps.insert(0, project["suggested_next_action"])
    monetisation = [
        "Per-seat SaaS subscription",
        "Usage-based tier for power users",
        "Concierge onboarding for first customers",
    ]
    if score < 40:
        risks.append("Low completeness — index may be incomplete")
    if not project.get("agents_allowed", True):
        risks.append("Agent access disabled for this project")

    return {
        "what_it_appears_to_do": what,
        "current_stage": stage,
        "project_type": project_type,
        "strengths": strengths[:6],
        "weaknesses": weaknesses[:6],
        "missing_pieces": missing[:6],
        "monetisation_options": monetisation[:5],
        "recommended_next_steps": next_steps[:5],
        "risk_flags": risks[:5],
        "potential_score": score,
    }


def _build_llm_prompt(project: Dict[str, Any], extracts: List[Dict[str, Any]], meta: Dict[str, Any]) -> str:
    blocks = []
    total = 0
    for e in extracts:
        chunk = f"### {e['path']} ({e['role']})\n{e['extract'][:800]}\n"
        if total + len(chunk) > MAX_LLM_CONTEXT_CHARS:
            break
        blocks.append(chunk)
        total += len(chunk)
    extract_block = "\n".join(blocks) or "(no safe extracts)"
    return (
        f"Analyse project **{project.get('name')}** from safe file extracts only.\n"
        "Return JSON with keys: what_it_appears_to_do, current_stage, project_type, "
        "strengths (array), weaknesses (array), missing_pieces (array), "
        "monetisation_options (array), recommended_next_steps (array), risk_flags (array), potential_score (0-100).\n"
        f"Metadata hints: type={meta.get('project_type')}, stage={meta.get('current_stage')}, score={meta.get('potential_score')}\n\n"
        f"{extract_block}"
    )


def _parse_llm_json(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


async def _llm_enrich_summary(
    owner: Optional[str],
    project: Dict[str, Any],
    extracts: List[Dict[str, Any]],
    meta: Dict[str, Any],
) -> Dict[str, Any]:
    from src.cerberus_agents import call_cerberus_llm
    from src.cerberus_config import build_cerberus_system_context

    system = (
        f"{build_cerberus_system_context()}\n\n"
        "You summarise software projects from safe metadata extracts only. "
        "Respond with valid JSON only — no markdown fences."
    )
    user = _build_llm_prompt(project, extracts, meta)
    raw = await call_cerberus_llm(owner, system, user)
    parsed = _parse_llm_json(raw or "")
    if not parsed:
        return meta
    out = dict(meta)
    for key in (
        "what_it_appears_to_do", "current_stage", "project_type",
        "strengths", "weaknesses", "missing_pieces", "monetisation_options",
        "recommended_next_steps", "risk_flags", "potential_score",
    ):
        if key in parsed and parsed[key] is not None:
            out[key] = parsed[key]
    if isinstance(out.get("potential_score"), (int, float)):
        out["potential_score"] = max(0, min(100, int(out["potential_score"])))
    return out


def build_v2_summary(
    project: Dict[str, Any],
    index: Dict[str, Any],
    changes: Dict[str, Any],
    extracts: List[Dict[str, Any]],
    *,
    enriched: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    meta = enriched or _metadata_fallback_summary(project, index, changes, extracts)
    important = [e["path"] for e in extracts]
    recent_changes = (changes.get("modified_files") or [])[:10]
    summary_text = meta.get("what_it_appears_to_do") or ""
    next_steps = meta.get("recommended_next_steps") or []
    return {
        "project_id": project.get("id"),
        "name": project.get("name"),
        "path": project.get("path"),
        "detected_stack": project.get("detected_stack") or [],
        "file_count": index.get("file_count", 0),
        "folder_size_mb": _folder_size_mb(index.get("files") or []),
        "important_files": important,
        "recent_changes": recent_changes,
        "safe_key_file_extracts": extracts,
        "project_type": meta.get("project_type", "Unknown"),
        "what_it_appears_to_do": meta.get("what_it_appears_to_do", summary_text),
        "current_stage": meta.get("current_stage", "unknown"),
        "strengths": meta.get("strengths") or [],
        "weaknesses": meta.get("weaknesses") or [],
        "missing_pieces": meta.get("missing_pieces") or [],
        "monetisation_options": meta.get("monetisation_options") or [],
        "recommended_next_steps": next_steps,
        "risk_flags": meta.get("risk_flags") or [],
        "potential_score": meta.get("potential_score", 0),
        "summary": summary_text,
        "next_questions": next_steps[:4],
        "last_indexed_at": index.get("indexed_at"),
        "ignored_count": index.get("ignored_count", 0),
        "index_version": 2,
    }


async def index_project_v2(
    data_dir_path: Path,
    project: Dict[str, Any],
    *,
    owner: Optional[str] = None,
    use_llm: bool = True,
) -> Dict[str, Any]:
    """Run V1 index then enrich summary with safe key-file extracts."""
    base = index_project(data_dir_path, dict(project))
    if not base.get("ok"):
        return base

    project = base["project"]
    index = base["index"]
    changes = index.get("recent_changes") or {}
    path_str = project.get("path") or ""
    root, err = _normalize_project_path(path_str, data_dir_path)
    if err or not root:
        return base

    extracts = collect_safe_key_extracts(root, index, data_dir_path)
    meta = _metadata_fallback_summary(project, index, changes, extracts)
    if use_llm and extracts:
        try:
            meta = await _llm_enrich_summary(owner, project, extracts, meta)
        except Exception as exc:
            logger.warning("[cerberus-index-v2] LLM enrich failed: %s", exc)

    summary = build_v2_summary(project, index, changes, extracts, enriched=meta)
    save_summary(data_dir_path, project.get("id") or "", summary)
    if meta.get("recommended_next_steps"):
        project["suggested_next_action"] = meta["recommended_next_steps"][0]

    return {
        **base,
        "summary": summary,
        "index_version": 2,
        "potential_score": summary.get("potential_score"),
        "current_stage": summary.get("current_stage"),
        "briefing": summary.get("what_it_appears_to_do"),
        "project": project,
    }


async def index_projects_batch_v2(
    data_dir_path: Path,
    projects: List[Dict[str, Any]],
    *,
    owner: Optional[str] = None,
) -> Dict[str, Any]:
    updated = list(projects)
    by_id = {p.get("id"): i for i, p in enumerate(updated) if p.get("id")}
    indexed_count = 0
    skipped_count = 0
    errors: List[Dict[str, str]] = []

    for project in projects:
        pid = project.get("id") or ""
        name = project.get("name") or pid
        if not (project.get("path") or "").strip():
            skipped_count += 1
            errors.append({"project_id": pid, "name": name, "message": "No path set"})
            continue
        result = await index_project_v2(data_dir_path, dict(project), owner=owner)
        if not result.get("ok"):
            skipped_count += 1
            errors.append({"project_id": pid, "name": name, "message": result.get("message") or "Failed"})
            continue
        indexed_count += 1
        if pid in by_id:
            updated[by_id[pid]] = result["project"]

    return {
        "ok": True,
        "projects": updated,
        "indexed_count": indexed_count,
        "skipped_count": skipped_count,
        "errors": errors,
        "index_version": 2,
    }


async def index_all_projects_v2(data_dir_path: Path, *, owner: Optional[str] = None) -> Dict[str, Any]:
    projects = load_projects()
    batch = await index_projects_batch_v2(data_dir_path, projects, owner=owner)
    save_projects(batch["projects"])
    n = batch["indexed_count"]
    skip = batch["skipped_count"]
    return {
        "ok": True,
        "message": f"Deep indexed {n} project(s)" + (f", skipped {skip}" if skip else "") + ".",
        **batch,
    }
