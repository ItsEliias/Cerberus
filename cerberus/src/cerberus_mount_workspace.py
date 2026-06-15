"""Atlas Docker-mounted workspace — /workspace bind mount, bootstrap, agent report copies."""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_WIN_PATH_RE = re.compile(r"^[A-Za-z]:[\\/]")
_CONTAINER_PATH_RE = re.compile(r"^/workspace(?:/|$)")

BOOTSTRAP_DIRS: Tuple[str, ...] = (
    "Offices",
    "Global/Inbox",
    "Global/Archive",
    "Global/Reports",
    "Global/Knowledge",
    "Global/Memory",
    "System",
)

AGENT_REPORT_FOLDERS: Dict[Tuple[str, str], str] = {
    ("research", "business_ideas"): "Agents/Research/Business Ideas",
    ("research", "research_brief"): "Agents/Research/Competitors",
    ("developer", "developer_review"): "Agents/Developer/Reports",
    ("developer", "developer_project_review"): "Agents/Developer/Cursor Prompts",
    ("developer", "cursor_prompt"): "Agents/Developer/Cursor Prompts",
    ("architect", "architecture_plan"): "Agents/Architect/Specs",
    ("marketing", "marketing_ideas"): "Agents/Marketing/Launch Plans",
    ("marketing", "launch_strategy"): "Agents/Marketing/Launch Plans",
    ("marketing", "content_plan"): "Agents/Marketing/Content",
    ("business", "business_strategy"): "Agents/Business/Models",
    ("business", "business_analysis"): "Agents/Business/Models",
    ("business", "monetisation_plan"): "Agents/Business/Pricing",
}

NOT_MOUNTED_WARNING = (
    "Atlas workspace not found. Use Settings → Workspace or Projects → Create Workspace Folders "
    "to initialize the managed workspace."
)


def container_root() -> str:
    return (os.environ.get("CERBERUS_WORKSPACE_CONTAINER") or "/workspace").rstrip("/") or "/workspace"


def host_root_hint() -> str:
    env = os.environ.get("CERBERUS_WORKSPACE_HOST")
    if env:
        return env
    try:
        from src.cerberus_ce_workspace import host_display_path
        return host_display_path()
    except Exception:
        return str(Path(__file__).resolve().parent.parent / "AtlasWorkspace")


def projects_folder() -> str:
    try:
        from src.cerberus_ce_workspace import projects_scan_roots, resolve_workspace_root
        roots = projects_scan_roots()
        if roots:
            return str(roots[0]).replace("\\", "/")
        return str(resolve_workspace_root() / "Offices").replace("\\", "/")
    except Exception:
        return f"{container_root()}/Offices"


def is_mounted() -> bool:
    try:
        from src.cerberus_ce_workspace import workspace_exists, resolve_workspace_root
        if workspace_exists(resolve_workspace_root()):
            return True
    except Exception:
        pass
    root = Path(container_root())
    try:
        return root.is_dir()
    except OSError:
        return False


def is_docker_mount_mode(ws: Optional[Dict[str, Any]] = None) -> bool:
    if ws:
        mode = (ws.get("workspace_mode") or "managed").lower()
        return mode in ("docker_mount", "external")
    return bool(os.environ.get("CERBERUS_WORKSPACE_CONTAINER"))


def is_legacy_windows_path(path_str: str) -> bool:
    return bool(_WIN_PATH_RE.match((path_str or "").strip()))


def is_under_workspace_mount(path_str: str) -> bool:
    """True when path is inside the configured workspace mount (host or container)."""
    raw = (path_str or "").strip()
    if not raw:
        return False
    root = Path(container_root())
    try:
        resolved = Path(raw).expanduser().resolve()
        root_res = root.expanduser().resolve()
        return resolved == root_res or root_res in resolved.parents
    except (OSError, ValueError):
        return False


def _norm_posix(path_str: str) -> str:
    return (path_str or "").replace("\\", "/")


