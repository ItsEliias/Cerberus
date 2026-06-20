"""Search routes — /api/search/config GET, /api/search POST,
plus /api/search/history and /api/search/saved CRUD added in the
Search Improvements PR.
"""

import logging
import uuid
from typing import Dict, Any, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import time

from core.database import SavedSearch, SearchHistory, SessionLocal
from services.search import get_search_config, comprehensive_web_search, PROVIDER_INFO
from services.search.core import _call_provider
from services.search.providers import _get_provider_key, _get_search_instance
from src.auth_helpers import get_current_user, require_user

logger = logging.getLogger(__name__)


# ── Search-history recording ────────────────────────────────────────────────
#
# Called from every successful search handler below. Best-effort: a write
# failure must NEVER propagate to the caller — the user still gets their
# results, we just lose the audit row. Owner can be None when auth is
# disabled (single-user mode); we store it that way and the GET endpoint
# returns the same null-owner bucket.

def _record_search_history(
    owner: Optional[str], query: str, result_count: int, source: str,
) -> None:
    q = (query or "").strip()
    if not q:
        return
    db = None
    try:
        db = SessionLocal()
        db.add(SearchHistory(
            id=str(uuid.uuid4()),
            owner=owner,
            query=q,
            result_count=int(result_count or 0),
            source=(source or "").strip() or None,
        ))
        db.commit()
    except Exception as exc:
        logger.warning("_record_search_history failed: %s", exc)
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass


def _history_dict(row: SearchHistory) -> Dict[str, Any]:
    return {
        "id": row.id,
        "query": row.query,
        "result_count": row.result_count or 0,
        "timestamp": row.timestamp.isoformat() if row.timestamp else None,
        "source": row.source,
    }


def _saved_dict(row: SavedSearch) -> Dict[str, Any]:
    return {
        "id": row.id,
        "query": row.query,
        "label": row.label,
        "timestamp": row.timestamp.isoformat() if row.timestamp else None,
    }


class SavedSearchCreate(BaseModel):
    query: str
    label: Optional[str] = None


async def _request_values(request: Request) -> Dict[str, Any]:
    """Accept JSON, form data, or query params for search endpoints.

    The browser UI posts FormData, while the agent's generic app_api tool
    posts JSON. FastAPI Form(...) rejects JSON with a 422 before our handler
    runs, which made the model think SearXNG was broken.
    """
    values: Dict[str, Any] = dict(request.query_params)
    content_type = (request.headers.get("content-type") or "").lower()
    try:
        if "application/json" in content_type:
            body = await request.json()
            if isinstance(body, dict):
                values.update(body)
        else:
            form = await request.form()
            values.update(dict(form))
    except Exception:
        pass
    return values


