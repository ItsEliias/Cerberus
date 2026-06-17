"""Read-only Atlas project directory indexing — metadata only, no secrets."""

from __future__ import annotations

import fnmatch
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from src.cerberus_workspace import DEFAULT_WORKSPACE, load_workspace

logger = logging.getLogger(__name__)

IMPORTANT_FILE_RULES: List[Tuple[str, str]] = [
    ("README.md", "readme"),
    ("package.json", "manifest"),
    ("pyproject.toml", "python-config"),
    ("requirements.txt", "python-deps"),
    ("docker-compose.yml", "docker"),
    ("Dockerfile", "docker"),
    ("schema.sql", "schema"),
    ("app.py", "entrypoint"),
    ("main.py", "entrypoint"),
    ("index.js", "entrypoint"),
    ("index.ts", "entrypoint"),
    ("main.ts", "entrypoint"),
    ("main.dart", "entrypoint"),
]

IMPORTANT_PATH_PARTS = ("supabase/config.toml", "supabase/migrations")


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _indexes_dir(data_dir: Path) -> Path:
    path = data_dir / "project_indexes"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _summaries_dir(data_dir: Path) -> Path:
    path = data_dir / "project_summaries"
    path.mkdir(parents=True, exist_ok=True)
    return path


def index_path(data_dir: Path, project_id: str) -> Path:
    return _indexes_dir(data_dir) / f"{project_id}.json"


def summary_path(data_dir: Path, project_id: str) -> Path:
    return _summaries_dir(data_dir) / f"{project_id}.json"


def load_index(data_dir: Path, project_id: str) -> Optional[Dict[str, Any]]:
    path = index_path(data_dir, project_id)
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("[cerberus-index] could not read %s: %s", path, exc)
        return None


def load_summary(data_dir: Path, project_id: str) -> Optional[Dict[str, Any]]:
    path = summary_path(data_dir, project_id)
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("[cerberus-index] could not read summary %s: %s", path, exc)
        return None


def save_index(data_dir: Path, project_id: str, payload: Dict[str, Any]) -> None:
    path = index_path(data_dir, project_id)
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


def save_summary(data_dir: Path, project_id: str, payload: Dict[str, Any]) -> None:
    path = summary_path(data_dir, project_id)
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


def _ws_config(data_dir: Path) -> Dict[str, Any]:
    return load_workspace(data_dir)


def _skip_dir_names(ws: Dict[str, Any]) -> Set[str]:
    base = set(DEFAULT_WORKSPACE["excluded_dirs"])
    base.update(ws.get("excluded_dirs") or [])
    return {d.lower() for d in base}


def _excluded_file_patterns(ws: Dict[str, Any]) -> List[str]:
    return list(ws.get("excluded_files") or DEFAULT_WORKSPACE["excluded_files"])


def _max_files(ws: Dict[str, Any]) -> int:
    return int(ws.get("max_files_per_project") or 8000)


def _max_bytes(ws: Dict[str, Any]) -> int:
    mb = float(ws.get("max_file_size_mb") or 2)
    return int(mb * 1024 * 1024)


def _allowed_text_ext(ws: Dict[str, Any]) -> Set[str]:
    return {e.lower() for e in (ws.get("allowed_text_extensions") or [])}


_BINARY_EXTENSIONS: Set[str] = {
    ".exe", ".dll", ".so", ".dylib", ".bin", ".o", ".a",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".svg",
    ".mp4", ".mov", ".avi", ".mkv", ".webm",
    ".mp3", ".wav", ".flac", ".ogg",
    ".zip", ".tar", ".gz", ".7z", ".rar",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".woff", ".woff2", ".ttf", ".eot",
    ".sqlite", ".db", ".pyc", ".pyo", ".class", ".jar",
    ".pem", ".key",
}

_MAX_DEPTH = 14
_MAX_PATH_LEN = 512


def _matches_excluded_file(name: str, patterns: List[str]) -> bool:
    low = name.lower()
    if low.startswith(".env"):
        return True
    for pat in patterns:
        if fnmatch.fnmatch(low, pat.lower()):
            return True
    return False


def _should_skip_dir(name: str, skip_dirs: Set[str]) -> bool:
    low = name.lower()
    if low in skip_dirs:
        return True
    return low.startswith(".") and low not in {".github", ".vscode"}


