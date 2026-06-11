"""
routes/cyberapps_settings_routes.py

Per-user Cyber Apps preferences storage.

Endpoints:
  GET  /api/cyberapps/settings            — full prefs object for current user
  PUT  /api/cyberapps/settings/<app_id>   — update one app's prefs
  POST /api/cyberapps/settings/reset/<app_id> — wipe that app's data

Storage: data/cyberapps/settings/<user>.json  (atomic write, 0600 perms)
Auth: get_current_user(request) on every route.
"""

from __future__ import annotations

import json
import logging
import os
import stat
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from src.auth_helpers import get_current_user
from src.constants import DATA_DIR
from core.atomic_io import atomic_write_json

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Known per-app reset endpoints (app_id → route path).
# Populate as apps add data-wipe support. None = "no reset endpoint".
# ---------------------------------------------------------------------------
_APP_RESET_ENDPOINTS: Dict[str, str | None] = {
    "cyberlab": None,
    "credvault": None,
    "ghostvault": None,
    "vaultcore": None,
    "networkmap": None,
    "netlab": None,
    "recondesk": None,
    "terminallink": None,
    "launcher": None,
    "dashboard": None,
    "signalboard": None,
    "playbookstudio": None,
    "reportforge": None,
    "operations": None,
}

# ---------------------------------------------------------------------------
# Default prefs per app
# ---------------------------------------------------------------------------
_DEFAULT_APP_PREFS: Dict[str, Any] = {
    "showPill": True,
    "defaultActive": False,
}

_APP_SPECIFIC_DEFAULTS: Dict[str, Dict[str, Any]] = {
    "cyberlab": {"model": "", "max_tokens": 4096, "system_prompt": ""},
    "credvault": {"pw_length": 20, "use_upper": True, "use_lower": True,
                  "use_digits": True, "use_symbols": True, "auto_lock_minutes": 5},
    "ghostvault": {"autosave_interval_ms": 2000, "default_template": "blank"},
    "vaultcore": {"scrape_depth": 2, "max_pages": 50, "delay_ms": 500,
                  "auto_wikilinks": False, "auto_tag": True, "notifications": True},
    "networkmap": {"default_layout": "force", "default_heatmap": False,
                   "default_vuln_overlay": False},
    "netlab": {},
    "recondesk": {"nmap_binary": "nmap", "default_engagement": ""},
    "terminallink": {"default_shell": "/bin/bash", "max_concurrent_sessions": 5},
    "launcher": {},
    "dashboard": {"polling_interval_seconds": 30},
    "signalboard": {"notify_high": True, "notify_critical": True, "notify_low": False},
    "playbookstudio": {},
    "reportforge": {"default_template": "blank", "default_markdown": True,
                    "default_html": False},
    "operations": {"vitals_interval_seconds": 5, "agents_interval_seconds": 10},
}

# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------

SETTINGS_DIR = Path(DATA_DIR) / "cyberapps" / "settings"


def _settings_path(user: str) -> Path:
    return SETTINGS_DIR / f"{user}.json"


def _load_prefs(user: str) -> Dict[str, Any]:
    path = _settings_path(user)
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            logger.debug("cyberapps_settings: failed to read %s", path)
    return {}


def _save_prefs(user: str, prefs: Dict[str, Any]) -> None:
    SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    path = str(_settings_path(user))
    atomic_write_json(path, prefs, indent=2)
    try:
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass


def _full_prefs(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Merge raw stored prefs with defaults for all known apps."""
    result: Dict[str, Any] = {}
    for app_id, specific in _APP_SPECIFIC_DEFAULTS.items():
        stored = raw.get(app_id, {})
        merged = {**_DEFAULT_APP_PREFS, **specific, **stored}
        result[app_id] = merged
    # Preserve any unknown app entries verbatim.
    for app_id, stored in raw.items():
        if app_id not in result:
            result[app_id] = {**_DEFAULT_APP_PREFS, **stored}
    return result


def _require_user(request: Request) -> str:
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

def setup_cyberapps_settings_routes() -> APIRouter:
    router = APIRouter()

    @router.get("/api/cyberapps/settings")
    async def get_settings(request: Request) -> JSONResponse:
        user = _require_user(request)
        raw = _load_prefs(user)
        return JSONResponse(_full_prefs(raw))

    @router.put("/api/cyberapps/settings/{app_id}")
    async def put_settings(app_id: str, request: Request) -> JSONResponse:
        user = _require_user(request)
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Body must be a JSON object")
        raw = _load_prefs(user)
        existing = raw.get(app_id, {})
        existing.update(body)
        raw[app_id] = existing
        # Enforce single defaultActive across all apps when set to true.
        if body.get("defaultActive") is True:
            for other_id in raw:
                if other_id != app_id:
                    raw[other_id]["defaultActive"] = False
        _save_prefs(user, raw)
        return JSONResponse({"ok": True, "app_id": app_id, "prefs": raw[app_id]})

    @router.post("/api/cyberapps/settings/reset/{app_id}")
    async def reset_app_data(app_id: str, request: Request) -> JSONResponse:
        user = _require_user(request)
        reset_ep = _APP_RESET_ENDPOINTS.get(app_id)
        if reset_ep is None:
            return JSONResponse({
                "ok": False,
                "app_id": app_id,
                "detail": "App provides no reset endpoint — wipe data manually.",
            })
        # Future: forward to app-specific reset endpoint.
        return JSONResponse({"ok": True, "app_id": app_id, "reset_endpoint": reset_ep})

    return router
