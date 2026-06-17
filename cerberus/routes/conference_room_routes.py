"""Conference Room routes — ORCHESTRATOR-routed multi-agent rooms.

Endpoints (all require auth):
  GET    /api/rooms                   — list owner's rooms
  POST   /api/rooms                   — create room {name, participant_ids}
  GET    /api/rooms/{id}              — room detail + message history
  PATCH  /api/rooms/{id}              — update name / participant_ids / mode / round_cap
  DELETE /api/rooms/{id}              — delete room + messages
  POST   /api/rooms/{id}/send         — send message → SSE stream (routed or open mode)
  POST   /api/rooms/{id}/continue     — continue open discussion for another cap turns
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.database import ConferenceRoom, RoomMessage, CerberusAgent, SessionLocal
from src.auth_helpers import require_user

logger = logging.getLogger(__name__)

_VALID_MODES = {"routed", "open"}
MAX_CAP = 20


class RoomCreate(BaseModel):
    name: str
    participant_ids: List[str] = []


class RoomPatch(BaseModel):
    name: Optional[str] = None
    participant_ids: Optional[List[str]] = None
    mode: Optional[str] = None        # 'routed' | 'open'
    round_cap: Optional[int] = None   # 1-20


class RoomSend(BaseModel):
    message: str


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _save_room_message(
    room_id: str, role: str, sender_id: Optional[str],
    sender_name: Optional[str], content: str,
) -> None:
    db = SessionLocal()
    try:
        room = db.query(ConferenceRoom).filter(ConferenceRoom.id == room_id).first()
        if not room or not content.strip():
            return
        db.add(RoomMessage(
            id=str(uuid.uuid4()), room_id=room_id,
            role=role, sender_id=sender_id,
            sender_name=sender_name, content=content,
        ))
        room.message_count = (room.message_count or 0) + 1
        room.last_message_at = _utcnow()
        db.commit()
    except Exception as exc:
        logger.warning("_save_room_message failed: %s", exc)
    finally:
        db.close()


async def _route_message(agents: list, message: str, owner: str):
    """Choose which agent should respond (used by both routes and engine).

    If ORCHESTRATOR is a participant and others exist, ask it to route via LLM.
    Falls back to first non-ORCHESTRATOR participant (or first agent).
    Returns (target_agent, route_note).
    """
    if not agents:
        return None, ""

    orchestrator = next((a for a in agents if a.name == "ORCHESTRATOR"), None)
    others = [a for a in agents if a.name != "ORCHESTRATOR"]

    if not orchestrator or not others:
        return (others[0] if others else agents[0]), ""

    names = ", ".join(a.name for a in others)
    routing_msgs = [
        {
            "role": "system",
            "content": (
                f"You are a routing controller. Available agents: {names}. "
                "Given the user's message, respond with exactly one line: ROUTE:<AGENT_NAME>"
            ),
        },
        {"role": "user", "content": message},
    ]

    from routes.cerberus_agent_routes import _resolve_agent_endpoint
    url, model, headers = _resolve_agent_endpoint(orchestrator.model_alias, owner)
    if not url or not model:
        return others[0], ""

    try:
        from src.llm_core import llm_call_async
        decision = await llm_call_async(url, model, routing_msgs, headers=headers, max_tokens=32)
        decision = (decision or "").strip()
        if decision.upper().startswith("ROUTE:"):
            target_name = decision[6:].strip().upper()
            target = next((a for a in others if a.name == target_name), None)
            if target:
                return target, decision
    except Exception as exc:
        logger.debug("ORCHESTRATOR routing failed: %s", exc)

    return others[0], ""


def setup_conference_room_routes() -> APIRouter:
    router = APIRouter(prefix="/api/rooms", tags=["conference-rooms"])

    # ---- List ----
    @router.get("")
    def list_rooms(request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            rooms = (
                db.query(ConferenceRoom)
                .filter(ConferenceRoom.owner == owner)
                .order_by(ConferenceRoom.last_message_at.desc().nullslast(),
                          ConferenceRoom.created_at.desc())
                .all()
            )
            return {"rooms": [_room_dict(r) for r in rooms]}
        finally:
            db.close()

    # ---- Create ----
    @router.post("")
    def create_room(request: Request, body: RoomCreate) -> Dict[str, Any]:
        owner = require_user(request)
        name = (body.name or "").strip()
        if not name:
            raise HTTPException(400, "Room name is required")
        db = SessionLocal()
        try:
            room = ConferenceRoom(
                id=str(uuid.uuid4()), name=name, owner=owner,
                participant_ids=json.dumps(body.participant_ids or []),
            )
            db.add(room)
            db.commit()
            db.refresh(room)
            return _room_dict(room)
        finally:
            db.close()

    # ---- Detail ----
    @router.get("/{room_id}")
    def get_room(room_id: str, request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            room = _get_room_or_404(db, room_id, owner)
            msgs = [_msg_dict(m) for m in room.messages]
            return {**_room_dict(room), "messages": msgs}
        finally:
            db.close()

    # ---- Update ----
    @router.patch("/{room_id}")
    def patch_room(room_id: str, request: Request, body: RoomPatch) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            room = _get_room_or_404(db, room_id, owner)
            if body.name is not None:
                name = body.name.strip()
                if not name:
                    raise HTTPException(400, "Room name cannot be empty")
                room.name = name
            if body.participant_ids is not None:
                room.participant_ids = json.dumps(body.participant_ids)
            if body.mode is not None:
                if body.mode not in _VALID_MODES:
                    raise HTTPException(400, f"mode must be one of: {', '.join(_VALID_MODES)}")
                room.mode = body.mode
            if body.round_cap is not None:
                cap = int(body.round_cap)
                if cap < 1 or cap > MAX_CAP:
                    raise HTTPException(400, f"round_cap must be between 1 and {MAX_CAP}")
                room.round_cap = cap
            db.commit()
            db.refresh(room)
            return _room_dict(room)
        except HTTPException:
            raise
        except Exception as exc:
            db.rollback()
            raise HTTPException(500, str(exc))
        finally:
            db.close()

    # ---- Delete ----
    @router.delete("/{room_id}")
    def delete_room(room_id: str, request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            room = _get_room_or_404(db, room_id, owner)
            db.delete(room)
            db.commit()
            return {"deleted": room_id}
        except HTTPException:
            raise
        except Exception as exc:
            db.rollback()
            raise HTTPException(500, str(exc))
        finally:
            db.close()

    # ---- Send ----
    @router.post("/{room_id}/send")
    async def send_to_room(
        room_id: str, request: Request, body: RoomSend,
    ) -> StreamingResponse:
        owner = require_user(request)
        text = (body.message or "").strip()
        if not text:
            raise HTTPException(400, "Message is required")

        db = SessionLocal()
        try:
            room = _get_room_or_404(db, room_id, owner)
            pids = json.loads(room.participant_ids or "[]")
            agents = (
                db.query(CerberusAgent).filter(CerberusAgent.id.in_(pids)).all()
            ) if pids else []
            mode = getattr(room, "mode", None) or "routed"
            cap  = _effective_cap(room)
            room_snap = room  # room object still valid within this try block
            db.add(RoomMessage(
                id=str(uuid.uuid4()), room_id=room_id,
                role="user", sender_name="USER", content=text,
            ))
            room.message_count = (room.message_count or 0) + 1
            room.last_message_at = _utcnow()
            db.commit()
        finally:
            db.close()

        from routes.conference_room_engine import routed_stream, open_stream

        async def _generate():
            if not agents:
                yield f'event: error\ndata: {json.dumps({"error": "Room has no participants."})}\n\n'
                return
            if mode == "open":
                async for chunk in open_stream(room_id, room_snap, agents, text, owner, cap, SessionLocal):
                    yield chunk
            else:
                async for chunk in routed_stream(room_id, room_snap, agents, text, owner, SessionLocal):
                    yield chunk

        return StreamingResponse(_generate(), media_type="text/event-stream")

    # ---- Continue (open mode only) ----
    @router.post("/{room_id}/continue")
    async def continue_room(room_id: str, request: Request) -> StreamingResponse:
        """Resume open discussion for another cap turns, using transcript as context."""
        owner = require_user(request)
        db = SessionLocal()
        try:
            room = _get_room_or_404(db, room_id, owner)
            pids = json.loads(room.participant_ids or "[]")
            agents = (
                db.query(CerberusAgent).filter(CerberusAgent.id.in_(pids)).all()
            ) if pids else []
            cap = _effective_cap(room)
            # Use the last user message from transcript as the user_text for agent context
            last_user = (
                db.query(RoomMessage)
                .filter(RoomMessage.room_id == room_id, RoomMessage.role == "user")
                .order_by(RoomMessage.timestamp.desc())
                .first()
            )
            user_text = last_user.content if last_user else ""
        finally:
            db.close()

        from routes.conference_room_engine import open_stream

        async def _generate():
            if not agents:
                yield f'event: error\ndata: {json.dumps({"error": "Room has no participants."})}\n\n'
                return
            if not user_text:
                yield f'event: error\ndata: {json.dumps({"error": "No prior message to continue."})}\n\n'
                return
            async for chunk in open_stream(room_id, None, agents, user_text, owner, cap, SessionLocal):
                yield chunk

        return StreamingResponse(_generate(), media_type="text/event-stream")

    return router


# ---- Helpers ----

def _get_room_or_404(db, room_id: str, owner: str) -> ConferenceRoom:
    room = db.query(ConferenceRoom).filter(ConferenceRoom.id == room_id).first()
    if not room:
        raise HTTPException(404, "Room not found")
    if room.owner != owner:
        raise HTTPException(403, "Not your room")
    return room


def _effective_cap(room) -> int:
    from routes.conference_room_engine import effective_cap
    return effective_cap(room)


def _room_dict(room: ConferenceRoom) -> Dict[str, Any]:
    return {
        "id": room.id,
        "name": room.name,
        "owner": room.owner,
        "participant_ids": json.loads(room.participant_ids or "[]"),
        "created_at": room.created_at.isoformat() if room.created_at else None,
        "last_message_at": room.last_message_at.isoformat() if room.last_message_at else None,
        "message_count": room.message_count or 0,
        "mode": getattr(room, "mode", None) or "routed",
        "round_cap": getattr(room, "round_cap", None) or 5,
        "total_input_tokens": getattr(room, "total_input_tokens", None) or 0,
        "total_output_tokens": getattr(room, "total_output_tokens", None) or 0,
    }


def _msg_dict(msg: RoomMessage) -> Dict[str, Any]:
    return {
        "id": msg.id,
        "role": msg.role,
        "sender_id": msg.sender_id,
        "sender_name": msg.sender_name or msg.role.upper(),
        "content": msg.content,
        "timestamp": msg.timestamp.isoformat() if msg.timestamp else None,
    }