def _should_skip_file(path: Path, ws: Dict[str, Any], *, count_ignored: List[int]) -> bool:
    patterns = _excluded_file_patterns(ws)
    if _matches_excluded_file(path.name, patterns):
        count_ignored[0] += 1
        return True
    ext = path.suffix.lower()
    if ext in _BINARY_EXTENSIONS:
        count_ignored[0] += 1
        return True
    try:
        if path.stat().st_size > _max_bytes(ws):
            count_ignored[0] += 1
            return True
    except OSError:
        count_ignored[0] += 1
        return True
    return False


def _is_important(rel_path: str) -> Optional[str]:
    norm = rel_path.replace("\\", "/")
    low = norm.lower()
    for fname, role in IMPORTANT_FILE_RULES:
        if low == fname.lower() or low.endswith("/" + fname.lower()):
            return role
    for part in IMPORTANT_PATH_PARTS:
        if part in low:
            return "supabase"
    return None


def _read_snippet(root: Path, rel_path: str, ws: Dict[str, Any], max_chars: int = 400) -> Optional[str]:
    fp = root / rel_path
    ext = fp.suffix.lower()
    if ext not in _allowed_text_ext(ws):
        return None
    try:
        if fp.stat().st_size > _max_bytes(ws):
            return None
        text = fp.read_text(encoding="utf-8", errors="ignore")
        return text[:max_chars].strip()
    except OSError:
        return None


def _normalize_project_path(path_str: str, data_dir: Optional[Path] = None) -> Tuple[Optional[Path], Optional[str]]:
    from src.cerberus_config import data_dir as cerberus_data_dir
    from src.cerberus_mount_workspace import validate_project_path

    ws = _ws_config(data_dir or cerberus_data_dir())
    if (ws.get("workspace_mode") or "docker_mount") == "docker_mount":
        return validate_project_path(path_str, ws)
    raw = (path_str or "").strip()
    if not raw:
        return None, "Project path is required"
    try:
        resolved = Path(raw).expanduser().resolve()
    except (OSError, ValueError) as exc:
        return None, f"Invalid path: {exc}"
    if not resolved.exists():
        return None, f"Path does not exist: {resolved}"
    if not resolved.is_dir():
        return None, f"Path is not a directory: {resolved}"
    return resolved, None


def scan_directory(root: Path, data_dir: Path) -> Dict[str, Any]:
    """Walk directory read-only; return file metadata list."""
    ws = _ws_config(data_dir)
    skip_dirs = _skip_dir_names(ws)
    max_files = _max_files(ws)
    ignored = [0]

    files: List[Dict[str, Any]] = []
    file_tree: List[str] = []
    ext_counts: Dict[str, int] = {}
    important_files: List[Dict[str, Any]] = []
    truncated = False
    root_str = str(root)

    for dirpath, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        rel_dir = os.path.relpath(dirpath, root_str)
        depth = 0 if rel_dir == "." else rel_dir.count(os.sep) + 1
        if depth > _MAX_DEPTH:
            dirnames[:] = []
            continue
        dirnames[:] = [d for d in dirnames if not _should_skip_dir(d, skip_dirs)]

        for fname in filenames:
            if len(files) >= max_files:
                truncated = True
                break
            fp = Path(dirpath) / fname
            if _should_skip_file(fp, ws, count_ignored=ignored):
                continue
            try:
                st = fp.stat()
            except OSError:
                ignored[0] += 1
                continue
            rel = os.path.relpath(fp, root_str).replace("\\", "/")
            if len(rel) > _MAX_PATH_LEN:
                continue
            ext = fp.suffix.lower() or "(no ext)"
            ext_counts[ext] = ext_counts.get(ext, 0) + 1
            entry = {
                "path": rel,
                "extension": ext,
                "size": st.st_size,
                "modified_at": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).replace(microsecond=0).isoformat(),
            }
            files.append(entry)
            if len(file_tree) < 500:
                file_tree.append(rel)

            role = _is_important(rel)
            if role:
                imp: Dict[str, Any] = {"path": rel, "role": role, "modified_at": entry["modified_at"]}
                snippet = _read_snippet(root, rel, ws)
                if snippet:
                    imp["snippet_preview"] = snippet[:200]
                important_files.append(imp)
        if truncated:
            break

    # recent by mtime
    recent_files = sorted(files, key=lambda f: f.get("modified_at") or "", reverse=True)[:15]
    recent_paths = [f["path"] for f in recent_files]

    return {
        "root": root_str,
        "indexed_at": _now_iso(),
        "file_count": len(files),
        "truncated": truncated,
        "extension_counts": dict(sorted(ext_counts.items(), key=lambda x: -x[1])[:30]),
        "extension_summary": dict(sorted(ext_counts.items(), key=lambda x: -x[1])[:20]),
        "files": files,
        "file_tree": file_tree,
        "important_files": important_files[:30],
        "recent_files": recent_paths,
        "ignored_count": ignored[0],
    }


