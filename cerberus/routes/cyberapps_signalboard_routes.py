"""
routes/cyberapps_signalboard_routes.py
SignalBoard — security intelligence RSS/Atom feed aggregator native Cerberus app.

Stores per-user: feed sources, fetched items, bookmarks, settings, alert rules.
Tables: cyberapps_signalboard_* (JSON files, SQLite-free for portability).
All data scoped to authenticated user.
"""

import json
import logging
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from src.auth_helpers import get_current_user
from src.constants import DATA_DIR

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------


def _user_dir(user: str) -> Path:
    d = Path(DATA_DIR) / "cyberapps" / "signalboard" / (user or "default")
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load_json(path: Path, default: Any) -> Any:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("cyberapps_signalboard: failed to read %s", path)
    return default


def _save_json(path: Path, data: Any) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class SourceCreate(BaseModel):
    id: Optional[str] = None
    name: str
    url: str
    type: str = "rss"
    category: str = "Custom"
    enabled: bool = True
    color: str = "#4a9eff"
    pollIntervalMinutes: Optional[int] = None


class SourceUpdate(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    color: Optional[str] = None
    pollIntervalMinutes: Optional[int] = None


class ItemPatch(BaseModel):
    read: Optional[bool] = None
    saved: Optional[bool] = None
    aiSummary: Optional[List[str]] = None


class BookmarksSave(BaseModel):
    ids: List[str]
    tags: Dict[str, List[str]] = {}


class SettingsPatch(BaseModel):
    refreshInterval: Optional[int] = None
    maxItemsPerSource: Optional[int] = None
    autoClearDays: Optional[int] = None
    notificationsEnabled: Optional[bool] = None
    notificationThreshold: Optional[int] = None
    aiProvider: Optional[str] = None
    aiAutoSummarise: Optional[bool] = None
    alertRules: Optional[List[Dict[str, Any]]] = None
    digestConfig: Optional[Dict[str, Any]] = None
    readerLightMode: Optional[bool] = None


class AlertRuleCreate(BaseModel):
    id: Optional[str] = None
    regex: str
    label: str
    severity: str = "medium"
    color: str = "#ff6b6b"


class ItemsBulkSave(BaseModel):
    items: List[Dict[str, Any]]


# ---------------------------------------------------------------------------
# Default settings
# ---------------------------------------------------------------------------

DEFAULT_SETTINGS: Dict[str, Any] = {
    "refreshInterval": 15,
    "maxItemsPerSource": 30,
    "autoClearDays": 30,
    "notificationsEnabled": True,
    "notificationThreshold": 40,
    "aiProvider": "claude",
    "claudeApiKey": "",
    "aiAutoSummarise": False,
    "alertRules": [],
    "readerLightMode": False,
}

# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------


def setup_cyberapps_signalboard_routes() -> APIRouter:
    router = APIRouter(prefix="/api/cyberapps/signalboard", tags=["cyberapps-signalboard"])

    def _user(request: Request) -> str:
        return get_current_user(request) or "default"

    # --- Sources -------------------------------------------------------------

    @router.get("/sources")
    def list_sources(request: Request) -> Dict[str, Any]:
        u = _user(request)
        sources = _load_json(_user_dir(u) / "sources.json", [])
        return {"sources": sources}

    @router.post("/sources")
    def create_source(body: SourceCreate, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "sources.json"
        sources: List[Dict] = _load_json(path, [])
        src_id = body.id or f"src-{uuid.uuid4().hex[:8]}"
        if any(s["id"] == src_id for s in sources):
            raise HTTPException(status_code=409, detail="Source id already exists")
        entry = {
            "id": src_id,
            "name": body.name,
            "url": body.url,
            "type": body.type,
            "category": body.category,
            "enabled": body.enabled,
            "color": body.color,
            "pollIntervalMinutes": body.pollIntervalMinutes,
            "itemCount": 0,
            "errorCount": 0,
            "successCount": 0,
            "attemptCount": 0,
        }
        sources.append(entry)
        _save_json(path, sources)
        return {"ok": True, "source": entry}

    @router.patch("/sources/{source_id}")
    def update_source(source_id: str, body: SourceUpdate, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "sources.json"
        sources: List[Dict] = _load_json(path, [])
        idx = next((i for i, s in enumerate(sources) if s["id"] == source_id), None)
        if idx is None:
            raise HTTPException(status_code=404, detail="Source not found")
        patch = body.model_dump(exclude_none=True)
        sources[idx].update(patch)
        _save_json(path, sources)
        return {"ok": True, "source": sources[idx]}

    @router.delete("/sources/{source_id}")
    def delete_source(source_id: str, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "sources.json"
        sources: List[Dict] = _load_json(path, [])
        orig = len(sources)
        sources = [s for s in sources if s["id"] != source_id]
        if len(sources) == orig:
            raise HTTPException(status_code=404, detail="Source not found")
        _save_json(path, sources)
        return {"ok": True}

    # --- Items ---------------------------------------------------------------

    @router.get("/items")
    def list_items(request: Request) -> Dict[str, Any]:
        u = _user(request)
        items = _load_json(_user_dir(u) / "items.json", [])
        return {"items": items}

    @router.put("/items")
    def save_items(body: ItemsBulkSave, request: Request) -> Dict[str, Any]:
        """Bulk-replace the item store (called after each feed refresh)."""
        u = _user(request)
        _save_json(_user_dir(u) / "items.json", body.items)
        return {"ok": True, "count": len(body.items)}

    @router.patch("/items/{item_id}")
    def patch_item(item_id: str, body: ItemPatch, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "items.json"
        items: List[Dict] = _load_json(path, [])
        idx = next((i for i, it in enumerate(items) if it["id"] == item_id), None)
        if idx is None:
            raise HTTPException(status_code=404, detail="Item not found")
        patch = body.model_dump(exclude_none=True)
        items[idx].update(patch)
        _save_json(path, items)
        return {"ok": True}

    @router.delete("/items")
    def clear_items(request: Request) -> Dict[str, Any]:
        u = _user(request)
        _save_json(_user_dir(u) / "items.json", [])
        return {"ok": True}

    # --- Bookmarks -----------------------------------------------------------

    @router.get("/bookmarks")
    def get_bookmarks(request: Request) -> Dict[str, Any]:
        u = _user(request)
        bm = _load_json(_user_dir(u) / "bookmarks.json", {"ids": [], "tags": {}})
        return bm

    @router.put("/bookmarks")
    def save_bookmarks(body: BookmarksSave, request: Request) -> Dict[str, Any]:
        u = _user(request)
        _save_json(_user_dir(u) / "bookmarks.json", {"ids": body.ids, "tags": body.tags})
        return {"ok": True}

    # --- Settings ------------------------------------------------------------

    @router.get("/settings")
    def get_settings(request: Request) -> Dict[str, Any]:
        u = _user(request)
        stored = _load_json(_user_dir(u) / "settings.json", {})
        merged = {**DEFAULT_SETTINGS, **stored}
        # Never expose claude API key in GET
        merged.pop("claudeApiKey", None)
        return {"settings": merged}

    @router.patch("/settings")
    def patch_settings(body: SettingsPatch, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "settings.json"
        current = _load_json(path, {**DEFAULT_SETTINGS})
        patch = body.model_dump(exclude_none=True)
        current.update(patch)
        _save_json(path, current)
        safe = {k: v for k, v in current.items() if k != "claudeApiKey"}
        return {"ok": True, "settings": safe}

    # --- Alert Rules ---------------------------------------------------------

    @router.get("/alert-rules")
    def get_alert_rules(request: Request) -> Dict[str, Any]:
        u = _user(request)
        rules = _load_json(_user_dir(u) / "alert_rules.json", [])
        return {"rules": rules}

    @router.put("/alert-rules")
    def save_alert_rules(rules: List[AlertRuleCreate], request: Request) -> Dict[str, Any]:
        u = _user(request)
        data = []
        for r in rules:
            data.append({
                "id": r.id or f"rule-{uuid.uuid4().hex[:8]}",
                "regex": r.regex,
                "label": r.label,
                "severity": r.severity,
                "color": r.color,
            })
        _save_json(_user_dir(u) / "alert_rules.json", data)
        return {"ok": True, "rules": data}

    # --- Context (relevance context) ----------------------------------------

    @router.get("/context")
    def get_context(request: Request) -> Dict[str, Any]:
        u = _user(request)
        ctx = _load_json(_user_dir(u) / "context.json", {})
        return {"context": ctx}

    @router.put("/context")
    def save_context(body: Dict[str, Any], request: Request) -> Dict[str, Any]:
        u = _user(request)
        _save_json(_user_dir(u) / "context.json", body)
        return {"ok": True}

    # --- Source fetch stats (health update) ---------------------------------

    @router.patch("/sources/{source_id}/stats")
    def update_source_stats(source_id: str, body: Dict[str, Any], request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "sources.json"
        sources: List[Dict] = _load_json(path, [])
        idx = next((i for i, s in enumerate(sources) if s["id"] == source_id), None)
        if idx is None:
            raise HTTPException(status_code=404, detail="Source not found")
        allowed = {
            "itemCount", "errorCount", "successCount", "attemptCount",
            "consecutiveFailures", "lastFetchAt", "lastSuccess", "error",
            "dailyVolume",
        }
        for k, v in body.items():
            if k in allowed:
                sources[idx][k] = v
        _save_json(path, sources)
        return {"ok": True}

    # --- Health --------------------------------------------------------------

    @router.get("")
    def health(request: Request) -> Dict[str, str]:
        return {"status": "ok", "app": "signalboard"}

    return router
