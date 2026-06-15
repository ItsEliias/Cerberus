"""Atlas Community Edition — managed Office-first workspace architecture."""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from core.constants import BASE_DIR

logger = logging.getLogger(__name__)

CE_VERSION = "community"
SETTINGS_REL = "System/settings.json"
LEGACY_HOST_PATHS = (
    r"C:\AtlasWorkspace",
    r"C:\AtlasWorkspace\Projects",
)

GLOBAL_DIRS = ("Inbox", "Archive", "Reports", "Knowledge", "Memory")
OFFICE_DIRS = ("Inbox", "Archive", "Knowledge", "Reports", "Memory", "Departments", "Projects")
DEPT_DIRS = ("Reports", "Knowledge", "Agents")
AGENT_DIRS = ("memory", "prompts", "reports", "tasks", "inbox", "outbox", "conversations")
PROJECT_DIRS = (
    "Files", "Notes", "Knowledge", "Reports", "Tasks", "Memory", "Assets", "Archive", "Agents",
)

_DEFAULT_SETTINGS: Dict[str, Any] = {
    "workspacePath": "./AtlasWorkspace",
    "workspaceMode": "managed",
    "defaultProjectStorage": "managed",
    "setupComplete": False,
    "createdAt": None,
    "updatedAt": None,
    "version": CE_VERSION,
    "aiProvider": "local",
    "aiModel": "",
    "userName": "",
    "buildingType": "",
    "firstOfficeId": "",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _uid() -> str:
    return uuid.uuid4().hex[:12]


def _write_json(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


def _read_json(path: Path) -> Dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("[ce-workspace] could not read %s: %s", path, exc)
        return {}


def app_root() -> Path:
    return Path(BASE_DIR).resolve()


def default_workspace_path() -> Path:
    env = (os.environ.get("CERBERUS_WORKSPACE_PATH") or "").strip()
    if env:
        p = Path(env).expanduser()
        if not p.is_absolute():
            p = (app_root() / p).resolve()
        return p
    container = (os.environ.get("CERBERUS_WORKSPACE_CONTAINER") or "").strip()
    if container and Path(container).is_dir():
        return Path(container).resolve()
    return (app_root() / "AtlasWorkspace").resolve()


def resolve_workspace_root(custom: Optional[str] = None) -> Path:
    if custom:
        p = Path(custom).expanduser()
        if not p.is_absolute():
            p = (app_root() / p).resolve()
        return p
    settings = load_system_settings()
    rel = (settings.get("workspacePath") or "./AtlasWorkspace").strip()
    p = Path(rel).expanduser()
    if not p.is_absolute():
        p = (app_root() / rel).resolve()
    return p


def system_settings_path(root: Optional[Path] = None) -> Path:
    root = root or resolve_workspace_root()
    return root / SETTINGS_REL.replace("/", os.sep)


def load_system_settings(root: Optional[Path] = None) -> Dict[str, Any]:
    root = root or resolve_workspace_root()
    data = _read_json(system_settings_path(root))
    out = dict(_DEFAULT_SETTINGS)
    out.update(data)
    if not out.get("createdAt"):
        out["createdAt"] = _now_iso()
    return out


def save_system_settings(patch: Dict[str, Any], root: Optional[Path] = None) -> Dict[str, Any]:
    root = root or resolve_workspace_root()
    current = load_system_settings(root)
    current.update(patch)
    current["updatedAt"] = _now_iso()
    if not current.get("createdAt"):
        current["createdAt"] = current["updatedAt"]
    _write_json(system_settings_path(root), current)
    return current


def is_cerberus_dev_mode() -> bool:
    return (os.environ.get("CERBERUS_DEV_MODE") or "").strip().lower() in ("1", "true", "yes", "on")


def workspace_display_path(root: Optional[Path] = None) -> str:
    root = root or resolve_workspace_root()
    settings = load_system_settings(root)
    configured = (settings.get("workspacePath") or "").strip()
    if configured:
        return configured
    try:
        rel = root.relative_to(app_root())
        return "./" + str(rel).replace("\\", "/")
    except ValueError:
        return str(root).replace("\\", "/")


def sanitize_name(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*]+', "", (name or "").strip())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or "Untitled"


def workspace_exists(root: Optional[Path] = None) -> bool:
    root = root or resolve_workspace_root()
    try:
        return root.is_dir()
    except OSError:
        return False


def host_display_path(root: Optional[Path] = None) -> str:
    root = root or resolve_workspace_root()
    return str(root)


def container_display_path(root: Optional[Path] = None) -> str:
    env = (os.environ.get("CERBERUS_WORKSPACE_CONTAINER") or "").strip()
    if env:
        return env.rstrip("/") or "/workspace"
    root = root or resolve_workspace_root()
    return str(root).replace("\\", "/")


def projects_scan_roots(root: Optional[Path] = None) -> List[Path]:
    """Folders to scan for managed project directories."""
    root = root or resolve_workspace_root()
    roots: List[Path] = []
    offices = root / "Offices"
    if offices.is_dir():
        for office_dir in sorted(offices.iterdir()):
            if not office_dir.is_dir() or office_dir.name.startswith("."):
                continue
            proj_root = office_dir / "Projects"
            if proj_root.is_dir():
                roots.append(proj_root)
    legacy = root / "Projects"
    if legacy.is_dir():
        roots.append(legacy)
    return roots


def ensure_workspace_bootstrap(root: Optional[Path] = None, force: bool = False) -> Dict[str, Any]:
    root = root or resolve_workspace_root()
    created: List[str] = []

    def _mkdir(rel: str) -> None:
        target = root / rel.replace("/", os.sep)
        if target.is_dir():
            return
        try:
            target.mkdir(parents=True, exist_ok=True)
            created.append(str(target.relative_to(root)).replace("\\", "/"))
        except OSError as exc:
            logger.warning("[ce-workspace] mkdir %s: %s", target, exc)

    if not root.is_dir():
        root.mkdir(parents=True, exist_ok=True)
        created.append(".")

    for d in GLOBAL_DIRS:
        _mkdir(f"Global/{d}")
    _mkdir("Offices")
    _mkdir("System")

    system_files = {
        "System/settings.json": {
            **_DEFAULT_SETTINGS,
            "workspacePath": (
                str(root.relative_to(app_root())).replace("\\", "/")
                if str(root).startswith(str(app_root()))
                else str(root)
            ),
            "workspaceMode": load_system_settings(root).get("workspaceMode", "managed"),
            "createdAt": _now_iso(),
            "version": CE_VERSION,
        },
        "System/app-launcher.json": {"apps": []},
        "System/index-state.json": {"projects": {}, "offices": {}, "updatedAt": _now_iso()},
        "System/graph-state.json": {"nodes": {}, "updatedAt": _now_iso()},
        "System/audit-log.json": {"entries": []},
    }
    for rel, payload in system_files.items():
        path = root / rel.replace("/", os.sep)
        if force or not path.is_file():
            _write_json(path, payload)
            if rel not in created:
                created.append(rel)

    msg = (
        f"Community workspace ready ({len(created)} item(s) created)."
        if created
        else "Community workspace already exists."
    )
    return {"ok": True, "message": msg, "created": created, "root": str(root), "mounted": True}


def startup_ce_bootstrap() -> None:
    root = resolve_workspace_root()
    if not workspace_exists(root):
        result = ensure_workspace_bootstrap(root)
        logger.info("[ce-workspace] %s", result.get("message"))
        return
    settings_path = system_settings_path(root)
    if not settings_path.is_file():
        ensure_workspace_bootstrap(root)
    else:
        ensure_workspace_bootstrap(root)


def get_ce_workspace_status(ws: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    root = resolve_workspace_root()
    settings = load_system_settings(root)
    mode = (settings.get("workspaceMode") or (ws or {}).get("workspace_mode") or "managed")
    mounted = workspace_exists(root)
    scan_roots = [str(p).replace("\\", "/") for p in projects_scan_roots(root)]
    return {
        "ok": mounted,
        "mounted": mounted,
        "workspace_mode": mode,
        "workspace_root": str(root).replace("\\", "/"),
        "workspace_host_root_hint": host_display_path(root),
        "workspace_container_root": container_display_path(root),
        "projects_folders": scan_roots,
        "projects_folder": scan_roots[0] if scan_roots else str(root / "Offices").replace("\\", "/"),
        "browse_start": str(root).replace("\\", "/") if mounted else None,
        "settings": settings,
        "warning": None if mounted else "Atlas storage not found — open Settings → Storage and create missing folders.",
    }


def office_dir(root: Path, office_name: str) -> Path:
    return root / "Offices" / sanitize_name(office_name)


def create_office(name: str, description: str = "", root: Optional[Path] = None) -> Dict[str, Any]:
    root = root or resolve_workspace_root()
    ensure_workspace_bootstrap(root)
    folder_name = sanitize_name(name)
    odir = office_dir(root, folder_name)
    if odir.exists():
        raise ValueError(f"Office folder already exists: {folder_name}")
    odir.mkdir(parents=True)
    for d in OFFICE_DIRS:
        (odir / d).mkdir(exist_ok=True)
    office = {
        "id": _uid(),
        "name": name.strip() or folder_name,
        "description": description or "",
        "folderName": folder_name,
        "projectIds": [],
        "departments": [],
        "createdAt": _now_iso(),
        "updatedAt": _now_iso(),
    }
    _write_json(odir / "office.json", office)
    return office


def load_offices(root: Optional[Path] = None) -> List[Dict[str, Any]]:
    root = root or resolve_workspace_root()
    offices_dir = root / "Offices"
    if not offices_dir.is_dir():
        return []
    out: List[Dict[str, Any]] = []
    for odir in sorted(offices_dir.iterdir()):
        if not odir.is_dir():
            continue
        meta = _read_json(odir / "office.json")
        if not meta:
            meta = {
                "id": _uid(),
                "name": odir.name,
                "folderName": odir.name,
                "description": "",
                "departments": [],
                "projectIds": [],
            }
        meta.setdefault("folderName", odir.name)
        meta["workspacePath"] = str(odir.relative_to(root)).replace("\\", "/")
        meta["departments"] = load_departments(odir, meta.get("id", ""))
        out.append(meta)
    return out


def save_office(office: Dict[str, Any], root: Optional[Path] = None) -> Dict[str, Any]:
    root = root or resolve_workspace_root()
    folder = office.get("folderName") or sanitize_name(office.get("name", "Office"))
    odir = root / "Offices" / folder
    if not odir.is_dir():
        raise ValueError("Office folder not found")
    office["updatedAt"] = _now_iso()
    _write_json(odir / "office.json", office)
    return office


def delete_office(office_id: str, archive: bool = True, root: Optional[Path] = None) -> Dict[str, Any]:
    root = root or resolve_workspace_root()
    for odir in (root / "Offices").iterdir() if (root / "Offices").is_dir() else []:
        meta = _read_json(odir / "office.json")
        if meta.get("id") != office_id:
            continue
        if archive:
            dest = root / "Global" / "Archive" / f"office-{odir.name}-{_now_iso()[:10]}"
            dest.mkdir(parents=True, exist_ok=True)
            shutil.move(str(odir), str(dest / odir.name))
            return {"ok": True, "archived": str(dest)}
        shutil.rmtree(odir)
        return {"ok": True, "deleted": True}
    return {"ok": False, "message": "Office not found"}


def load_departments(office_dir: Path, office_id: str) -> List[Dict[str, Any]]:
    dept_root = office_dir / "Departments"
    if not dept_root.is_dir():
        return []
    depts: List[Dict[str, Any]] = []
    for ddir in sorted(dept_root.iterdir()):
        if not ddir.is_dir():
            continue
        meta = _read_json(ddir / "department.json")
        if not meta:
            meta = {"id": _uid(), "name": ddir.name, "officeId": office_id, "agents": []}
        meta.setdefault("folderName", ddir.name)
        meta["workspacePath"] = str(ddir.relative_to(office_dir.parent.parent)).replace("\\", "/")
        meta["agents"] = load_agents(ddir, meta.get("id", ""), office_id)
        depts.append(meta)
    return depts


def create_department(office_id: str, name: str, description: str = "", root: Optional[Path] = None) -> Dict[str, Any]:
    root = root or resolve_workspace_root()
    odir = _find_office_dir(office_id, root)
    if not odir:
        raise ValueError("Office not found")
    folder_name = sanitize_name(name)
    ddir = odir / "Departments" / folder_name
    if ddir.exists():
        raise ValueError("Department already exists")
    ddir.mkdir(parents=True)
    for d in DEPT_DIRS:
        (ddir / d).mkdir(exist_ok=True)
    dept = {
        "id": _uid(),
        "name": name.strip() or folder_name,
        "description": description or "",
        "folderName": folder_name,
        "officeId": office_id,
        "responsibilities": "",
        "projectId": "",
        "agents": [],
        "createdAt": _now_iso(),
        "updatedAt": _now_iso(),
    }
    _write_json(ddir / "department.json", dept)
    office = _read_json(odir / "office.json")
    office.setdefault("departments", [])
    if not any(d.get("id") == dept["id"] for d in office.get("departments", [])):
        office["departments"].append({"id": dept["id"], "name": dept["name"]})
    _write_json(odir / "office.json", office)
    return dept


def delete_department(office_id: str, department_id: str, root: Optional[Path] = None) -> Dict[str, Any]:
    root = root or resolve_workspace_root()
    odir = _find_office_dir(office_id, root)
    if not odir:
        return {"ok": False, "message": "Office not found"}
    dept_root = odir / "Departments"
    if not dept_root.is_dir():
        return {"ok": False, "message": "Department not found"}
    for ddir in dept_root.iterdir():
        if not ddir.is_dir():
            continue
        meta = _read_json(ddir / "department.json")
        if meta.get("id") != department_id:
            continue
        shutil.rmtree(ddir)
        office = _read_json(odir / "office.json") or {}
        office["departments"] = [
            d for d in office.get("departments", []) if d.get("id") != department_id
        ]
        office["updatedAt"] = _now_iso()
        _write_json(odir / "office.json", office)
        return {"ok": True, "deleted": True}
    return {"ok": False, "message": "Department not found"}


def _find_office_dir(office_id: str, root: Path) -> Optional[Path]:
    offices = root / "Offices"
    if not offices.is_dir():
        return None
    for odir in offices.iterdir():
        if not odir.is_dir():
            continue
        meta = _read_json(odir / "office.json")
        if meta.get("id") == office_id:
            return odir
    return None


def load_agents(dept_dir: Path, dept_id: str, office_id: str) -> List[Dict[str, Any]]:
    agents_root = dept_dir / "Agents"
    if not agents_root.is_dir():
        return []
    agents: List[Dict[str, Any]] = []
    for adir in sorted(agents_root.iterdir()):
        if not adir.is_dir():
            continue
        meta = _read_json(adir / "agent.json")
        if not meta:
            continue
        meta.setdefault("folderName", adir.name)
        meta["workspacePath"] = str(adir).replace("\\", "/")
        agents.append(meta)
    return agents


def create_agent(
    office_id: str,
    dept_id: str,
    name: str,
    patch: Optional[Dict[str, Any]] = None,
    root: Optional[Path] = None,
) -> Dict[str, Any]:
    root = root or resolve_workspace_root()
    odir = _find_office_dir(office_id, root)
    if not odir:
        raise ValueError("Office not found")
    dept_dir = None
    for ddir in (odir / "Departments").iterdir() if (odir / "Departments").is_dir() else []:
        meta = _read_json(ddir / "department.json")
        if meta.get("id") == dept_id:
            dept_dir = ddir
            break
    if not dept_dir:
        raise ValueError("Department not found")
    folder_name = sanitize_name(name)
    adir = dept_dir / "Agents" / folder_name
    if adir.exists():
        raise ValueError("Agent folder already exists")
    adir.mkdir(parents=True)
    for d in AGENT_DIRS:
        (adir / d).mkdir(exist_ok=True)
    agent = {
        "id": _uid(),
        "name": name.strip() or folder_name,
        "avatar": None,
        "jobTitle": "",
        "jobDescription": "",
        "model": None,
        "runtimeMode": "manual",
        "permissions": {
            "readProjectFiles": True,
            "writeNotes": False,
            "createTasks": True,
            "generateReports": True,
            "sendEmails": False,
            "publishContent": False,
            "accessApis": False,
        },
        "officeId": office_id,
        "departmentId": dept_id,
        "assignedProjectIds": [],
        "createdAt": _now_iso(),
        "updatedAt": _now_iso(),
    }
    if patch:
        agent.update(patch)
    _write_json(adir / "agent.json", agent)
    return agent


def create_project(
    name: str,
    office_id: str,
    *,
    description: str = "",
    department_id: Optional[str] = None,
    storage_mode: str = "managed",
    linked_path: Optional[str] = None,
    root: Optional[Path] = None,
) -> Dict[str, Any]:
    root = root or resolve_workspace_root()
    odir = _find_office_dir(office_id, root)
    if not odir:
        raise ValueError("Office not found")
    office_meta = _read_json(odir / "office.json")
    folder_name = sanitize_name(name)
    if storage_mode == "linked" and linked_path:
        proj_path = Path(linked_path).expanduser().resolve()
        if not proj_path.is_dir():
            raise ValueError("Linked folder does not exist")
        rel_workspace = None
        project = {
            "id": _uid(),
            "name": name.strip() or folder_name,
            "description": description,
            "officeId": office_id,
            "departmentId": department_id,
            "storageMode": "linked",
            "workspacePath": None,
            "linkedPath": str(proj_path).replace("\\", "/"),
            "indexing": {
                "enabled": True,
                "lastIndexedAt": None,
                "deepIndexedAt": None,
                "fileCount": 0,
                "status": "not_indexed",
            },
            "createdAt": _now_iso(),
            "updatedAt": _now_iso(),
        }
        return project

    pdir = odir / "Projects" / folder_name
    if pdir.exists():
        raise ValueError("Project folder already exists")
    pdir.mkdir(parents=True)
    for d in PROJECT_DIRS:
        (pdir / d).mkdir(exist_ok=True)
    rel = str(pdir.relative_to(root)).replace("\\", "/")
    project = {
        "id": _uid(),
        "name": name.strip() or folder_name,
        "description": description,
        "officeId": office_id,
        "departmentId": department_id,
        "officeName": office_meta.get("name"),
        "storageMode": "managed",
        "workspacePath": rel,
        "linkedPath": None,
        "path": str(pdir).replace("\\", "/"),
        "indexing": {
            "enabled": True,
            "lastIndexedAt": None,
            "deepIndexedAt": None,
            "fileCount": 0,
            "status": "not_indexed",
        },
        "createdAt": _now_iso(),
        "updatedAt": _now_iso(),
    }
    _write_json(pdir / "project.json", project)
    office_meta.setdefault("projectIds", [])
    if project["id"] not in office_meta["projectIds"]:
        office_meta["projectIds"].append(project["id"])
    _write_json(odir / "office.json", office_meta)
    return project


def discover_ce_projects(ws: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Discover managed projects under Offices/*/Projects/."""
    from src.cerberus_workspace import _candidate_from_folder, detect_stack

    root = resolve_workspace_root()
    discovered: List[Dict[str, Any]] = []
    for scan_root in projects_scan_roots(root):
        try:
            children = sorted(scan_root.iterdir(), key=lambda p: p.name.lower())
        except OSError:
            continue
        office_name = scan_root.parent.name if scan_root.parent.name != "Offices" else ""
        for child in children:
            if not child.is_dir() or child.name.startswith("."):
                continue
            meta = _read_json(child / "project.json")
            cand = _candidate_from_folder(child, ws)
            if meta:
                cand["id"] = meta.get("id") or cand["id"]
                cand["name"] = meta.get("name") or cand["name"]
                cand["description"] = meta.get("description") or ""
                cand["officeId"] = meta.get("officeId")
                cand["departmentId"] = meta.get("departmentId")
                cand["storageMode"] = meta.get("storageMode") or "managed"
                cand["workspacePath"] = meta.get("workspacePath")
                cand["linkedPath"] = meta.get("linkedPath")
                cand["officeName"] = meta.get("officeName") or office_name
                idx = meta.get("indexing") or {}
                cand["last_indexed_at"] = idx.get("lastIndexedAt")
                cand["file_count"] = idx.get("fileCount") or 0
                cand["index_status"] = idx.get("status") or "not_indexed"
            else:
                cand["officeName"] = office_name
                cand["storageMode"] = "managed"
            cand["source"] = "workspace_scan"
            discovered.append(cand)
    return discovered


def get_ce_setup_status(root: Optional[Path] = None) -> Dict[str, Any]:
    root = root or resolve_workspace_root()
    settings_path = system_settings_path(root)
    settings_exists = settings_path.is_file()
    ws_exists = workspace_exists(root)
    settings = load_system_settings(root) if settings_exists else dict(_DEFAULT_SETTINGS)
    if not settings_exists:
        settings["setupComplete"] = False
    offices = load_offices(root) if ws_exists else []
    office_count = len(offices)
    setup_complete = bool(settings.get("setupComplete"))
    should_show = (not setup_complete) or (office_count == 0)
    ws_path = workspace_display_path(root)
    return {
        "ok": True,
        "setupComplete": setup_complete,
        "workspaceExists": ws_exists,
        "settingsExists": settings_exists,
        "officeCount": office_count,
        "shouldShowWizard": should_show,
        "workspacePath": ws_path,
        # Legacy fields for older clients
        "needsSetup": should_show,
        "storagePath": ws_path,
    }


def reset_ce_setup(root: Optional[Path] = None) -> Dict[str, Any]:
    """Dev-only: mark setup incomplete without deleting workspace data."""
    root = root or resolve_workspace_root()
    ensure_workspace_bootstrap(root)
    save_system_settings({"setupComplete": False}, root)
    status = get_ce_setup_status(root)
    return {
        "ok": True,
        "setupComplete": False,
        "shouldShowWizard": status.get("shouldShowWizard", True),
        "message": "Setup reset — wizard will show on next load.",
    }


def complete_ce_setup(
    *,
    user_name: str,
    office_name: str,
    building_type: str = "personal",
    ai_provider: str = "local",
    ai_model: str = "gemma",
    workspace_path: Optional[str] = None,
    storage_path: Optional[str] = None,
    create_first_employee: bool = False,
    create_employee: bool = False,
    root: Optional[Path] = None,
) -> Dict[str, Any]:
    """First-launch onboarding — bootstrap storage, office, optional employee."""
    path_hint = (workspace_path or storage_path or "").strip() or None
    if path_hint:
        root = resolve_workspace_root(path_hint)
        save_system_settings({"workspacePath": path_hint}, root)
    else:
        root = root or resolve_workspace_root()

    ensure_workspace_bootstrap(root)
    offices = load_offices(root)
    create_emp = bool(create_first_employee or create_employee)

    office: Optional[Dict[str, Any]] = offices[0] if offices else None
    if not office:
        office = create_office(
            office_name.strip(),
            f"{building_type.replace('_', ' ').title()} workspace",
            root,
        )

    dept = None
    agent = None
    if create_emp:
        dept = create_department(office["id"], "General", "Default department", root)
        model = ai_model if ai_model and ai_model != "skip" else ""
        agent = create_agent(
            office["id"],
            dept["id"],
            f"{user_name.strip()}'s Assistant",
            {"jobTitle": "AI Employee", "model": model},
            root,
        )

    model_saved = "" if ai_model == "skip" else (ai_model or "")
    save_system_settings(
        {
            "setupComplete": True,
            "userName": user_name.strip(),
            "buildingType": building_type,
            "aiProvider": ai_provider or "local",
            "aiModel": model_saved,
            "firstOfficeId": office["id"],
            "defaultProjectStorage": "managed",
        },
        root,
    )

    return {
        "ok": True,
        "message": "Atlas workspace ready.",
        "office": {"id": office["id"], "name": office.get("name", office_name.strip())},
        "department": dept,
        "agent": agent,
        "setupComplete": True,
    }


def export_storage_manifest(root: Optional[Path] = None) -> Dict[str, Any]:
    root = root or resolve_workspace_root()
    return {
        "version": CE_VERSION,
        "exportedAt": _now_iso(),
        "settings": load_system_settings(root),
        "offices": load_offices(root),
        "storagePath": host_display_path(root),
    }


def detect_legacy_workspace() -> Optional[Dict[str, Any]]:
    for raw in LEGACY_HOST_PATHS:
        p = Path(raw)
        if p.is_dir() and any((p / sub).is_dir() for sub in ("Projects", "Agents", "Inbox")):
            return {"path": str(p), "hasProjects": (p / "Projects").is_dir()}
    old = Path(r"C:\AtlasWorkspace")
    if old.is_dir():
        return {"path": str(old), "hasProjects": (old / "Projects").is_dir()}
    return None


def migrate_legacy_workspace(office_name: str, mode: str = "copy", root: Optional[Path] = None) -> Dict[str, Any]:
    """Migrate old C:\\AtlasWorkspace layout into new Offices/{name}/ structure."""
    legacy = detect_legacy_workspace()
    if not legacy:
        return {"ok": False, "message": "No legacy workspace detected"}
    root = root or resolve_workspace_root()
    ensure_workspace_bootstrap(root)
    office = create_office(office_name, "Migrated from legacy Atlas workspace", root)
    odir = office_dir(root, office["folderName"])
    src = Path(legacy["path"])
    moves = {
        "Projects": "Projects",
        "Inbox": "Inbox",
        "Knowledge": "Knowledge",
        "Reports": "Reports",
        "Memory": "Memory",
        "Archive": "Archive",
    }
    migrated: List[str] = []
    for old_rel, new_rel in moves.items():
        sp = src / old_rel
        if not sp.is_dir():
            continue
        dp = odir / new_rel
        dp.mkdir(parents=True, exist_ok=True)
        if mode == "link":
            continue
        try:
            if mode == "move":
                for item in sp.iterdir():
                    target = dp / item.name
                    if not target.exists():
                        shutil.move(str(item), str(target))
            else:
                for item in sp.iterdir():
                    target = dp / item.name
                    if not target.exists():
                        shutil.copytree(item, target) if item.is_dir() else shutil.copy2(item, target)
            migrated.append(new_rel)
        except OSError as exc:
            logger.warning("[ce-workspace] migrate %s: %s", old_rel, exc)
    agents_src = src / "Agents"
    if agents_src.is_dir():
        legacy_dest = odir / "Archive" / "LegacyAgents"
        legacy_dest.mkdir(parents=True, exist_ok=True)
        try:
            if mode == "move":
                shutil.move(str(agents_src), str(legacy_dest / "Agents"))
            else:
                shutil.copytree(agents_src, legacy_dest / "Agents", dirs_exist_ok=True)
            migrated.append("Agents→Archive/LegacyAgents")
        except OSError as exc:
            logger.warning("[ce-workspace] legacy agents archive: %s", exc)
    return {"ok": True, "office": office, "migrated": migrated, "message": f"Migrated {len(migrated)} area(s)"}


def inbox_path(office_id: Optional[str] = None, root: Optional[Path] = None) -> Path:
    root = root or resolve_workspace_root()
    if office_id:
        odir = _find_office_dir(office_id, root)
        if odir:
            return odir / "Inbox"
    return root / "Global" / "Inbox"