def setup_search_routes(config) -> APIRouter:
    router = APIRouter(tags=["search"])

    @router.get("/api/search/config")
    async def get_search_settings() -> Dict[str, Any]:
        return get_search_config()

    @router.post("/api/search")
    async def do_web_search(request: Request) -> Dict[str, Any]:
        """Standalone web search — returns context string + source list.

        Used by Compare mode to pre-search once and share results across panes.
        """
        values = await _request_values(request)
        query = str(values.get("query") or values.get("q") or "").strip()
        if not query:
            return {"context": "", "sources": [], "error": "query is required"}
        time_filter = values.get("time_filter") or values.get("freshness")
        if time_filter is not None:
            time_filter = str(time_filter).strip() or None
        try:
            context, sources = comprehensive_web_search(
                query, return_sources=True, time_filter=time_filter,
            )
            _record_search_history(
                get_current_user(request), query,
                len(sources or []), source="web",
            )
            return {"context": context, "sources": sources}
        except Exception as e:
            logger.error(f"Standalone web search failed: {e}")
            return {"context": "", "sources": [], "error": str(e)}

    @router.get("/api/search/providers")
    async def list_search_providers():
        """Return available search providers with config status."""
        providers = []
        for pid, (label, needs_key, needs_url) in PROVIDER_INFO.items():
            if pid == "disabled":
                continue
            available = True
            if needs_key and not _get_provider_key(pid):
                available = False
            if needs_url and pid == "searxng" and not _get_search_instance():
                available = False
            providers.append({
                "id": pid,
                "label": label,
                "available": available,
            })
        return providers

    @router.post("/api/search/query")
    async def search_with_provider(request: Request) -> Dict[str, Any]:
        """Search using a specific provider. Used by compare search mode."""
        values = await _request_values(request)
        query = str(values.get("query") or values.get("q") or "").strip()
        provider = str(values.get("provider") or "").strip()
        try:
            count = int(values.get("count") or values.get("limit") or 10)
        except Exception:
            count = 10
        if not query:
            return {"results": [], "provider": provider, "error": "query is required"}
        if provider not in PROVIDER_INFO or provider == "disabled":
            return {"results": [], "provider": provider, "error": "Unknown provider"}
        t0 = time.time()
        try:
            results = _call_provider(provider, query, min(count, 20))
            elapsed = round(time.time() - t0, 2)
            _record_search_history(
                get_current_user(request), query,
                len(results or []), source=provider,
            )
            return {"results": results, "provider": provider, "time": elapsed}
        except Exception as e:
            elapsed = round(time.time() - t0, 2)
            logger.error(f"Search provider {provider} failed: {e}")
            return {"results": [], "provider": provider, "time": elapsed, "error": str(e)}

    # ── Search history ─────────────────────────────────────────────────────

    @router.get("/api/search/history")
    def list_search_history(request: Request, limit: int = 20) -> Dict[str, Any]:
        owner = require_user(request)
        try:
            limit = max(1, min(int(limit), 200))
        except (TypeError, ValueError):
            limit = 20
        db = SessionLocal()
        try:
            rows = (
                db.query(SearchHistory)
                .filter(SearchHistory.owner == owner)
                .order_by(SearchHistory.timestamp.desc())
                .limit(limit)
                .all()
            )
            return {"history": [_history_dict(r) for r in rows]}
        finally:
            db.close()

    @router.delete("/api/search/history/{entry_id}")
    def delete_search_history_entry(entry_id: str, request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            row = (
                db.query(SearchHistory)
                .filter(
                    SearchHistory.id == entry_id,
                    SearchHistory.owner == owner,
                )
                .first()
            )
            if not row:
                raise HTTPException(404, "Search history entry not found")
            db.delete(row)
            db.commit()
            return {"deleted": entry_id}
        finally:
            db.close()

    @router.delete("/api/search/history")
    def clear_search_history(request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            removed = (
                db.query(SearchHistory)
                .filter(SearchHistory.owner == owner)
                .delete(synchronize_session=False)
            )
            db.commit()
            return {"removed": int(removed or 0)}
        finally:
            db.close()

    # ── Saved searches ─────────────────────────────────────────────────────

    @router.get("/api/search/saved")
    def list_saved_searches(request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            rows = (
                db.query(SavedSearch)
                .filter(SavedSearch.owner == owner)
                .order_by(SavedSearch.timestamp.desc())
                .all()
            )
            return {"saved": [_saved_dict(r) for r in rows]}
        finally:
            db.close()

    @router.post("/api/search/saved")
    def create_saved_search(
        request: Request, body: SavedSearchCreate,
    ) -> Dict[str, Any]:
        owner = require_user(request)
        query = (body.query or "").strip()
        if not query:
            raise HTTPException(400, "query is required")
        label = (body.label or "").strip() or None
        db = SessionLocal()
        try:
            row = SavedSearch(
                id=str(uuid.uuid4()),
                owner=owner,
                query=query,
                label=label,
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            return _saved_dict(row)
        finally:
            db.close()

    @router.delete("/api/search/saved/{entry_id}")
    def delete_saved_search(entry_id: str, request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            row = (
                db.query(SavedSearch)
                .filter(
                    SavedSearch.id == entry_id,
                    SavedSearch.owner == owner,
                )
                .first()
            )
            if not row:
                raise HTTPException(404, "Saved search not found")
            db.delete(row)
            db.commit()
            return {"deleted": entry_id}
        finally:
            db.close()

    return router
