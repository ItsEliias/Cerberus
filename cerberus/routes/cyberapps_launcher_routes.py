"""
routes/cyberapps_launcher_routes.py
Launcher — Cerberus native app.

Unique features migrated from Electron Launcher:
  - Custom shortcut slots (user-defined app shortcuts)
  - Activity feed (recent events log)
  - Launch-count analytics per registered app
  - Pinned apps list
  - App-visibility preferences (hide from launcher)

Features NOT migrated (covered by existing Cerberus pill-nav):
  - Core app pill navigation — the pill-nav is the launcher
  - VPN status — not applicable in same-origin web context
  - Electron tray / system notifications — N/A
  - AppManager install/build — N/A (native apps use Python backends)
  - Update checker — N/A
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from src.auth_helpers import get_current_user
from src.constants import DATA_DIR

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------


def _user_dir(user: str) -> Path:
    d = Path(DATA_DIR) / "cyberapps" / "launcher" / (user or "default")
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load_json(path: Path, default: Any) -> Any:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("cyberapps_launcher: failed to read %s", path)
    return default


def _save_json(path: Path, data: Any) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


MAX_ACTIVITY = 100

# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class CustomSlot(BaseModel):
    id: str
    name: str
    url: str = ""
    icon: Optional[str] = None
    description: Optional[str] = None


class CustomSlotCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    url: str = Field(default="", max_length=512)
    icon: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=256)


class ActivityEntry(BaseModel):
    app: str
    event: str
    data: Dict[str, Any] = {}
    timestamp: str


class ActivityCreate(BaseModel):
    app: str = Field(..., min_length=1, max_length=64)
    event: str = Field(..., min_length=1, max_length=128)
    data: Dict[str, Any] = {}
    timestamp: Optional[str] = None


class LaunchRecord(BaseModel):
    app_id: str = Field(..., min_length=1, max_length=64)


class PinnedApps(BaseModel):
    pinned: List[str]


class AppPrefs(BaseModel):
    hidden: List[str] = []


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------

def setup_cyberapps_launcher_routes() -> APIRouter:
    router = APIRouter(prefix="/api/cyberapps/launcher", tags=["cyberapps-launcher"])

    def _user(request: Request) -> str:
        return get_current_user(request) or "default"

    # --- Health --------------------------------------------------------------

    @router.get("")
    def health(request: Request) -> Dict[str, str]:
        return {"status": "ok", "app": "launcher"}

    # --- Custom slots --------------------------------------------------------

    @router.get("/slots")
    def list_slots(request: Request) -> Dict[str, Any]:
        u = _user(request)
        slots = _load_json(_user_dir(u) / "slots.json", [])
        return {"slots": slots}

    @router.post("/slots")
    def create_slot(body: CustomSlotCreate, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "slots.json"
        slots: List[Dict] = _load_json(path, [])
        if len(slots) >= 8:
            raise HTTPException(status_code=400, detail="Maximum 8 custom slots")
        import uuid
        new_slot = {
            "id": str(uuid.uuid4()),
            "name": body.name,
            "url": body.url,
            "icon": body.icon,
            "description": body.description,
        }
        slots.append(new_slot)
        _save_json(path, slots)
        return {"ok": True, "slot": new_slot}

    @router.put("/slots/{slot_id}")
    def update_slot(slot_id: str, body: CustomSlotCreate, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "slots.json"
        slots: List[Dict] = _load_json(path, [])
        idx = next((i for i, s in enumerate(slots) if s.get("id") == slot_id), None)
        if idx is None:
            raise HTTPException(status_code=404, detail="Slot not found")
        slots[idx] = {
            "id": slot_id,
            "name": body.name,
            "url": body.url,
            "icon": body.icon,
            "description": body.description,
        }
        _save_json(path, slots)
        return {"ok": True, "slot": slots[idx]}

    @router.delete("/slots/{slot_id}")
    def delete_slot(slot_id: str, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "slots.json"
        slots: List[Dict] = _load_json(path, [])
        orig = len(slots)
        slots = [s for s in slots if s.get("id") != slot_id]
        if len(slots) == orig:
            raise HTTPException(status_code=404, detail="Slot not found")
        _save_json(path, slots)
        return {"ok": True}

    # --- Activity feed -------------------------------------------------------

    @router.get("/activity")
    def get_activity(request: Request) -> Dict[str, Any]:
        u = _user(request)
        entries = _load_json(_user_dir(u) / "activity.json", [])
        return {"entries": entries}

    @router.post("/activity")
    def add_activity(body: ActivityCreate, request: Request) -> Dict[str, Any]:
        from datetime import datetime, timezone
        u = _user(request)
        path = _user_dir(u) / "activity.json"
        entries: List[Dict] = _load_json(path, [])
        entry = {
            "app": body.app,
            "event": body.event,
            "data": body.data,
            "timestamp": body.timestamp or datetime.now(timezone.utc).isoformat(),
        }
        entries.insert(0, entry)
        if len(entries) > MAX_ACTIVITY:
            entries = entries[:MAX_ACTIVITY]
        _save_json(path, entries)
        return {"ok": True}

    @router.delete("/activity")
    def clear_activity(request: Request) -> Dict[str, Any]:
        u = _user(request)
        _save_json(_user_dir(u) / "activity.json", [])
        return {"ok": True}

    # --- Launch counts -------------------------------------------------------

    @router.get("/launches")
    def get_launches(request: Request) -> Dict[str, Any]:
        u = _user(request)
        counts = _load_json(_user_dir(u) / "launches.json", {})
        return {"counts": counts}

    @router.post("/launches")
    def record_launch(body: LaunchRecord, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "launches.json"
        counts: Dict[str, int] = _load_json(path, {})
        counts[body.app_id] = counts.get(body.app_id, 0) + 1
        _save_json(path, counts)
        return {"ok": True, "count": counts[body.app_id]}

    # --- Pinned apps ---------------------------------------------------------

    @router.get("/pinned")
    def get_pinned(request: Request) -> Dict[str, Any]:
        u = _user(request)
        pinned = _load_json(_user_dir(u) / "pinned.json", [])
        return {"pinned": pinned}

    @router.put("/pinned")
    def save_pinned(body: PinnedApps, request: Request) -> Dict[str, Any]:
        u = _user(request)
        _save_json(_user_dir(u) / "pinned.json", body.pinned)
        return {"ok": True}

    # --- App visibility preferences ------------------------------------------

    @router.get("/prefs")
    def get_prefs(request: Request) -> Dict[str, Any]:
        u = _user(request)
        prefs = _load_json(_user_dir(u) / "prefs.json", {"hidden": []})
        return {"prefs": prefs}

    @router.put("/prefs")
    def save_prefs(body: AppPrefs, request: Request) -> Dict[str, Any]:
        u = _user(request)
        _save_json(_user_dir(u) / "prefs.json", body.model_dump())
        return {"ok": True}

    return router