def _file_key_map(files: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    return {f["path"]: f for f in files if f.get("path")}


def diff_indexes(
    previous: Optional[Dict[str, Any]],
    current: Dict[str, Any],
) -> Dict[str, Any]:
    prev_files = _file_key_map((previous or {}).get("files") or [])
    curr_files = _file_key_map(current.get("files") or [])

    new_files = [p for p in curr_files if p not in prev_files]
    deleted_files = [p for p in prev_files if p not in curr_files]
    modified_files = []
    for p in curr_files:
        if p in prev_files and prev_files[p].get("modified_at") != curr_files[p].get("modified_at"):
            modified_files.append(p)

    return {
        "new_files": new_files[:100],
        "modified_files": modified_files[:100],
        "deleted_files": deleted_files[:100],
        "new_count": len(new_files),
        "modified_count": len(modified_files),
        "deleted_count": len(deleted_files),
    }


def generate_static_summary(
    project: Dict[str, Any],
    index: Dict[str, Any],
    changes: Dict[str, Any],
) -> str:
    name = project.get("name", "Project")
    stack = project.get("detected_stack") or []
    if not stack and project.get("type"):
        stack = [project.get("type")]
    stack_str = "/".join(stack) if stack else "multi-file"
    fc = index.get("file_count", 0)
    modified = changes.get("modified_files") or []
    if modified:
        mod_list = ", ".join(modified[:4])
        change_part = f"Recent changes include {mod_list}."
    elif changes.get("new_count"):
        change_part = f"{changes['new_count']} new files since last index."
    else:
        change_part = "No file changes since last index."
    return f"{name} appears to be a {stack_str} project with {fc} source files. {change_part}"


def _next_questions(project: Dict[str, Any], changes: Dict[str, Any]) -> List[str]:
    qs = []
    if not project.get("last_indexed_at"):
        qs.append("Index this project to refresh file metadata?")
    if changes.get("modified_count") or changes.get("new_count"):
        qs.append("Review recently changed files?")
    if project.get("agents_allowed", True):
        qs.append(f"Run Developer Review on {project.get('name', 'this project')}?")
    return qs[:4]


def build_briefing(project: Dict[str, Any], index: Dict[str, Any], changes: Dict[str, Any]) -> str:
    return generate_static_summary(project, index, changes)


def build_project_summary(
    project: Dict[str, Any],
    index: Dict[str, Any],
    changes: Dict[str, Any],
) -> Dict[str, Any]:
    summary_text = generate_static_summary(project, index, changes)
    important = [f.get("path") for f in (index.get("important_files") or []) if f.get("path")]
    recent_changes = (changes.get("modified_files") or [])[:10]
    return {
        "project_id": project.get("id"),
        "name": project.get("name"),
        "path": project.get("path"),
        "detected_stack": project.get("detected_stack") or [],
        "file_count": index.get("file_count", 0),
        "important_files": important,
        "recent_changes": recent_changes,
        "summary": summary_text,
        "next_questions": _next_questions(project, changes),
        "last_indexed_at": index.get("indexed_at"),
        "ignored_count": index.get("ignored_count", 0),
    }


def _project_indexable(project: Dict[str, Any], data_dir: Path) -> Tuple[bool, Optional[str]]:
    """Return whether a project can be indexed and why not."""
    if not project.get("agents_allowed", True):
        return False, "Agent indexing disabled"
    path_str = (project.get("path") or "").strip()
    if not path_str:
        return False, "No path set"
    _, err = _normalize_project_path(path_str, data_dir)
    if err:
        return False, err
    return True, None


def index_projects_batch(
    data_dir: Path,
    projects: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Index multiple projects read-only; skip invalid or blocked paths."""
    updated = list(projects)
    by_id = {p.get("id"): i for i, p in enumerate(updated) if p.get("id")}
    indexed_count = 0
    skipped_count = 0
    errors: List[Dict[str, str]] = []

    for project in projects:
        pid = project.get("id") or ""
        name = project.get("name") or pid or "project"
        ok, reason = _project_indexable(project, data_dir)
        if not ok:
            skipped_count += 1
            errors.append({"project_id": pid, "name": name, "message": reason or "Skipped"})
            continue
        result = index_project(data_dir, dict(project))
        if not result.get("ok"):
            skipped_count += 1
            errors.append({
                "project_id": pid,
                "name": name,
                "message": result.get("message") or "Index failed",
            })
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
    }


def index_all_projects(data_dir: Path) -> Dict[str, Any]:
    """Index every registered project with a valid on-disk path."""
    from src.cerberus_config import load_projects, save_projects

    projects = load_projects()
    batch = index_projects_batch(data_dir, projects)
    save_projects(batch["projects"])
    n = batch["indexed_count"]
    skip = batch["skipped_count"]
    return {
        "ok": True,
        "message": f"Indexed {n} project(s)" + (f", skipped {skip}" if skip else "") + ".",
        "projects": batch["projects"],
        "indexed_count": batch["indexed_count"],
        "skipped_count": batch["skipped_count"],
        "errors": batch["errors"],
    }


def index_project(data_dir: Path, project: Dict[str, Any]) -> Dict[str, Any]:
    """Index a project directory read-only. Updates project + summary."""
    project_id = project.get("id") or ""
    path_str = project.get("path") or ""
    root, err = _normalize_project_path(path_str, data_dir)
    if err:
        return {"ok": False, "message": err}

    current = scan_directory(root, data_dir)
    previous = load_index(data_dir, project_id)
    changes = diff_indexes(previous, current)

    payload = {
        "project_id": project_id,
        "project_name": project.get("name"),
        "root": current["root"],
        "indexed_at": current["indexed_at"],
        "file_count": current["file_count"],
        "truncated": current["truncated"],
        "extension_counts": current["extension_counts"],
        "extension_summary": current["extension_summary"],
        "file_tree": current["file_tree"],
        "important_files": current["important_files"],
        "recent_files": current["recent_files"],
        "ignored_count": current["ignored_count"],
        "files": current["files"],
        "recent_changes": changes,
        "changed_since_last_scan": changes,
    }
    save_index(data_dir, project_id, payload)

    project["last_indexed_at"] = current["indexed_at"]
    project["file_count"] = current["file_count"]
    project["recent_changes"] = changes
    project["indexed"] = True

    summary = build_project_summary(project, current, changes)
    save_summary(data_dir, project_id, summary)

    briefing = build_briefing(project, current, changes)
    return {
        "ok": True,
        "index": payload,
        "summary": summary,
        "briefing": briefing,
        "project": project,
    }


def load_all_summaries(data_dir: Path) -> List[Dict[str, Any]]:
    out = []
    sdir = _summaries_dir(data_dir)
    if not sdir.exists():
        return out
    for path in sdir.glob("*.json"):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                out.append(data)
        except (json.JSONDecodeError, OSError):
            continue
    return out


def format_summaries_for_agents(summaries: List[Dict[str, Any]]) -> str:
    if not summaries:
        return "No project summaries indexed yet."
    lines = []
    for s in summaries:
        lines.append(f"### {s.get('name', 'Project')}")
        lines.append(f"- Stack: {', '.join(s.get('detected_stack') or []) or 'unknown'}")
        lines.append(f"- Files: {s.get('file_count', 0)}")
        if s.get("important_files"):
            lines.append(f"- Important files: {', '.join(s['important_files'][:12])}")
        if s.get("recent_changes"):
            lines.append(f"- Recent changes: {', '.join(s['recent_changes'][:8])}")
        if s.get("index_version") == 2 or s.get("potential_score"):
            lines.append(f"- Stage: {s.get('current_stage', 'unknown')} | Score: {s.get('potential_score', '—')}")
        if s.get("what_it_appears_to_do"):
            lines.append(f"- Purpose: {s['what_it_appears_to_do']}")
        if s.get("recommended_next_steps"):
            steps = s["recommended_next_steps"]
            if isinstance(steps, list) and steps:
                lines.append(f"- Next: {steps[0]}")
        if s.get("monetisation_options"):
            opts = s["monetisation_options"]
            if isinstance(opts, list) and opts:
                lines.append(f"- Monetisation: {opts[0]}")
        lines.append(f"- Summary: {s.get('summary', '')}")
        lines.append("")
    return "\n".join(lines).strip()
