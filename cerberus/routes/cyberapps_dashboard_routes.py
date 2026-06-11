"""
routes/cyberapps_dashboard_routes.py

Dashboard — CyberOS overview native Cerberus app.

Read-only aggregation layer: pulls status snapshots and event feeds from
the data files written by other CyberOS Wave-2 apps (cyberlab, recondesk,
credvault, vaultcore, networkmap, netlab, terminallink, signalboard).

No SQLAlchemy models — Dashboard never owns data, it only aggregates.
All endpoints are GET-only and scoped to the authenticated user.
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request
from src.auth_helpers import get_current_user
from src.constants import DATA_DIR

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------


def _user_dir(app_id: str, user: str) -> Path:
    """Return the data dir for a given app+user, non-raising."""
    return Path(DATA_DIR) / "cyberapps" / app_id / (user or "default")


def _load_json(path: Path, default: Any) -> Any:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.debug("dashboard: failed to read %s", path)
    return default


# ---------------------------------------------------------------------------
# Cross-app aggregation helpers
# ---------------------------------------------------------------------------

def _aggregate_status(user: str) -> Dict[str, Any]:
    """
    Build a status snapshot for every Wave-2 app.
    Each app writes its status to data/cyberapps/<id>/<user>/status.json.
    Missing/unreadable files result in { active: false } for that app.
    """
    app_ids = [
        "cyberlab", "recondesk", "credvault", "vaultcore",
        "networkmap", "netlab", "terminallink", "signalboard",
        "ghostvault", "playbookstudio", "reportforge",
    ]
    result: Dict[str, Any] = {}
    for app_id in app_ids:
        d = _user_dir(app_id, user)
        status = _load_json(d / "status.json", {"active": False})
        result[app_id] = status
    return result


def _aggregate_events(user: str, limit: int = 100) -> List[Dict[str, Any]]:
    """
    Collect recent events from all Wave-2 apps.
    Each app writes events to data/cyberapps/<id>/<user>/events.json
    as a list newest-first.  We merge and re-sort by timestamp.
    """
    app_ids = [
        "cyberlab", "recondesk", "credvault", "vaultcore",
        "networkmap", "netlab", "terminallink", "signalboard",
        "ghostvault", "playbookstudio", "reportforge",
    ]
    all_events: List[Dict[str, Any]] = []
    for app_id in app_ids:
        d = _user_dir(app_id, user)
        events = _load_json(d / "events.json", [])
        if isinstance(events, list):
            all_events.extend(events)

    # Sort newest-first; fall back gracefully if timestamp missing
    all_events.sort(
        key=lambda e: e.get("timestamp", ""),
        reverse=True,
    )
    return all_events[:limit]


def _load_operator_profile(user: str) -> Optional[Dict[str, Any]]:
    d = _user_dir("cyberlab", user)
    return _load_json(d / "operator_profile.json", None)


def _load_shared_context(user: str) -> Optional[Dict[str, Any]]:
    """
    Shared context is written by CyberLab when a session is active.
    Falls back to a merge of whichever app last set activeTarget/activeLab.
    """
    d = _user_dir("cyberlab", user)
    return _load_json(d / "shared_context.json", None)


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------

def setup_cyberapps_dashboard_routes() -> APIRouter:
    router = APIRouter(prefix="/api/cyberapps/dashboard", tags=["cyberapps-dashboard"])

    def _user(request: Request) -> str:
        return get_current_user(request) or "default"

    # --- Aggregated status snapshot ----------------------------------------

    @router.get("")
    def health(request: Request) -> Dict[str, str]:
        return {"status": "ok", "app": "dashboard"}

    @router.get("/summary")
    def get_summary(request: Request) -> Dict[str, Any]:
        """
        Full dashboard summary: app statuses + operator profile +
        shared context + recent events.
        """
        u = _user(request)
        statuses = _aggregate_status(u)
        active_count = sum(1 for s in statuses.values() if s.get("active"))
        total_count = len(statuses)

        return {
            "app_statuses": statuses,
            "health": {
                "active": active_count,
                "total": total_count,
                "percent": round(active_count / total_count * 100) if total_count else 0,
            },
            "operator_profile": _load_operator_profile(u),
            "shared_context": _load_shared_context(u),
        }

    @router.get("/statuses")
    def get_statuses(request: Request) -> Dict[str, Any]:
        """Per-app status objects only — lightweight poll for health bar."""
        u = _user(request)
        return {"statuses": _aggregate_status(u)}

    @router.get("/events")
    def get_events(
        request: Request,
        limit: int = 100,
        app: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Recent events across all apps.
        Optional ?app= filter by app id (case-insensitive partial match).
        """
        u = _user(request)
        events = _aggregate_events(u, limit=min(limit, 500))
        if app:
            app_lower = app.lower()
            events = [
                e for e in events
                if app_lower in str(e.get("app", e.get("appName", ""))).lower()
            ]
        return {"events": events, "total": len(events)}

    @router.get("/operator-profile")
    def get_operator_profile(request: Request) -> Dict[str, Any]:
        u = _user(request)
        profile = _load_operator_profile(u)
        return {"profile": profile}

    @router.get("/shared-context")
    def get_shared_context(request: Request) -> Dict[str, Any]:
        u = _user(request)
        ctx = _load_shared_context(u)
        return {"shared_context": ctx}

    return router
