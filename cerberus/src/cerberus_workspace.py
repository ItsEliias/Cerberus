"""Atlas workspace discovery — read-only scan of immediate child project folders."""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from src.cerberus_config import load_projects, save_projects
from src.cerberus_mount_workspace import (
    enrich_project,
    get_workspace_status,
    host_root_hint,
    container_root,
    is_docker_mount_mode,
    is_legacy_windows_path,
    is_mounted,
    is_under_container_workspace,
    projects_folder,
    to_display_path,
    validate_project_path,
    NOT_MOUNTED_WARNING,
)

logger = logging.getLogger(__name__)

DEFAULT_WORKSPACE: Dict[str, Any] = {
    "workspace_mode": "managed",
    "workspace_container_root": "/workspace",
    "workspace_root": "",
    "workspace_host_root_hint": "",
    "allow_project_cerberus_folder": False,
    "auto_discover": True,
    "auto_index_on_scan": False,
    "last_scan_at": None,
    "excluded_dirs": [
        "node_modules", ".git", "dist", "build", ".next", ".venv", "venv",
        "__pycache__", ".expo", ".turbo", ".cache",
    ],
    "excluded_files": [
        ".env", ".env.local", ".env.production", "*.pem", "*.key", "*.sqlite", "*.db",
    ],
    "max_files_per_project": 8000,
    "max_file_size_mb": 2,
    "allowed_text_extensions": [
        ".md", ".txt", ".json", ".js", ".jsx", ".ts", ".tsx", ".py",
        ".html", ".css", ".scss", ".sql", ".yaml", ".yml", ".toml", ".dart",
    ],
}

