"""Gateway status route — snapshot of inbound-gateway state for the CC HUD.

  GET /api/gateway/status      — counts + recent activity (no per-request detail)
  GET /api/gateway/approvals   — per-pending request_id/tool/preview/created_at,
                                 the source-of-truth for the CC approval cards

Both endpoints are owner-only (require_user) and no-op tolerant — every
section degrades to a safe default rather than 500ing the dashboard.
"""

from __future__ import annotations

import datetime as _dt
import logging
import os
import time
from typing import Any, Dict, List

from fastapi import APIRouter, Request

from src.auth_helpers import require_user

logger = logging.getLogger(__name__)


# Platforms surfaced in the status block. Order = display order in the HUD.
_PLATFORM_ENVS = (
    ("discord", "DISCORD_BOT_TOKEN"),
    ("telegram", "TELEGRAM_BOT_TOKEN"),
    ("slack", "SLACK_BOT_TOKEN"),
)


def _platform_state() -> Dict[str, str]:
    """Map platform -> 'configured' | 'not_configured' based on bot tokens."""
    out: Dict[str, str] = {}
    for name, env in _PLATFORM_ENVS:
        out[name] = "configured" if os.environ.get(env, "").strip() else "not_configured"
    return out


def _allowlist_count() -> int:
    """Count of distinct addresses in GATEWAY_EMAIL_ALLOWLIST (zero when unset).

    Lowercased + de-duped to match the parsing in the approve endpoint."""
    raw = os.environ.get("GATEWAY_EMAIL_ALLOWLIST", "").strip()
    if not raw:
        return 0
    addrs = {p.strip().lower() for p in raw.split(",") if p.strip()}
    return len(addrs)


def _ago(seconds: float) -> str:
    """Render a "Xs/m/h/d ago" string for the activity feed."""
    s = max(0, int(seconds))
    if s < 60:
        return f"{s}s ago"
    if s < 3600:
        return f"{s // 60}m ago"
    if s < 86400:
        return f"{s // 3600}h ago"
    return f"{s // 86400}d ago"


def _serialize_recent(entries: List[dict]) -> List[Dict[str, Any]]:
    """Convert agent_approval entries into the dashboard activity-feed shape."""
    now = time.time()
    items: List[Dict[str, Any]] = []
    for e in entries:
        try:
            items.append({
                "tool": e.get("tool_name") or "",
                "status": e.get("status") or "",
                "ago": _ago(now - float(e.get("created_at") or now)),
            })
        except Exception:
            # Never let a single malformed entry 500 the whole dashboard fetch.
            continue
    return items


def _serialize_pending(entries: List[dict]) -> List[Dict[str, Any]]:
    """Convert pending agent_approval entries into the card-list shape.

    Returns request_id + tool + preview + created_at (ISO UTC, no offset)
    per entry. The preview is truncated to 2000 chars at store time; we
    cap again here at 400 so even a runaway preview can't blow up the
    SSE/HTTP body. Malformed entries are silently skipped — never let a
    single bad row 500 the whole approvals fetch."""
    items: List[Dict[str, Any]] = []
    for e in entries:
        try:
            ts = float(e.get("created_at") or 0)
            iso = (
                _dt.datetime.utcfromtimestamp(ts).isoformat() + "Z"
                if ts else ""
            )
            preview = e.get("preview") or ""
            if isinstance(preview, str) and len(preview) > 400:
                preview = preview[:400] + "…"
            items.append({
                "request_id": e.get("request_id") or "",
                "tool": e.get("tool_name") or "",
                "preview": preview,
                "created_at": iso,
            })
        except Exception:
            continue
    return items


def setup_gateway_status_routes() -> APIRouter:
    """Factory for the gateway-status router. Mounted on /api/gateway/status."""

    router = APIRouter(prefix="/api/gateway", tags=["gateway-status"])

    @router.get("/status")
    def gateway_status(request: Request) -> Dict[str, Any]:
        # Owner-only — the status snapshot includes config-state and pending
        # action counts; not for anonymous callers.
        require_user(request)

        platforms = _platform_state()
        gateway_enabled = any(v == "configured" for v in platforms.values())
        email_count = _allowlist_count()

        # Approval store reads degrade to zero/empty on any failure so the
        # dashboard always renders something.
        try:
            from src import agent_approval as _aa
            pending = _aa.count_pending()
            recent = _serialize_recent(_aa.list_recent_executed(limit=5))
        except Exception as exc:
            logger.warning("gateway_status: approval store read failed: %s", exc)
            pending = 0
            recent = []

        return {
            "gateway_enabled": gateway_enabled,
            "platforms": platforms,
            "email_allowlist_count": email_count,
            "email_enabled": email_count > 0,
            "pending_approvals": pending,
            "recent_approvals": recent,
        }

    @router.get("/approvals")
    def gateway_approvals(request: Request) -> Dict[str, Any]:
        """Full list of pending gateway approvals, newest first.

        Returns request_id + tool + preview + created_at per pending entry —
        the CC gateway tab uses this to render approve/reject cards. Use
        the PATCH/DELETE `/api/gateway/approve/{request_id}` endpoints to
        act on each card.
        """
        require_user(request)
        try:
            from src import agent_approval as _aa
            pending = _serialize_pending(_aa.list_all_pending())
        except Exception as exc:
            logger.warning("gateway_approvals: approval store read failed: %s", exc)
            pending = []
        return {"pending": pending}

    return router
