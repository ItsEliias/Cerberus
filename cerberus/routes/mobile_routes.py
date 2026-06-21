"""Mobile-optimised endpoints for the CerberusAndroid client.

Three routes:

  GET  /api/mobile/summary
       Single round-trip for the Android dashboard. Five sub-fetches run
       concurrently via asyncio.gather(return_exceptions=True); any
       individual failure yields ``null`` for that key so a broken sub-system
       can't blank the whole dashboard.

  GET  /api/mobile/threads?agent_id={id}&limit=20
       Recent threads, newest first. agent_id is optional — when omitted the
       caller sees all of their threads.

  GET  /api/mobile/thread/{thread_id}/messages?limit=50&before={message_id}
       Cursor-paginated messages. Cursor is the id of a previously-returned
       message; the response carries `next_before` for the next page.

All three are owner-only (``require_user`` → HTTPException 401 if absent).
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import desc, nullslast

import uuid
from datetime import datetime, timezone

from pydantic import BaseModel

from core.database import (
    AgentMessage,
    AgentThread,
    CerberusAgent,
    PushToken,
    SessionLocal,
)
from src.auth_helpers import require_user


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


_VALID_PLATFORMS = {"android", "ios"}


class PushTokenBody(BaseModel):
    token: str
    platform: str
    device_id: str

logger = logging.getLogger(__name__)

# Preview length cap for the thread-listing preview field. Spec: 100 chars.
_THREAD_PREVIEW_CHARS = 100


# ── Sub-fetch helpers (each catches its own exceptions → null on failure) ──

async def _fetch_profile(owner: str) -> Optional[Dict[str, Any]]:
    try:
        from routes.profile_routes import _load_profile
        # _load_profile is sync; nothing in it blocks long enough to need
        # `to_thread`, but we keep it consistent with the other sub-fetches.
        return await asyncio.to_thread(_load_profile, owner)
    except Exception as exc:
        logger.warning("mobile.summary: profile fetch failed: %s", exc)
        return None


async def _fetch_agents(owner: str) -> Optional[List[Dict[str, Any]]]:
    def _query() -> List[Dict[str, Any]]:
        db = SessionLocal()
        try:
            rows = (
                db.query(CerberusAgent)
                .filter(
                    CerberusAgent.owner == owner,
                    CerberusAgent.is_suppressed.is_(False),
                )
                .order_by(CerberusAgent.name.asc())
                .all()
            )
            # Project to the small mobile-card shape — id/name/avatar/status/
            # invocation_count. NOT to_dict() because the full payload is
            # 14+ keys including the system prompt; surfacing that to mobile
            # would balloon the response by ~5x with data the dashboard
            # doesn't render.
            return [
                {
                    "id": r.id,
                    "name": r.name,
                    "avatar": r.avatar or "",
                    "status": r.status or "idle",
                    "invocation_count": r.invocation_count or 0,
                }
                for r in rows
            ]
        finally:
            db.close()

    try:
        return await asyncio.to_thread(_query)
    except Exception as exc:
        logger.warning("mobile.summary: agents fetch failed: %s", exc)
        return None


async def _fetch_activity(owner: str, days: int = 7) -> Optional[Dict[str, Any]]:
    try:
        # The activity route's handler does the heavy lifting; call it
        # directly so we get the exact same shape Android already knows.
        # It's a sync handler that takes a Request; build a minimal stub.
        from routes.activity_routes import setup_activity_routes

        # Pull the GET /activity endpoint out of the router. Cheaper than
        # spinning up the full FastAPI app per summary call.
        router = setup_activity_routes()
        for route in router.routes:
            if getattr(route, "path", None) == "/api/stats/activity":
                endpoint = route.endpoint
                break
        else:
            return None

        # The route reads `require_user(request)`; we already authenticated
        # at /api/mobile/summary, so build a stub that carries the same user.
        from types import SimpleNamespace
        req_stub = SimpleNamespace(state=SimpleNamespace(current_user=owner))
        return await asyncio.to_thread(endpoint, req_stub, days)
    except Exception as exc:
        logger.warning("mobile.summary: activity fetch failed: %s", exc)
        return None


async def _fetch_pending_count() -> Optional[int]:
    try:
        from src import agent_approval as _aa
        return await asyncio.to_thread(_aa.count_pending)
    except Exception as exc:
        logger.warning("mobile.summary: pending-count fetch failed: %s", exc)
        return None


async def _fetch_gateway_status() -> Optional[Dict[str, Any]]:
    try:
        from routes.gateway_status_routes import _platform_state, _allowlist_count
        platforms = _platform_state()
        email_count = _allowlist_count()
        return {
            "platforms": platforms,
            "email_enabled": email_count > 0,
        }
    except Exception as exc:
        logger.warning("mobile.summary: gateway-status fetch failed: %s", exc)
        return None


# ── Router ─────────────────────────────────────────────────────────────────

def setup_mobile_routes() -> APIRouter:
    """Factory for the mobile-API router. Mounted under /api/mobile."""

    router = APIRouter(prefix="/api/mobile", tags=["mobile"])

    # ────────── GET /api/mobile/summary ──────────

    @router.get("/summary")
    async def mobile_summary(request: Request) -> Dict[str, Any]:
        owner = require_user(request)

        # asyncio.gather with return_exceptions=True keeps the dashboard up
        # even when one sub-system is down. Each sub-fetch already catches
        # its own exceptions internally → None on failure; gather is here
        # only to run them concurrently.
        profile, agents, activity, pending, gw_status = await asyncio.gather(
            _fetch_profile(owner),
            _fetch_agents(owner),
            _fetch_activity(owner, days=7),
            _fetch_pending_count(),
            _fetch_gateway_status(),
            return_exceptions=False,
        )

        return {
            "profile": profile,
            "agents": agents,
            "activity": activity,
            "pending_approvals": pending,
            "gateway_status": gw_status,
        }

    # ────────── GET /api/mobile/threads ──────────

    @router.get("/threads")
    def mobile_threads(
        request: Request,
        agent_id: Optional[str] = Query(None),
        limit: int = Query(20, ge=1, le=200),
    ) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            q = db.query(AgentThread).filter(AgentThread.owner == owner)
            if agent_id:
                q = q.filter(AgentThread.agent_id == agent_id)
            # Newest first: prefer last_message_at, fall back to created_at
            # for brand-new empty threads. SQLite doesn't support NULLS LAST
            # natively, but nullslast(desc(...)) renders the right thing on
            # PostgreSQL and is harmless on SQLite (sorted by COALESCE in
            # query plans).
            q = q.order_by(nullslast(desc(AgentThread.last_message_at)), desc(AgentThread.created_at))
            threads = q.limit(limit).all()

            # Bulk-fetch agent names so we can use them as thread titles
            # (AgentThread has no title field).
            agent_ids = {t.agent_id for t in threads if t.agent_id}
            names: Dict[str, str] = {}
            if agent_ids:
                for a in (
                    db.query(CerberusAgent.id, CerberusAgent.name)
                    .filter(CerberusAgent.id.in_(agent_ids))
                    .all()
                ):
                    names[a.id] = a.name

            # Bulk-fetch last message previews — one query per thread is
            # wasteful at scale; project the latest AgentMessage per thread.
            previews: Dict[str, str] = {}
            thread_ids = [t.id for t in threads]
            if thread_ids:
                # ORDER BY thread_id, timestamp DESC + Python-side first-per-thread
                # is correct on SQLite (no DISTINCT ON). Cheap because limit
                # caps the page at 200.
                msg_rows = (
                    db.query(AgentMessage.thread_id, AgentMessage.content)
                    .filter(AgentMessage.thread_id.in_(thread_ids))
                    .order_by(AgentMessage.thread_id.asc(), desc(AgentMessage.timestamp))
                    .all()
                )
                for tid, content in msg_rows:
                    if tid not in previews:
                        previews[tid] = (content or "")[:_THREAD_PREVIEW_CHARS]

            return {
                "threads": [
                    {
                        "id": t.id,
                        "title": names.get(t.agent_id) or "(unknown agent)",
                        "message_count": t.message_count or 0,
                        "last_message_at": (
                            t.last_message_at.isoformat() + "Z"
                            if t.last_message_at else None
                        ),
                        "last_message_preview": previews.get(t.id, ""),
                    }
                    for t in threads
                ]
            }
        finally:
            db.close()

    # ────────── GET /api/mobile/thread/{id}/messages ──────────

    @router.get("/thread/{thread_id}/messages")
    def mobile_thread_messages(
        request: Request,
        thread_id: str,
        limit: int = Query(50, ge=1, le=200),
        before: Optional[str] = Query(None),
    ) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            thread = (
                db.query(AgentThread)
                .filter(AgentThread.id == thread_id)
                .first()
            )
            if not thread:
                raise HTTPException(404, "Thread not found")
            # Owner-scope: a caller can only read their own threads. We
            # 404 (not 403) so the existence of a foreign thread isn't
            # leaked through the response code.
            if owner and thread.owner != owner:
                raise HTTPException(404, "Thread not found")

            # Cursor pagination — `before` is the id of a previously-returned
            # message; we filter strictly older messages. Offset-based
            # pagination breaks the moment a new message arrives (page 2
            # would repeat one row); cursors are stable across writes.
            q = db.query(AgentMessage).filter(AgentMessage.thread_id == thread_id)
            if before:
                cursor_msg = (
                    db.query(AgentMessage)
                    .filter(AgentMessage.id == before)
                    .first()
                )
                if cursor_msg is not None:
                    q = q.filter(AgentMessage.timestamp < cursor_msg.timestamp)
                # If the cursor message no longer exists (deleted), we treat
                # the request as a fresh first page rather than 400'ing — the
                # client can recover by paging again from the top.

            # Fetch limit+1 to know whether more pages exist. Newest first.
            rows = q.order_by(desc(AgentMessage.timestamp)).limit(limit + 1).all()
            has_more = len(rows) > limit
            page = rows[:limit]
            next_before = page[-1].id if (has_more and page) else None

            return {
                "messages": [
                    {
                        "id": m.id,
                        "role": m.role,
                        "content": m.content,
                        "timestamp": m.timestamp.isoformat() + "Z" if m.timestamp else None,
                    }
                    for m in page
                ],
                "has_more": has_more,
                "next_before": next_before,
            }
        finally:
            db.close()

    # ── Push notification tokens ──────────────────────────────────────────
    # The raw FCM/APNs token is sensitive — we accept it on POST, persist
    # it, and NEVER return it on the GET list endpoint. Upsert is keyed by
    # (owner, device_id) so a device that rotates its token (Android does
    # this every ~30 days) updates in place instead of stacking rows.

    @router.post("/push-token")
    def upsert_push_token(
        request: Request, body: PushTokenBody,
    ) -> Dict[str, Any]:
        owner = require_user(request)
        token = (body.token or "").strip()
        platform = (body.platform or "").strip().lower()
        device_id = (body.device_id or "").strip()
        if not token or not device_id:
            raise HTTPException(400, "token and device_id are required")
        if platform not in _VALID_PLATFORMS:
            raise HTTPException(
                400, f"platform must be one of: {', '.join(sorted(_VALID_PLATFORMS))}",
            )

        now = _utcnow_naive()
        db = SessionLocal()
        try:
            existing = (
                db.query(PushToken)
                .filter(
                    PushToken.owner == owner,
                    PushToken.device_id == device_id,
                )
                .first()
            )
            if existing:
                existing.token = token
                existing.platform = platform
                existing.last_seen_at = now
                db.commit()
                return {
                    "id": existing.id,
                    "device_id": existing.device_id,
                    "platform": existing.platform,
                    "created_at": existing.created_at.isoformat()
                                  if existing.created_at else None,
                    "last_seen_at": now.isoformat(),
                    "updated": True,
                }
            row = PushToken(
                id=str(uuid.uuid4()),
                owner=owner,
                token=token,
                platform=platform,
                device_id=device_id,
                created_at=now,
                last_seen_at=now,
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            return {
                "id": row.id,
                "device_id": row.device_id,
                "platform": row.platform,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "last_seen_at": now.isoformat(),
                "updated": False,
            }
        finally:
            db.close()

    @router.get("/push-tokens")
    def list_push_tokens(request: Request) -> Dict[str, Any]:
        """List owner's registered devices. Raw `token` field is never
        returned — only `device_id`, `platform`, `last_seen_at`."""
        owner = require_user(request)
        db = SessionLocal()
        try:
            rows = (
                db.query(PushToken)
                .filter(PushToken.owner == owner)
                .order_by(PushToken.last_seen_at.desc().nullslast())
                .all()
            )
            return {
                "tokens": [
                    {
                        "device_id": r.device_id,
                        "platform": r.platform,
                        "last_seen_at": r.last_seen_at.isoformat()
                                        if r.last_seen_at else None,
                    }
                    for r in rows
                ],
            }
        finally:
            db.close()

    @router.delete("/push-token/{device_id}")
    def delete_push_token(
        device_id: str, request: Request,
    ) -> Dict[str, Any]:
        owner = require_user(request)
        device_id = (device_id or "").strip()
        if not device_id:
            raise HTTPException(400, "device_id is required")
        db = SessionLocal()
        try:
            removed = (
                db.query(PushToken)
                .filter(
                    PushToken.owner == owner,
                    PushToken.device_id == device_id,
                )
                .delete(synchronize_session=False)
            )
            db.commit()
            if not removed:
                raise HTTPException(404, "device not registered")
            return {"deleted": device_id}
        finally:
            db.close()

    return router
