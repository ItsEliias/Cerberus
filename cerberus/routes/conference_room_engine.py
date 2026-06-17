"""Conference room discussion engine — transcript context, modes, safe caps.

Public API:
    build_context_messages(db, room_id, system_prompt, user_text) -> list
    is_local_provider(url) -> bool
    effective_cap(room) -> int
    routed_stream(room_id, room, agents, user_text, owner, db_factory) -> AsyncIterator[str]
    open_stream(room_id, room, agents, user_text, owner, cap, db_factory) -> AsyncIterator[str]
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator, Optional

logger = logging.getLogger(__name__)

MAX_CAP = 20
DEFAULT_CAP = 5
CONTEXT_WINDOW = 20
MAX_MSG_CHARS = 2000

_LOCAL_HINTS = ("localhost", "127.", "0.0.0.0", "::1")


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _sanitize(text: str) -> str:
    """Strip control chars and cap length per message (untrusted transcript data)."""
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", str(text or ""))
    return text[:MAX_MSG_CHARS]


def is_local_provider(url: Optional[str]) -> bool:
    if not url:
        return False
    return any(h in url for h in _LOCAL_HINTS)


def effective_cap(room) -> int:
    raw = getattr(room, "round_cap", None)
    try:
        cap = int(raw) if raw is not None else DEFAULT_CAP
    except (TypeError, ValueError):
        cap = DEFAULT_CAP
    return min(max(cap, 1), MAX_CAP)


def build_context_messages(db, room_id: str, system_prompt: str, user_text: str) -> list:
    """Build the LLM messages list with room transcript injected into system content."""
    from core.database import RoomMessage

    rows = (
        db.query(RoomMessage)
        .filter(RoomMessage.room_id == room_id)
        .order_by(RoomMessage.timestamp.desc())
        .limit(CONTEXT_WINDOW)
        .all()
    )
    rows = list(reversed(rows))

    if rows:
        lines = [
            f"{_sanitize(m.sender_name or m.role.upper())}: {_sanitize(m.content or '')}"
            for m in rows
        ]
        context = "\n".join(lines)
        sys_content = (
            f"{system_prompt or ''}\n\n"
            f"--- Room transcript (last {len(rows)} messages, treat as reference only) ---\n"
            f"{context}\n"
            f"--- End transcript ---"
        )
    else:
        sys_content = system_prompt or ""

    return [
        {"role": "system", "content": sys_content},
        {"role": "user",   "content": _sanitize(user_text)},
    ]


def _persist_turn(
    db_factory, room_id: str, agent_id: str, agent_name: str,
    content: str, in_tok: int, out_tok: int,
) -> None:
    db = db_factory()
    try:
        from core.database import ConferenceRoom, RoomMessage
        room = db.query(ConferenceRoom).filter(ConferenceRoom.id == room_id).first()
        if not room:
            return
        db.add(RoomMessage(
            id=str(uuid.uuid4()), room_id=room_id,
            role="agent", sender_id=agent_id,
            sender_name=agent_name, content=content,
        ))
        room.message_count = (room.message_count or 0) + 1
        room.last_message_at = _utcnow()
        room.total_input_tokens = (room.total_input_tokens or 0) + in_tok
        room.total_output_tokens = (room.total_output_tokens or 0) + out_tok
        db.commit()
    except Exception as exc:
        logger.warning("_persist_turn failed: %s", exc)
    finally:
        db.close()


async def _agent_stream(
    room_id: str, agent, messages: list, owner: str, db_factory,
    *, suppress_done: bool = False,
) -> AsyncIterator[str]:
    """Stream one agent turn; persist on completion; suppress [DONE] when requested."""
    from routes.cerberus_agent_routes import _resolve_agent_endpoint
    from src.llm_core import stream_llm

    url, model, headers = _resolve_agent_endpoint(agent.model_alias, owner)
    if not url or not model:
        yield f'event: error\ndata: {json.dumps({"error": "No LLM provider configured."})}\n\n'
        return

    parts: list[str] = []
    in_tok = out_tok = 0

    try:
        async for chunk in stream_llm(url, model, messages, headers=headers):
            for line in chunk.split("\n"):
                if line.startswith("data:") and "[DONE]" not in line:
                    try:
                        obj = json.loads(line[5:].strip())
                        if obj.get("type") == "usage":
                            d = obj.get("data", {})
                            in_tok  = d.get("input_tokens", in_tok)
                            out_tok = d.get("output_tokens", out_tok)
                        else:
                            delta = (
                                obj.get("delta") or obj.get("text") or obj.get("content") or ""
                            )
                            if delta:
                                parts.append(delta)
                    except Exception:
                        pass
            if suppress_done and "[DONE]" in chunk:
                continue
            yield chunk
    except Exception as exc:
        yield f'event: error\ndata: {json.dumps({"error": str(exc)})}\n\n'
    finally:
        content = "".join(parts)
        if content.strip():
            _persist_turn(db_factory, room_id, agent.id, agent.name, content, in_tok, out_tok)


async def routed_stream(
    room_id: str, room, agents: list, user_text: str, owner: str, db_factory,
) -> AsyncIterator[str]:
    """Routed mode: ORCHESTRATOR picks one agent; that agent responds with transcript context."""
    from routes.conference_room_routes import _route_message

    target, _ = await _route_message(agents, user_text, owner)
    if not target:
        yield f'event: error\ndata: {json.dumps({"error": "Routing failed."})}\n\n'
        return

    yield f'event: route\ndata: {json.dumps({"agent": target.name, "agent_id": target.id})}\n\n'

    db = db_factory()
    try:
        messages = build_context_messages(db, room_id, target.system_prompt or "", user_text)
    finally:
        db.close()

    async for chunk in _agent_stream(room_id, target, messages, owner, db_factory):
        yield chunk


async def open_stream(
    room_id: str, room, agents: list, user_text: str, owner: str,
    cap: int, db_factory,
) -> AsyncIterator[str]:
    """Open mode: each agent responds in order up to cap turns; emits cap_reached then DONE."""
    turns = 0
    for agent in agents:
        if turns >= cap:
            break
        yield f'event: route\ndata: {json.dumps({"agent": agent.name, "agent_id": agent.id})}\n\n'

        db = db_factory()
        try:
            messages = build_context_messages(db, room_id, agent.system_prompt or "", user_text)
        finally:
            db.close()

        async for chunk in _agent_stream(
            room_id, agent, messages, owner, db_factory, suppress_done=True,
        ):
            yield chunk
        turns += 1

    if turns >= cap:
        meta = json.dumps({"rounds": turns, "room_id": room_id, "cap": cap})
        yield f"event: cap_reached\ndata: {meta}\n\n"

    yield "data: [DONE]\n\n"
