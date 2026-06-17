"""User-configured desktop app launcher — Community Edition."""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from src.cerberus_config import data_dir

logger = logging.getLogger(__name__)

_LAUNCHER_FILE = "launcher_apps.json"
_BRIDGE_REGISTRY = "desktop_bridge/apps.json"

_DEFAULT: Dict[str, Any] = {"apps": []}


def _launcher_path() -> Path:
    return data_dir() / _LAUNCHER_FILE


def _bridge_registry_path() -> Path:
    root = Path(__file__).resolve().parents[1]
    return root / _BRIDGE_REGISTRY


def _normalize_id(raw: str) -> str:
    text = re.sub(r"[^a-z0-9_-]+", "-", (raw or "").strip().lower())
    return text.strip("-") or str(uuid.uuid4())[:8]


def validate_executable(path: str) -> Tuple[bool, str]:
    raw = (path or "").strip()
    if not raw:
        return False, "Executable path is required."
    if not raw.lower().endswith(".exe"):
        return False, "Only .exe paths are allowed."
    if any(ch in raw for ch in ("|", "&", ";", "`", "$", "\n", "\r")):
        return False, "Invalid characters in executable path."
    try:
        p = Path(raw)
        if p.is_file():
            return True, str(p.resolve())
    except OSError:
        pass
    return False, f"Executable not found: {raw}"


def _normalize_app(entry: Dict[str, Any], *, existing_id: Optional[str] = None) -> Dict[str, Any]:
    name = (entry.get("name") or entry.get("display_name") or "").strip()
    app_id = _normalize_id(entry.get("id") or existing_id or name)
    aliases = entry.get("aliases") or []
    if isinstance(aliases, str):
        aliases = [a.strip() for a in aliases.split(",") if a.strip()]
    alias_list = []
    seen = set()
    for alias in aliases:
        a = str(alias).strip()
        if not a:
            continue
        key = a.lower()
        if key in seen:
            continue
        seen.add(key)
        alias_list.append(a)
    if name and name.lower() not in seen:
        alias_list.insert(0, name)
    if app_id and app_id not in seen:
        alias_list.append(app_id)

    exe = (entry.get("executablePath") or entry.get("executable_path") or entry.get("path") or "").strip()
    args = entry.get("args") or []
    if not isinstance(args, list):
        args = []
    args = [str(a) for a in args if str(a).strip()]

    workdir = (entry.get("workingDirectory") or entry.get("working_directory") or "").strip()

    return {
        "id": app_id,
        "name": name or app_id,
        "aliases": alias_list,
        "executablePath": exe,
        "args": args,
        "workingDirectory": workdir,
        "enabled": bool(entry.get("enabled", True)),
    }


def load_launcher_apps() -> Dict[str, Any]:
    path = _launcher_path()
    data_dir().mkdir(parents=True, exist_ok=True)
    if not path.is_file():
        save_launcher_apps(dict(_DEFAULT))
        return dict(_DEFAULT)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return dict(_DEFAULT)
        apps = data.get("apps")
        if not isinstance(apps, list):
            apps = []
        return {"apps": [a for a in apps if isinstance(a, dict)]}
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("[launcher-apps] read failed: %s", exc)
        return dict(_DEFAULT)


def save_launcher_apps(data: Dict[str, Any]) -> Dict[str, Any]:
    apps = data.get("apps")
    if not isinstance(apps, list):
        apps = []
    out = {"apps": apps}
    path = _launcher_path()
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)
    sync_bridge_registry(out)
    _clear_alias_cache()
    return out


def sync_bridge_registry(data: Optional[Dict[str, Any]] = None) -> None:
    """Write bridge-compatible registry for the Windows host service."""
    payload = data if data is not None else load_launcher_apps()
    apps_out: List[Dict[str, Any]] = []
    for app in payload.get("apps") or []:
        if not isinstance(app, dict):
            continue
        exe = (app.get("executablePath") or "").strip()
        apps_out.append({
            "id": app.get("id"),
            "display_name": app.get("name") or app.get("id"),
            "aliases": app.get("aliases") or [],
            "type": "direct_exe",
            "path": exe,
            "args": app.get("args") or [],
            "working_directory": app.get("workingDirectory") or "",
            "enabled": bool(app.get("enabled", True)),
        })
    reg_path = _bridge_registry_path()
    try:
        reg_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = reg_path.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"apps": apps_out}, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, reg_path)
    except OSError as exc:
        logger.warning("[launcher-apps] bridge registry sync failed: %s", exc)