def is_under_container_workspace(path_str: str, ws: Optional[Dict[str, Any]] = None) -> bool:
    if is_under_workspace_mount(path_str):
        return True
    root = (ws or {}).get("workspace_container_root") or container_root()
    root = root.rstrip("/").replace("\\", "/")
    norm = _norm_posix(path_str)
    return norm == root or norm.startswith(root + "/") or norm.startswith("/workspace/")


def to_display_path(container_path: str, ws: Optional[Dict[str, Any]] = None) -> str:
    """Map container path to Windows host hint for UI only."""
    if not container_path:
        return ""
    host = (ws or {}).get("workspace_host_root_hint") or host_root_hint()
    root = (ws or {}).get("workspace_container_root") or container_root()
    norm = container_path.replace("\\", "/")
    root_norm = root.replace("\\", "/").rstrip("/")
    # Map /workspace/... to host hint even when the live mount is elsewhere (tests)
    if norm.startswith("/workspace"):
        norm = norm.replace("/workspace", root_norm, 1)
    if norm == root_norm:
        return host
    if norm.startswith(root_norm + "/"):
        rel = norm[len(root_norm) + 1 :]
        sep = "\\"
        return host.rstrip("\\/") + sep + rel.replace("/", sep)
    return container_path


def path_status(path_str: str, ws: Optional[Dict[str, Any]] = None) -> str:
    """Return valid | invalid | unmounted | empty."""
    raw = (path_str or "").strip()
    if not raw:
        return "empty"
    if is_docker_mount_mode(ws) and is_legacy_windows_path(raw) and not is_under_workspace_mount(raw):
        return "invalid"
    if is_docker_mount_mode(ws) and not is_under_container_workspace(raw, ws):
        return "invalid"
    try:
        resolved = Path(raw).expanduser()
        if resolved.is_dir():
            return "valid"
    except OSError:
        pass
    return "unmounted"


