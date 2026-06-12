"""Claude (Subscription) provider setup and preflight routes.

This provider uses no API key and no OAuth device flow — authentication is
already handled by the user's local Claude Code installation.

Routes:
  POST /api/claude-subscription/provision  — Create or update the endpoint row.
  GET  /api/claude-subscription/status     — Preflight check (binary + auth).
  DELETE /api/claude-subscription/remove   — Remove the endpoint row.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from core.database import ModelEndpoint, SessionLocal
from src.auth_helpers import get_current_user
from src.claude_subscription import (
    CLAUDE_SUBSCRIPTION_PROVIDER,
    CLAUDE_SUBSCRIPTION_SENTINEL_URL,
    preflight_check,
)

logger = logging.getLogger(__name__)

_MODELS = ["opus", "sonnet", "haiku", "fable"]


def _get_endpoint(db, owner: Optional[str]) -> Optional[ModelEndpoint]:
    """Return the claude-subscription ModelEndpoint for this owner, if any."""
    q = db.query(ModelEndpoint).filter(
        ModelEndpoint.base_url == CLAUDE_SUBSCRIPTION_SENTINEL_URL,
    )
    if owner:
        from src.auth_helpers import owner_filter
        q = owner_filter(q, ModelEndpoint, owner)
    return q.first()


def setup_claude_subscription_routes() -> APIRouter:
    router = APIRouter(prefix="/api/claude-subscription", tags=["claude-subscription"])

    @router.get("/status")
    def status(request: Request):
        """Preflight check: is Claude Code installed and the user logged in?

        Also includes a `provisioned` field indicating whether the endpoint
        row has already been added to this user's model list.
        """
        owner = get_current_user(request) or None
        result = preflight_check()
        # Augment with provisioned state so the Settings card can show the
        # correct button state without a separate /api/model-endpoints fetch.
        db = SessionLocal()
        try:
            ep = _get_endpoint(db, owner)
            result["provisioned"] = ep is not None and bool(ep.is_enabled)
            result["logged_in"] = result.get("ok") or False
        finally:
            db.close()
        return result

    @router.post("/provision")
    def provision(request: Request):
        """Create or update the Claude (Subscription) ModelEndpoint row.

        No API key is required.  The endpoint uses the sentinel URL that
        the provider dispatcher recognises as the subprocess adapter.
        """
        owner = get_current_user(request) or None
        pre = preflight_check()
        if not pre["ok"]:
            raise HTTPException(
                503,
                f"{pre['error']} — {pre.get('action', 'Check Claude Code installation.')}",
            )

        db = SessionLocal()
        try:
            ep = _get_endpoint(db, owner)
            if ep is None:
                ep = ModelEndpoint(
                    id=str(uuid.uuid4())[:8],
                    name="Claude (Subscription)",
                    base_url=CLAUDE_SUBSCRIPTION_SENTINEL_URL,
                    model_type="llm",
                    endpoint_kind="api",
                    owner=owner,
                )
                db.add(ep)
            ep.name = "Claude (Subscription)"
            ep.base_url = CLAUDE_SUBSCRIPTION_SENTINEL_URL
            ep.api_key = None
            ep.is_enabled = True
            ep.supports_tools = False
            ep.model_type = "llm"
            ep.endpoint_kind = "api"
            ep.model_refresh_mode = "manual"
            ep.cached_models = json.dumps(_MODELS)
            db.commit()
            result = {
                "id": ep.id,
                "name": ep.name,
                "base_url": ep.base_url,
                "models": _MODELS,
            }
        finally:
            db.close()

        try:
            from routes.model_routes import _invalidate_models_cache
            _invalidate_models_cache()
        except Exception:
            pass

        return result

    @router.delete("/remove")
    def remove(request: Request):
        """Remove the Claude (Subscription) endpoint row."""
        owner = get_current_user(request) or None
        db = SessionLocal()
        try:
            ep = _get_endpoint(db, owner)
            if ep is None:
                raise HTTPException(404, "Claude Subscription endpoint not found.")
            db.delete(ep)
            db.commit()
        finally:
            db.close()

        try:
            from routes.model_routes import _invalidate_models_cache
            _invalidate_models_cache()
        except Exception:
            pass

        return {"ok": True}

    return router