_alias_cache: Optional[Dict[str, List[str]]] = None


def _clear_alias_cache() -> None:
    global _alias_cache
    _alias_cache = None


def build_alias_index() -> Dict[str, List[str]]:
    global _alias_cache
    if _alias_cache is not None:
        return _alias_cache
    index: Dict[str, List[str]] = {}
    for app in load_launcher_apps().get("apps") or []:
        if not app.get("enabled", True):
            continue
        app_id = (app.get("id") or "").strip().lower()
        if not app_id:
            continue
        keys = {app_id, (app.get("name") or "").strip().lower()}
        for alias in app.get("aliases") or []:
            keys.add(str(alias).strip().lower())
        for key in keys:
            if not key:
                continue
            index.setdefault(key, [])
            if app_id not in index[key]:
                index[key].append(app_id)
    _alias_cache = index
    return index


def get_app_by_id(app_id: str) -> Optional[Dict[str, Any]]:
    key = (app_id or "").strip().lower()
    for app in load_launcher_apps().get("apps") or []:
        if (app.get("id") or "").lower() == key:
            return app
    return None


def match_apps(query: str) -> List[Dict[str, Any]]:
    norm = re.sub(r"\s+", " ", (query or "").strip().lower())
    if not norm:
        return []
    index = build_alias_index()
    ids = index.get(norm, [])
    if not ids:
        for alias, app_ids in index.items():
            if norm == alias or norm.endswith(" " + alias) or alias in norm:
                ids.extend(app_ids)
        ids = list(dict.fromkeys(ids))
    apps = []
    for app_id in ids:
        app = get_app_by_id(app_id)
        if app and app.get("enabled", True):
            apps.append(app)
    return apps


def list_launcher_apps() -> Dict[str, Any]:
    data = load_launcher_apps()
    apps = []
    for app in data.get("apps") or []:
        ok, msg = validate_executable(app.get("executablePath") or "")
        apps.append({
            **app,
            "pathExists": ok,
            "pathMessage": msg if not ok else "",
        })
    return {"ok": True, "apps": apps}


def add_launcher_app(entry: Dict[str, Any]) -> Dict[str, Any]:
    row = _normalize_app(entry)
    ok, msg = validate_executable(row["executablePath"])
    if not ok:
        return {"ok": False, "message": msg}
    data = load_launcher_apps()
    apps = data.get("apps") or []
    if any((a.get("id") or "").lower() == row["id"].lower() for a in apps):
        return {"ok": False, "message": f"App id '{row['id']}' already exists."}
    apps.append(row)
    saved = save_launcher_apps({"apps": apps})
    return {"ok": True, "app": row, "apps": saved.get("apps") or []}


def update_launcher_app(app_id: str, patch: Dict[str, Any]) -> Dict[str, Any]:
    key = (app_id or "").strip().lower()
    data = load_launcher_apps()
    apps = data.get("apps") or []
    idx = next((i for i, a in enumerate(apps) if (a.get("id") or "").lower() == key), None)
    if idx is None:
        return {"ok": False, "message": f"App '{app_id}' not found."}
    merged = {**apps[idx], **patch, "id": apps[idx].get("id")}
    row = _normalize_app(merged, existing_id=apps[idx].get("id"))
    ok, msg = validate_executable(row["executablePath"])
    if not ok:
        return {"ok": False, "message": msg}
    apps[idx] = row
    saved = save_launcher_apps({"apps": apps})
    return {"ok": True, "app": row, "apps": saved.get("apps") or []}


def delete_launcher_app(app_id: str) -> Dict[str, Any]:
    key = (app_id or "").strip().lower()
    data = load_launcher_apps()
    apps = [a for a in (data.get("apps") or []) if (a.get("id") or "").lower() != key]
    if len(apps) == len(data.get("apps") or []):
        return {"ok": False, "message": f"App '{app_id}' not found."}
    saved = save_launcher_apps({"apps": apps})
    return {"ok": True, "apps": saved.get("apps") or []}


def get_enabled_app_ids() -> Dict[str, str]:
    return {
        (a.get("id") or "").lower(): (a.get("id") or "").lower()
        for a in load_launcher_apps().get("apps") or []
        if a.get("enabled", True) and (a.get("id") or "").strip()
    }