def enrich_project(project: Dict[str, Any], ws: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Add display_path, path_status, can_relink for UI."""
    out = dict(project)
    path = (out.get("path") or "").strip()
    status = path_status(path, ws)
    out["path_status"] = status
    if status == "invalid":
        out["display_path"] = "unmounted / invalid path"
    elif path:
        out["display_path"] = to_display_path(path, ws)
    else:
        out["display_path"] = ""
    out["can_relink"] = status in ("invalid", "unmounted", "empty")
    return out


def get_workspace_status(ws: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    try:
        from src.cerberus_ce_workspace import get_ce_workspace_status
        mode = (ws or {}).get("workspace_mode") or "managed"
        if mode == "managed" or not (ws or {}).get("workspace_mode"):
            return get_ce_workspace_status(ws)
    except Exception:
        pass
    mounted = is_mounted()
    root = (ws or {}).get("workspace_container_root") or container_root()
    pf = (ws or {}).get("workspace_root") or projects_folder()
    return {
        "mounted": mounted,
        "workspace_mode": (ws or {}).get("workspace_mode") or "docker_mount",
        "container_root": root,
        "host_hint": (ws or {}).get("workspace_host_root_hint") or host_root_hint(),
        "projects_folder": pf,
        "browse_start": root if mounted else None,
        "warning": None if mounted else NOT_MOUNTED_WARNING,
    }


def bootstrap_workspace_folders() -> Dict[str, Any]:
    """Create Atlas workspace folder tree under the container mount."""
    root = Path(container_root())
    if not root.is_dir():
        return {"ok": False, "message": NOT_MOUNTED_WARNING, "created": []}

    created: List[str] = []
    for rel in BOOTSTRAP_DIRS:
        target = root / rel.replace("/", os.sep)
        try:
            if not target.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                created.append(str(target).replace("\\", "/"))
        except OSError as exc:
            logger.warning("[cerberus-workspace] could not create %s: %s", target, exc)

    msg = f"Workspace folders ready ({len(created)} created)." if created else "Workspace folders already exist."
    return {"ok": True, "message": msg, "created": created, "mounted": True}


def startup_bootstrap() -> None:
    """Called on app startup — create CE workspace structure."""
    try:
        from src.cerberus_ce_workspace import startup_ce_bootstrap
        startup_ce_bootstrap()
        return
    except Exception as exc:
        logger.warning("[cerberus-workspace] CE bootstrap failed, using legacy: %s", exc)
    if not is_mounted():
        logger.warning("[cerberus-workspace] %s", NOT_MOUNTED_WARNING)
        return
    result = bootstrap_workspace_folders()
    if result.get("created"):
        logger.info("[cerberus-workspace] created %d folder(s)", len(result["created"]))


def validate_project_path(path_str: str, ws: Dict[str, Any]) -> Tuple[Optional[Path], Optional[str]]:
    """Resolve project path for indexing."""
    raw = (path_str or "").strip()
    if not raw:
        return None, "Project path is required"
    mode = (ws.get("workspace_mode") or "managed").lower()
    if mode == "managed":
        try:
            from src.cerberus_ce_workspace import resolve_workspace_root
            root = resolve_workspace_root()
            resolved = Path(raw).expanduser().resolve()
            root_res = root.resolve()
            if resolved == root_res or root_res in resolved.parents:
                if resolved.is_dir():
                    return resolved, None
                return None, f"Path is not a directory: {resolved}"
        except Exception as exc:
            return None, f"Invalid path: {exc}"
    if is_docker_mount_mode(ws) and is_legacy_windows_path(raw) and not is_under_workspace_mount(raw):
        return None, (
            "Windows paths outside Atlas Workspace are not valid inside Docker. "
            f"Use {projects_folder()}/YourProject and put folders in "
            f"{host_root_hint()}\\Projects on the host."
        )
    if is_docker_mount_mode(ws) and not is_under_container_workspace(raw, ws):
        return None, f"Project path must be under {ws.get('workspace_container_root') or container_root()}"
    try:
        resolved = Path(raw).expanduser().resolve()
    except (OSError, ValueError) as exc:
        return None, f"Invalid path: {exc}"
    if not resolved.exists():
        return None, f"Path does not exist: {resolved} (is the workspace mount active?)"
    if not resolved.is_dir():
        return None, f"Path is not a directory: {resolved}"
    return resolved, None


def _safe_report_filename(title: str, created_at: str) -> str:
    try:
        dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError:
        dt = datetime.now(timezone.utc)
    stamp = dt.strftime("%Y-%m-%d_%H-%M")
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:80] or "report"
    return f"{stamp}_{slug}.md"


def report_folder_for(agent_id: str, action: str) -> Optional[str]:
    return AGENT_REPORT_FOLDERS.get((agent_id, action))


def save_agent_report_markdown(
    agent_id: str,
    action: str,
    title: str,
    content: str,
    *,
    created_at: Optional[str] = None,
) -> Optional[str]:
    """Write markdown copy to /workspace/Agents/... — never into project folders."""
    if not is_mounted():
        return None
    rel = report_folder_for(agent_id, action)
    if not rel:
        return None
    root = Path(container_root())
    folder = root / rel.replace("/", os.sep)
    try:
        folder.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.warning("[cerberus-workspace] cannot create report dir %s: %s", folder, exc)
        return None

    ts = created_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    fname = _safe_report_filename(title, ts)
    path = folder / fname
    body = f"# {title}\n\n_Generated {ts}_\n\n{content}\n"
    try:
        tmp = path.with_suffix(".md.tmp")
        tmp.write_text(body, encoding="utf-8")
        os.replace(tmp, path)
        saved = str(path).replace("\\", "/")
        logger.info("[cerberus-workspace] saved agent report %s", saved)
        return saved
    except OSError as exc:
        logger.warning("[cerberus-workspace] could not write report %s: %s", path, exc)
        return None