_PRESERVE_FIELDS = (
    "description",
    "priority",
    "status",
    "suggested_next_action",
    "notes",
    "agents_allowed",
    "type",
    "created_at",
    "last_indexed_at",
    "file_count",
    "recent_changes",
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _slug_id(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "project"


def _apply_env_defaults(ws: Dict[str, Any]) -> Dict[str, Any]:
    ws["workspace_container_root"] = container_root()
    if not ws.get("workspace_host_root_hint"):
        ws["workspace_host_root_hint"] = host_root_hint()
    mode = (ws.get("workspace_mode") or "managed").lower()
    if mode == "managed":
        try:
            from src.cerberus_ce_workspace import resolve_workspace_root, projects_scan_roots
            root = resolve_workspace_root()
            ws["workspace_host_root_hint"] = str(root)
            roots = projects_scan_roots(root)
            ws["workspace_root"] = str(roots[0]) if roots else str(root / "Offices")
        except Exception:
            pass
        return ws
    if is_docker_mount_mode(ws):
        wr = (ws.get("workspace_root") or "").strip()
        pf = projects_folder()
        # Always resolve scan root from the live mount path (env may differ from /workspace in tests)
        if (
            not wr
            or is_legacy_windows_path(wr)
            or wr.startswith("/app/")
            or wr == "/workspace/Projects"
            or not Path(wr).exists()
        ):
            ws["workspace_root"] = pf
        elif not wr.startswith(container_root()):
            ws["workspace_root"] = pf
    return ws


def load_workspace(data_dir: Path) -> Dict[str, Any]:
    path = data_dir / "workspace.json"
    if not path.exists():
        defaults = _apply_env_defaults(dict(DEFAULT_WORKSPACE))
        save_workspace(data_dir, defaults)
        return defaults
    try:
        import json
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return _apply_env_defaults(dict(DEFAULT_WORKSPACE))
        merged = dict(DEFAULT_WORKSPACE)
        merged.update(data)
        return _apply_env_defaults(merged)
    except Exception as exc:
        logger.warning("[cerberus-workspace] read failed: %s", exc)
        return _apply_env_defaults(dict(DEFAULT_WORKSPACE))


def save_workspace(data_dir: Path, config: Dict[str, Any]) -> Dict[str, Any]:
    import json
    data_dir.mkdir(parents=True, exist_ok=True)
    path = data_dir / "workspace.json"
    tmp = path.with_suffix(".json.tmp")
    payload = dict(DEFAULT_WORKSPACE)
    payload.update(config)
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)
    return payload


def _resolve_root(path_str: str, ws: Optional[Dict[str, Any]] = None) -> Tuple[Optional[Path], Optional[str]]:
    raw = (path_str or "").strip()
    if not raw:
        return None, "Workspace projects folder is not configured"
    if ws and is_docker_mount_mode(ws) and not is_mounted():
        return None, NOT_MOUNTED_WARNING
    if ws and is_docker_mount_mode(ws):
        return validate_project_path(raw, ws)
    try:
        resolved = Path(raw).expanduser().resolve()
    except (OSError, ValueError) as exc:
        return None, f"Invalid workspace path: {exc}"
    if not resolved.exists():
        return None, f"Workspace path does not exist: {resolved}"
    if not resolved.is_dir():
        return None, f"Workspace path is not a directory: {resolved}"
    return resolved, None


def detect_stack(folder: Path) -> Tuple[str, List[str]]:
    """Detect project type and stack from marker files in project root."""
    stack: List[str] = []
    detected_type = "Folder"

    markers = {
        "package.json": ("Node/JS", ["JavaScript", "Node"]),
        "pyproject.toml": ("Python", ["Python"]),
        "requirements.txt": ("Python", ["Python"]),
        "pubspec.yaml": ("Flutter/Dart", ["Dart", "Flutter"]),
        "docker-compose.yml": ("Docker", ["Docker"]),
        "Dockerfile": ("Docker", ["Docker"]),
    }

    for fname, (ptype, tags) in markers.items():
        if (folder / fname).is_file():
            detected_type = ptype
            stack.extend(tags)

    if (folder / "package.json").is_file():
        try:
            import json
            pkg = json.loads((folder / "package.json").read_text(encoding="utf-8", errors="ignore"))
            deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
            if "react" in deps or "next" in deps:
                stack.append("React")
            if "vue" in deps:
                stack.append("Vue")
            if "express" in deps:
                stack.append("Express")
            if "@supabase/supabase-js" in deps or "supabase" in str(deps).lower():
                stack.append("Supabase")
        except Exception:
            pass

    if any((folder / p).is_file() for p in ("README.md", "readme.md", "Readme.md")):
        if detected_type == "Folder":
            detected_type = "Documented Project"
        if "Documented" not in stack:
            stack.append("Documented")

    if (folder / "supabase").is_dir() or (folder / "schema.sql").is_file():
        stack.append("Supabase")

    # dedupe preserve order
    seen = set()
    stack = [s for s in stack if not (s in seen or seen.add(s))]

    return detected_type, stack


def _candidate_from_folder(folder: Path, ws: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    detected_type, stack = detect_stack(folder)
    name = folder.name
    pid = _slug_id(name)
    container_path = str(folder).replace("\\", "/")
    return {
        "id": pid,
        "name": name,
        "path": container_path,
        "display_path": to_display_path(container_path, ws),
        "path_status": "valid",
        "description": f"Discovered project at {folder.name}",
        "type": detected_type,
        "detected_type": detected_type,
        "detected_stack": stack,
        "status": "active",
        "priority": "medium",
        "source": "workspace_scan",
        "last_seen_at": _now_iso(),
        "indexed": False,
        "agents_allowed": True,
        "created_at": _now_iso(),
        "last_indexed_at": None,
        "file_count": 0,
        "recent_changes": {},
        "notes": "",
        "suggested_next_action": "",
    }


def _path_key(path_str: str) -> str:
    try:
        return str(Path(path_str).expanduser().resolve()).lower()
    except OSError:
        return (path_str or "").lower()


def _find_existing(
    existing_list: List[Dict[str, Any]],
    folder: Path,
    pid: str,
) -> Optional[Dict[str, Any]]:
    path_k = _path_key(str(folder))
    name_low = folder.name.lower()
    for p in existing_list:
        if p.get("path") and _path_key(p["path"]) == path_k:
            return p
        if (p.get("id") or "").lower() == pid:
            return p
        if (p.get("name") or "").lower() == name_low:
            return p
    return None


def merge_discovered(existing: Optional[Dict[str, Any]], candidate: Dict[str, Any]) -> Dict[str, Any]:
    """Preserve manual Atlas fields when updating from workspace scan."""
    merged = dict(candidate)
    if not existing:
        return merged
    merged["id"] = existing.get("id") or candidate["id"]
    for field in _PRESERVE_FIELDS:
        val = existing.get(field)
        if val is not None and val != "" and val != {}:
            merged[field] = val
    if existing.get("description") and existing["description"] != candidate.get("description"):
        merged["description"] = existing["description"]
    if existing.get("type") and existing.get("source") != "workspace_scan":
        merged["type"] = existing["type"]
    merged["indexed"] = bool(existing.get("last_indexed_at"))
    merged["source"] = existing.get("source") or "workspace_scan"
    if existing.get("source") == "manual":
        merged["source"] = "manual"
    return merged


def discover_child_projects(workspace_root: Path, ws: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """V1: immediate child folders only."""
    discovered = []
    try:
        children = sorted(workspace_root.iterdir(), key=lambda p: p.name.lower())
    except OSError as exc:
        logger.warning("[cerberus-workspace] cannot list %s: %s", workspace_root, exc)
        return []

    for child in children:
        if not child.is_dir():
            continue
        if child.name.startswith(".") and child.name not in {".github", ".vscode"}:
            continue
        if ws and not ws.get("allow_project_cerberus_folder") and child.name.lower() == "atlas":
            continue
        discovered.append(_candidate_from_folder(child, ws))
    return discovered


def relink_project(data_dir: Path, project_id: str) -> Dict[str, Any]:
    """Relink a project with invalid path to matching folder under /workspace/Projects."""
    ws = load_workspace(data_dir)
    projects = load_projects()
    project = next((p for p in projects if p.get("id") == project_id), None)
    if not project:
        return {"ok": False, "message": "Project not found"}

    root, err = _resolve_root(ws.get("workspace_root") or projects_folder(), ws)
    if err:
        return {"ok": False, "message": err}

    candidates = discover_child_projects(root, ws)
    match = next(
        (
            c
            for c in candidates
            if (c.get("id") or "").lower() == (project_id or "").lower()
            or (c.get("name") or "").lower() == (project.get("name") or "").lower()
        ),
        None,
    )
    if not match:
        return {
            "ok": False,
            "message": f"No matching folder in {ws.get('workspace_root')} for {project.get('name')}",
        }

    merged = merge_discovered(project, match)
    merged["path"] = match["path"]
    merged["display_path"] = match.get("display_path") or to_display_path(match["path"], ws)
    merged["path_status"] = "valid"
    merged["can_relink"] = False
    merged["detected_type"] = match.get("detected_type")
    merged["detected_stack"] = match.get("detected_stack") or []
    merged["last_seen_at"] = match.get("last_seen_at")

    for i, p in enumerate(projects):
        if p.get("id") == project_id:
            projects[i] = enrich_project(merged, ws)
            break
    save_projects(projects)
    return {"ok": True, "message": f"Relinked {project.get('name')} to {merged['path']}", "project": merged, "projects": projects}


def scan_workspace(data_dir: Path) -> Dict[str, Any]:
    """Discover projects from workspace_root and merge into projects.json."""
    from src.cerberus_project_index import index_projects_batch

    ws = load_workspace(data_dir)
    mode = (ws.get("workspace_mode") or "managed").lower()
    if mode == "managed":
        try:
            from src.cerberus_ce_workspace import discover_ce_projects, get_ce_workspace_status
            candidates = discover_ce_projects(ws)
            if not candidates:
                return {
                    "ok": True,
                    "message": "No projects found — create a project or import a folder.",
                    "workspace": ws,
                    "status": get_ce_workspace_status(ws),
                    "discovered": [],
                    "projects": load_projects(),
                    "discovered_count": 0,
                    "indexed_count": 0,
                    "skipped_count": 0,
                    "errors": [],
                }
        except Exception as exc:
            logger.warning("[cerberus-workspace] CE scan fallback: %s", exc)
            candidates = []
    else:
        candidates = []

    if not candidates:
        scan_root = ws.get("workspace_root") or projects_folder()
        root, err = _resolve_root(scan_root, ws)
        if err:
            return {"ok": False, "message": err, "status": get_workspace_status(ws)}
        candidates = discover_child_projects(root, ws)
    existing = load_projects()
    merged_projects: List[Dict[str, Any]] = []
    seen_ids = set()
    discovered_names = []

    for cand in candidates:
        match = _find_existing(existing, Path(cand["path"]), cand["id"])
        merged = merge_discovered(match, cand)
        discovered_names.append(merged["name"])
        pid = merged["id"]
        if pid in seen_ids:
            pid = f"{pid}-{len(seen_ids)}"
            merged["id"] = pid
        seen_ids.add(pid)
        merged_projects.append(enrich_project(merged, ws))

    # Keep manual projects not found in scan (different path or no workspace overlap)
    scanned_paths = {_path_key(p["path"]) for p in merged_projects if p.get("path")}
    for old in existing:
        old_path = old.get("path") or ""
        if old_path and _path_key(old_path) in scanned_paths:
            continue
        if old.get("id") in seen_ids:
            continue
        # retain manual entries without workspace collision
        if old.get("source") == "manual" or not old_path:
            merged_projects.append(enrich_project(old, ws))
            seen_ids.add(old.get("id"))
        elif is_legacy_windows_path(old_path) or not is_under_container_workspace(old_path, ws):
            stale = enrich_project(old, ws)
            stale["can_relink"] = True
            merged_projects.append(stale)
            seen_ids.add(old.get("id"))

    ws["last_scan_at"] = _now_iso()
    save_workspace(data_dir, ws)
    save_projects(merged_projects)

    result: Dict[str, Any] = {
        "ok": True,
        "message": f"Discovered {len(candidates)} project folder(s) in workspace.",
        "workspace": ws,
        "status": get_workspace_status(ws),
        "discovered": discovered_names,
        "projects": merged_projects,
        "discovered_count": len(candidates),
        "indexed_count": 0,
        "skipped_count": 0,
        "errors": [],
    }

    if ws.get("auto_index_on_scan"):
        to_index = [p for p in merged_projects if p.get("path")]
        batch = index_projects_batch(data_dir, to_index)
        result["projects"] = batch.get("projects") or merged_projects
        result["indexed_count"] = batch.get("indexed_count", 0)
        result["skipped_count"] = batch.get("skipped_count", 0)
        result["errors"] = batch.get("errors") or []
        save_projects(result["projects"])
        idx_n = result["indexed_count"]
        skip_n = result["skipped_count"]
        result["message"] = (
            f"Discovered {len(candidates)} project(s); indexed {idx_n}"
            + (f", skipped {skip_n}" if skip_n else "")
            + "."
        )

    return result
