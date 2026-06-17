"""Conference room discussion engine — transcript context, modes, safe caps.

Public API:
    build_context_messages(db, room_id, system_prompt, user_text) -> list
    is_local_provider(url) -> bool
    effective_cap(room, agents=None, owner=None) -> int
    routed_stream(room_id, room, agents, user_text, owner, db_factory) -> AsyncIterator[str]
    open_stream(room_id, room, agents, user_text, owner, cap, db_factory) -> AsyncIterator[str]
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator, List, Optional, Tuple

logger = logging.getLogger(__name__)

MAX_CAP = 20
DEFAULT_CAP_LOCAL = 12   # higher default for free/local endpoints
DEFAULT_CAP_PAID  = 5    # conservative default for paid API endpoints
DEFAULT_CAP = DEFAULT_CAP_PAID   # backward-compat alias
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


def _provider_default_cap(agents: Optional[list], owner: Optional[str]) -> int:
    """Return provider-aware default: higher for local/free endpoints, lower for paid."""
    if not agents or not owner:
        return DEFAULT_CAP_PAID
    others = [a for a in agents if a.name != "ORCHESTRATOR"]
    check = others[0] if others else agents[0]
    try:
        from routes.cerberus_agent_routes import _resolve_agent_endpoint
        url, _, _ = _resolve_agent_endpoint(check.model_alias, owner)
        return DEFAULT_CAP_LOCAL if is_local_provider(url) else DEFAULT_CAP_PAID
    except Exception:
        return DEFAULT_CAP_PAID


def effective_cap(
    room, agents: Optional[list] = None, owner: Optional[str] = None,
) -> int:
    """Effective cap: explicit round_cap wins; else provider-aware default. Clamped 1-MAX_CAP."""
    raw = getattr(room, "round_cap", None)
    if raw is not None:
        try:
            return min(max(int(raw), 1), MAX_CAP)
        except (TypeError, ValueError):
            pass
    return min(_provider_default_cap(agents, owner), MAX_CAP)


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


async def _conduct_next_speaker(
    orchestrator,
    others: list,
    owner: str,
    room_id: str,
    user_text: str,
    db_factory,
) -> Tuple[Optional[object], bool]:
    """Ask ORCHESTRATOR which agent speaks next, or whether the discussion has converged.

    Returns (agent | None, converged: bool).
    ORCHESTRATOR replies ROUTE:<NAME> to pick a speaker or ROUTE:DONE to converge.
    Falls back to others[0] on error.
    """
    from routes.cerberus_agent_routes import _resolve_agent_endpoint
    from src.llm_core import llm_call_async

    url, model, headers = _resolve_agent_endpoint(orchestrator.model_alias, owner)
    if not url or not model:
        return (others[0] if others else None), False

    names = ", ".join(a.name for a in others)

    # Load recent transcript so ORCHESTRATOR sees what's been discussed
    db = db_factory()
    try:
        from core.database import RoomMessage
        rows = (
            db.query(RoomMessage)
            .filter(RoomMessage.room_id == room_id)
            .order_by(RoomMessage.timestamp.desc())
            .limit(10)
            .all()
        )
        transcript_lines = [
            f"{_sanitize(m.sender_name or m.role.upper())}: {_sanitize(m.content or '')}"
            for m in reversed(rows)
        ]
    finally:
        db.close()

    transcript = "\n".join(transcript_lines) if transcript_lines else "(no messages yet)"
    routing_msgs = [
        {
            "role": "system",
            "content": (
                f"You are a discussion conductor. Available speakers: {names}.\n\n"
                f"Recent discussion:\n{transcript}\n\n"
                "Decide who should contribute next, or signal that the discussion has converged. "
                "Respond with exactly one line:\n"
                "  ROUTE:<AGENT_NAME> — to pick the next speaker\n"
                "  ROUTE:DONE — if the discussion has reached a conclusion"
            ),
        },
        {"role": "user", "content": _sanitize(user_text)},
    ]

    try:
        decision = await llm_call_async(url, model, routing_msgs, headers=headers, max_tokens=32)
        decision = (decision or "").strip().upper()
        if "DONE" in decision or "CONVERGED" in decision:
            return None, True
        if decision.startswith("ROUTE:"):
            name = decision[6:].strip()
            target = next((a for a in others if a.name == name), None)
            if target:
                return target, False
    except Exception as exc:
        logger.debug("ORCHESTRATOR conduct failed: %s", exc)

    return (others[0] if others else None), False


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
    """Open mode: ORCHESTRATOR-conducted discussion, round-based cap.

    ORCHESTRATOR (if present) picks the next speaker each round based on transcript,
    and may signal early convergence (ROUTE:DONE). Agents can speak multiple times.
    Cap bounds total turns (not participant count) — 3 agents can run for 10 turns.
    Without ORCHESTRATOR, falls back to round-robin cycling through all agents.
    """
    orchestrator = next((a for a in agents if a.name == "ORCHESTRATOR"), None)
    others = [a for a in agents if a.name != "ORCHESTRATOR"]

    if not others:
        yield (
            f'event: error\ndata: {json.dumps({"error": "No discussion participants beyond ORCHESTRATOR."})}\n\n'
        )
        yield "data: [DONE]\n\n"
        return

    turns = 0
    rr_index = 0

    while turns < cap:
        if orchestrator:
            agent, converged = await _conduct_next_speaker(
                orchestrator, others, owner, room_id, user_text, db_factory,
            )
            if converged or not agent:
                break
        else:
            # No ORCHESTRATOR — cycle round-robin through participants
            agent = others[rr_index % len(others)]
            rr_index += 1

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
