"""Conference Room routes — ORCHESTRATOR-routed multi-agent rooms.

Endpoints (all require auth):
  GET    /api/rooms                — list owner's rooms
  POST   /api/rooms                — create room {name, participant_ids}
  GET    /api/rooms/{id}           — room detail + message history
  PATCH  /api/rooms/{id}           — update name / participant_ids
  DELETE /api/rooms/{id}           — delete room + messages
  POST   /api/rooms/{id}/send      — send message → ORCHESTRATOR routes → SSE stream
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


class RoomCreate(BaseModel):
    name: str
    participant_ids: List[str] = []


class RoomPatch(BaseModel):
    name: Optional[str] = None
    participant_ids: Optional[List[str]] = None


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
    """Choose which agent should respond.

    If ORCHESTRATOR is a participant and there are other agents, ask it to route.
    Falls back to the first non-ORCHESTRATOR participant (or the first agent).
    Returns (target_agent, route_note).
    """
    if not agents:
        return None, ""

    orchestrator = next((a for a in agents if a.name == "ORCHESTRATOR"), None)
    others = [a for a in agents if a.name != "ORCHESTRATOR"]

    if not orchestrator or not others:
        return (others[0] if others else agents[0]), ""

    # Ask ORCHESTRATOR to pick a target
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
                db.query(CerberusAgent)
                .filter(CerberusAgent.id.in_(pids))
                .all()
            ) if pids else []

            # Persist user message immediately
            db.add(RoomMessage(
                id=str(uuid.uuid4()), room_id=room_id,
                role="user", sender_name="USER", content=text,
            ))
            room.message_count = (room.message_count or 0) + 1
            room.last_message_at = _utcnow()
            db.commit()
        finally:
            db.close()

        async def _generate():
            if not agents:
                yield (
                    f'event: error\ndata: {json.dumps({"error": "Room has no participants."})}\n\n'
                )
                return

            target, _note = await _route_message(agents, text, owner)
            if not target:
                yield f'event: error\ndata: {json.dumps({"error": "Routing failed."})}\n\n'
                return

            yield (
                f'event: route\ndata: {json.dumps({"agent": target.name, "agent_id": target.id})}\n\n'
            )

            from routes.cerberus_agent_routes import _resolve_agent_endpoint
            from src.llm_core import stream_llm

            url, model, headers = _resolve_agent_endpoint(target.model_alias, owner)
            if not url or not model:
                yield (
                    f'event: error\ndata: {json.dumps({"error": "No LLM provider configured."})}\n\n'
                )
                return

            messages = [
                {"role": "system", "content": target.system_prompt or ""},
                {"role": "user",   "content": text},
            ]
            parts: list[str] = []
            try:
                async for chunk in stream_llm(url, model, messages, headers=headers):
                    for line in chunk.split("\n"):
                        if line.startswith("data:") and "[DONE]" not in line:
                            try:
                                obj = json.loads(line[5:].strip())
                                if obj.get("type") != "usage":
                                    delta = (
                                        obj.get("delta") or obj.get("text")
                                        or obj.get("content") or ""
                                    )
                                    if delta:
                                        parts.append(delta)
                            except Exception:
                                pass
                    yield chunk
            except Exception as exc:
                yield f'event: error\ndata: {json.dumps({"error": str(exc)})}\n\n'
            finally:
                if parts:
                    _save_room_message(
                        room_id, "agent", target.id, target.name, "".join(parts)
                    )

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


def _room_dict(room: ConferenceRoom) -> Dict[str, Any]:
    return {
        "id": room.id,
        "name": room.name,
        "owner": room.owner,
        "participant_ids": json.loads(room.participant_ids or "[]"),
        "created_at": room.created_at.isoformat() if room.created_at else None,
        "last_message_at": room.last_message_at.isoformat() if room.last_message_at else None,
        "message_count": room.message_count or 0,
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
