"""Atlas desktop bridge client — Docker backend talks to Windows host bridge."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from src.cerberus_config import data_dir, load_projects
from src.cerberus_mount_workspace import (
    container_root,
    host_root_hint,
    is_under_container_workspace,
    projects_folder,
    to_display_path,
)
from src.cerberus_workspace import load_workspace

logger = logging.getLogger(__name__)

_PERMISSIONS_FILE = "desktop_permissions.json"
_DEFAULTS: Dict[str, Any] = {
    "desktop_commands_enabled": False,
    "require_confirmation": False,
    "bridge_url": "http://host.docker.internal:8765",
    "bridge_token": "",
    "allowed_host_workspace": r"C:\AtlasWorkspace",
    "allowed_apps": {},
    "allowed_actions": [
        "open_app",
        "open_folder",
        "open_project_in_cursor",
        "open_url",
        "close_app",
    ],
}


def _permissions_path() -> Path:
    return data_dir() / _PERMISSIONS_FILE


def load_desktop_permissions() -> Dict[str, Any]:
    path = _permissions_path()
    if not path.is_file():
        return dict(_DEFAULTS)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return dict(_DEFAULTS)
        out = dict(_DEFAULTS)
        out.update(data)
        if isinstance(data.get("allowed_apps"), list):
            out["allowed_apps"] = {a: a for a in data["allowed_apps"]}
        elif isinstance(data.get("allowed_apps"), dict):
            out["allowed_apps"] = dict(data["allowed_apps"])
        return out
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("[cerberus-desktop] could not read permissions: %s", exc)
        return dict(_DEFAULTS)


def container_to_host_path(container_path: str, ws: Optional[Dict[str, Any]] = None) -> Tuple[Optional[str], Optional[str]]:
    """Translate /workspace/... to C:\\AtlasWorkspace\\..."""
    raw = (container_path or "").strip().replace("\\", "/")
    if not raw:
        return None, "Empty path"
    host_root = (ws or {}).get("workspace_host_root_hint") or host_root_hint()
    cont_root = (ws or {}).get("workspace_container_root") or container_root()
    cont_norm = cont_root.rstrip("/")
    host_norm = host_root.rstrip("\\/")

    if raw.startswith("/workspace"):
        rel = raw[len("/workspace"):].lstrip("/")
        return host_norm + ("\\" + rel.replace("/", "\\") if rel else ""), None
    if raw == cont_norm or raw.startswith(cont_norm + "/"):
        rel = raw[len(cont_norm):].lstrip("/")
        return host_norm + ("\\" + rel.replace("/", "\\") if rel else ""), None
    return None, f"Path must be under {cont_norm}"


def is_allowed_host_path(host_path: str, perms: Dict[str, Any]) -> bool:
    allowed = (perms.get("allowed_host_workspace") or host_root_hint()).rstrip("\\/").lower()
    norm = host_path.replace("/", "\\").lower()
    return norm == allowed or norm.startswith(allowed + "\\")


def _bridge_configured(perms: Dict[str, Any]) -> bool:
    url = (perms.get("bridge_url") or "").strip()
    token = (perms.get("bridge_token") or "").strip()
    return bool(url and token)


async def _bridge_health_data(perms: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    url = (perms.get("bridge_url") or "").strip().rstrip("/")
    if not url:
        return None
    try:
        import httpx
        async with httpx.AsyncClient(timeout=2.0) as client:
            res = await client.get(f"{url}/health")
            if res.status_code == 200:
                data = res.json()
                if isinstance(data, dict):
                    return data
    except Exception as exc:
        logger.debug("[cerberus-desktop] bridge health failed: %s", exc)
    return None


async def _bridge_health(perms: Dict[str, Any]) -> bool:
    data = await _bridge_health_data(perms)
    return bool(data and data.get("ok") is True)


async def _call_bridge(perms: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    url = (perms.get("bridge_url") or "").strip().rstrip("/")
    token = (perms.get("bridge_token") or "").strip()
    if not url or not token:
        return {"ok": False, "message": "Bridge URL or token not configured."}
    try:
        import httpx
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(
                f"{url}/command",
                json=payload,
                headers={"X-Atlas-Bridge-Token": token},
            )
            try:
                data = res.json()
            except ValueError:
                data = {"ok": False, "message": res.text or f"HTTP {res.status_code}"}
            if res.status_code >= 400 and data.get("ok") is not False:
                data["ok"] = False
            return data
    except Exception as exc:
        logger.warning("[cerberus-desktop] bridge call failed: %s", exc)
        return {
            "ok": False,
            "message": "Desktop bridge is not running. Start desktop_bridge.py on Windows.",
            "error": str(exc),
        }


def _resolve_project_host_path(project_id: str, perms: Dict[str, Any]) -> Tuple[Optional[str], Optional[str], Optional[Dict[str, Any]]]:
    projects = load_projects()
    project = next((p for p in projects if p.get("id") == project_id), None)
    if not project:
        return None, "Project not found", None
    path = (project.get("path") or "").strip()
    if not path:
        return None, "Project has no path", project
    ws = load_workspace(data_dir())
    if not is_under_container_workspace(path, ws):
        expected = f"{projects_folder()}/{project.get('name', project_id)}"
        return None, f"Project path must be under {projects_folder()}", project
    host_path, err = container_to_host_path(path, ws)
    if err or not host_path:
        return None, err or "Could not translate path", project
    if not is_allowed_host_path(host_path, perms):
        return None, "Path is outside allowed host workspace", project
    projects_prefix = (perms.get("allowed_host_workspace") or host_root_hint()).rstrip("\\/") + "\\Projects"
    if not host_path.replace("/", "\\").lower().startswith(projects_prefix.lower()):
        return None, f"Project must be under {projects_prefix}", project
    return host_path, None, project


async def _bridge_apps_data(perms: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    url = (perms.get("bridge_url") or "").strip().rstrip("/")
    if not url:
        return None
    try:
        import httpx
        async with httpx.AsyncClient(timeout=3.0) as client:
            res = await client.get(f"{url}/apps")
            if res.status_code == 200:
                data = res.json()
                if isinstance(data, dict):
                    return data
    except Exception as exc:
        logger.debug("[cerberus-desktop] bridge apps failed: %s", exc)
    return None


async def desktop_apps() -> Dict[str, Any]:
    from src.cerberus_launcher_apps import list_launcher_apps

    perms = load_desktop_permissions()
    local = list_launcher_apps()
    if not _bridge_configured(perms):
        apps = {
            (a.get("id") or "").lower(): {
                "id": a.get("id"),
                "display_name": a.get("name"),
                "available": bool(a.get("pathExists")),
                "path": a.get("executablePath"),
                "aliases": a.get("aliases") or [],
                "message": a.get("pathMessage") or "",
                "enabled": a.get("enabled", True),
            }
            for a in local.get("apps") or []
            if a.get("id")
        }
        return {
            "ok": True,
            "message": "Bridge not configured. Showing saved launcher apps only.",
            "apps": apps,
            "app_count": len(apps),
            "available_apps": [k for k, v in apps.items() if v.get("available")],
            "missing_apps": [k for k, v in apps.items() if not v.get("available")],
        }
    data = await _bridge_apps_data(perms)
    if not data:
        return {
            "ok": False,
            "message": "Could not reach desktop bridge.",
            "apps": {},
            "launcher_apps": local.get("apps") or [],
        }
    return data


async def desktop_status() -> Dict[str, Any]:
    perms = load_desktop_permissions()
    enabled = bool(perms.get("desktop_commands_enabled"))
    configured = _bridge_configured(perms)
    bridge_ready = False
    bridge_health: Optional[Dict[str, Any]] = None
    if configured:
        bridge_health = await _bridge_health_data(perms)
        bridge_ready = bool(bridge_health and bridge_health.get("ok") is True)

    if not enabled:
        message = "Desktop bridge disabled"
        state = "disabled"
        label = "Desktop Control: Disabled"
    elif not configured:
        message = "Desktop bridge not configured. Set bridge_url and bridge_token."
        state = "bridge_missing"
        label = "Desktop Control: Bridge missing"
    elif not bridge_ready:
        message = "Desktop bridge is not running. Start desktop_bridge.py on Windows."
        state = "bridge_missing"
        label = "Desktop Control: Bridge offline"
    else:
        message = "Desktop bridge ready"
        state = "ready"
        label = "Desktop Control: Ready"

    return {
        "ok": True,
        "enabled": enabled,
        "bridge_ready": bridge_ready,
        "bridge_url": perms.get("bridge_url") or "",
        "message": message,
        "state": state,
        "desktop_commands_enabled": enabled,
        "bridge_configured": configured,
        "require_confirmation": bool(perms.get("require_confirmation", True)),
        "allowed_apps": perms.get("allowed_apps") or {},
        "allowed_actions": list(perms.get("allowed_actions") or []),
        "label": label,
        "bridge_apps": (bridge_health or {}).get("resolved_apps") if bridge_health else None,
        "app_count": (bridge_health or {}).get("app_count") if bridge_health else None,
        "available_apps": (bridge_health or {}).get("available_apps") if bridge_health else None,
        "missing_apps": (bridge_health or {}).get("missing_apps") if bridge_health else None,
        "setup_hint": (
            "1. Add desktop apps in Settings → Desktop Bridge / App Launcher\n"
            "2. Set bridge_token in desktop_permissions.json\n"
            "3. Run desktop_bridge.py on Windows (http://127.0.0.1:8765)\n"
            "4. Enable desktop_commands_enabled\n"
            "5. Use Test Launch to verify each app path"
        ),
    }


def desktop_capabilities_for_project(project: Dict[str, Any]) -> Dict[str, Any]:
    perms = load_desktop_permissions()
    enabled = bool(perms.get("desktop_commands_enabled"))
    configured = _bridge_configured(perms)
    path = (project.get("path") or "").strip()
    ws = load_workspace(data_dir())
    valid_path = bool(path and is_under_container_workspace(path, ws) and project.get("path_status") == "valid")
    ready = enabled and configured
    reason = "Desktop bridge disabled"
    if not enabled:
        reason = "Desktop control is disabled. Enable it in desktop permissions and start the bridge."
    elif not configured:
        reason = "Desktop bridge not configured. Set bridge_url and bridge_token."
    elif not valid_path:
        reason = "Project path invalid or not mounted."
    else:
        reason = "Bridge reachability checked when sending commands."

    return {
        "can_open_folder": ready and valid_path,
        "can_open_cursor": ready and valid_path,
        "can_open_url": ready,
        "reason": reason,
        "display_path": project.get("display_path") or to_display_path(path, ws),
    }


async def queue_desktop_command(command: str, args: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Send approved command to Windows host bridge."""
    cmd = (command or "").strip()
    payload_args = dict(args or {})
    if not cmd:
        return {"ok": False, "error": "empty_command", "message": "Command is required."}

    perms = load_desktop_permissions()
    enabled = bool(perms.get("desktop_commands_enabled"))
    allowed_actions: List[str] = list(perms.get("allowed_actions") or [])

    if not enabled:
        return {
            "ok": False,
            "executed": False,
            "command": cmd,
            "args": payload_args,
            "message": "Desktop control is disabled. Enable it in desktop permissions and start the bridge.",
        }

    if cmd not in allowed_actions:
        return {"ok": False, "message": f"Action '{cmd}' is not in allowed_actions."}

    if not _bridge_configured(perms):
        return {
            "ok": False,
            "executed": False,
            "command": cmd,
            "args": payload_args,
            "message": "Desktop bridge is not running. Start desktop_bridge.py on Windows.",
        }

    bridge_payload: Dict[str, Any] = {"command": cmd, "args": payload_args}

    from src.cerberus_launcher_apps import get_app_by_id, get_enabled_app_ids

    enabled_apps = get_enabled_app_ids()
    manual_allowed = {k.lower(): v for k, v in (perms.get("allowed_apps") or {}).items()}
    allowed_apps = {**enabled_apps, **manual_allowed}

    if cmd == "open_app":
        app = (payload_args.get("app") or "").strip().lower()
        if app not in allowed_apps:
            return {"ok": False, "message": f"No app configured for '{app}'. Add it in Settings → Desktop Bridge."}
        launcher_app = get_app_by_id(app)
        if launcher_app:
            from src.cerberus_launcher_apps import validate_executable
            ok, msg = validate_executable(launcher_app.get("executablePath") or "")
            if not ok:
                return {"ok": False, "message": msg}
        bridge_payload["args"] = {"app": app, "launcher": allowed_apps.get(app) or app}

    elif cmd == "close_app":
        app = (payload_args.get("app") or "").strip().lower()
        if app not in allowed_apps:
            return {"ok": False, "message": f"No app configured for '{app}'. Add it in Settings → Desktop Bridge."}
        bridge_payload["args"] = {"app": app}

    elif cmd == "open_folder":
        project_id = (payload_args.get("project_id") or "").strip()
        folder = (payload_args.get("path") or "").strip()
        if project_id:
            host_path, err, _ = _resolve_project_host_path(project_id, perms)
            if err:
                return {"ok": False, "message": err}
            folder = host_path or ""
        elif folder:
            ws = load_workspace(data_dir())
            host_path, err = container_to_host_path(folder, ws)
            if err:
                return {"ok": False, "message": err}
            folder = host_path or ""
        if not folder or not is_allowed_host_path(folder, perms):
            return {"ok": False, "message": "Folder path not allowed."}
        bridge_payload["args"] = {"path": folder}

    elif cmd == "open_project_in_cursor":
        project_id = (payload_args.get("project_id") or "").strip()
        if not project_id:
            return {"ok": False, "message": "project_id is required."}
        host_path, err, project = _resolve_project_host_path(project_id, perms)
        if err:
            return {"ok": False, "message": err}
        bridge_payload["args"] = {"path": host_path, "project_name": project.get("name") if project else ""}

    elif cmd == "open_url":
        url = (payload_args.get("url") or "").strip()
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return {"ok": False, "message": "Only http/https URLs are allowed."}
        browser = (payload_args.get("browser") or "").strip().lower()
        allowed_apps = perms.get("allowed_apps") or {}
        if browser and browser not in allowed_apps:
            return {"ok": False, "message": f"Browser '{browser}' is not whitelisted."}
        bridge_payload["args"] = {"url": url, "browser": browser or None}

    result = await _call_bridge(perms, bridge_payload)
    result.setdefault("command", cmd)
    result.setdefault("args", payload_args)
    result["executed"] = bool(result.get("ok"))
    return result
