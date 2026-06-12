"""Council round-table routes (Phase E4).

All routes require authentication via `require_user`.

POST /api/council/meeting   — start a new meeting (SSE stream)
GET  /api/council/meetings  — list past meetings (owner-scoped)
GET  /api/council/meetings/{id} — load full meeting
DELETE /api/council/meetings/{id} — delete a meeting
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

from core.database import CerberusAgent, CerberusCouncilMeeting, SessionLocal
from src.auth_helpers import require_user

logger = logging.getLogger(__name__)

_MAX_ROUNDS = 4
_AGENT_WORD_LIMIT = 200


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class MeetingCreate(BaseModel):
    prompt: str
    agent_ids: List[str]
    rounds: Optional[int] = 2
    follow_up_to: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_agents(db, agent_ids: List[str], owner: str) -> List[CerberusAgent]:
    """Return agents in requested order, validating ownership."""
    agents = []
    for aid in agent_ids:
        a = db.query(CerberusAgent).filter(CerberusAgent.id == aid).first()
        if not a:
            raise HTTPException(404, f"Agent {aid} not found")
        if a.owner != owner:
            raise HTTPException(403, f"Agent {aid} does not belong to you")
        agents.append(a)
    return agents


def _build_system_prompt(agent: CerberusAgent, other_agents: List[CerberusAgent]) -> str:
    others = ", ".join(
        f"{a.name} ({a.role})" for a in other_agents if a.id != agent.id
    )
    suffix = (
        f" You are participating in a council round-table. "
        f"Other members include: {others}. "
        f"Respond concisely (under {_AGENT_WORD_LIMIT} words) and address the topic "
        f"and react to prior speakers when relevant."
    )
    return (agent.system_prompt or "") + suffix


def _build_messages(
    agent: CerberusAgent,
    other_agents: List[CerberusAgent],
    prompt: str,
    prior_turns: List[Dict],
    round_num: int,
) -> List[Dict]:
    """Build the message list for one agent's turn."""
    messages: List[Dict] = [
        {"role": "system", "content": _build_system_prompt(agent, other_agents)}
    ]
    messages.append({"role": "user", "content": prompt})
    # Weave in prior speakers as alternating assistant/user turns
    for i, turn in enumerate(prior_turns):
        role = "assistant" if i % 2 == 0 else "user"
        messages.append({"role": role, "content": turn["content"]})
    messages.append(
        {"role": "user", "content": f"(round {round_num} — your turn, {agent.name})"}
    )
    return messages


def _sse(obj: Any) -> str:
    return f"data: {json.dumps(obj)}\n\n"


# ---------------------------------------------------------------------------
# Route factory
# ---------------------------------------------------------------------------

def setup_council_routes() -> APIRouter:
    router = APIRouter(prefix="/api/council", tags=["cerberus-council"])

    @router.post("/meeting")
    async def start_meeting(request: Request, body: MeetingCreate) -> StreamingResponse:
        owner = require_user(request)
        if not (body.prompt or "").strip():
            raise HTTPException(400, "Prompt is required")
        if not body.agent_ids:
            raise HTTPException(400, "At least one agent is required")
        rounds = max(1, min(body.rounds or 2, _MAX_ROUNDS))

        db = SessionLocal()
        try:
            agents = _load_agents(db, body.agent_ids, owner)
            prior_transcript: List[Dict] = []
            if body.follow_up_to:
                prior_meeting = db.query(CerberusCouncilMeeting).filter(
                    CerberusCouncilMeeting.id == body.follow_up_to,
                    CerberusCouncilMeeting.owner == owner,
                ).first()
                if prior_meeting:
                    try:
                        prior_transcript = json.loads(prior_meeting.transcript or "[]")
                    except Exception:
                        prior_transcript = []
            # Snapshot data we need after db close
            agent_data = [
                {
                    "id": a.id,
                    "name": a.name,
                    "role": a.role,
                    "system_prompt": a.system_prompt or "",
                    "model_alias": a.model_alias or "sonnet",
                }
                for a in agents
            ]
        except HTTPException:
            raise
        finally:
            db.close()

        meeting_id = str(uuid.uuid4())
        prompt_text = body.prompt.strip()
        title = prompt_text[:60]

        async def _stream():
            from src.claude_subscription import stream_completion
            transcript: List[Dict] = list(prior_transcript)
            yield _sse({"type": "meeting_start", "meeting_id": meeting_id, "agent_ids": body.agent_ids})

            for r in range(1, rounds + 1):
                for agent in agent_data:
                    yield _sse({"type": "agent_start", "round": r, "agent_id": agent["id"], "agent_name": agent["name"]})
                    prior_turns = list(transcript)

                    # Build other_agents list from agent_data
                    other_agents_data = [x for x in agent_data if x["id"] != agent["id"]]

                    # Build messages manually (no DB objects here)
                    others_str = ", ".join(
                        f"{x['name']} ({x['role']})" for x in other_agents_data
                    )
                    system_content = (
                        agent["system_prompt"]
                        + f" You are participating in a council round-table. "
                        + f"Other members include: {others_str}. "
                        + f"Respond concisely (under {_AGENT_WORD_LIMIT} words) "
                        + f"and address the topic and react to prior speakers when relevant."
                    )
                    messages = [{"role": "system", "content": system_content}]
                    messages.append({"role": "user", "content": prompt_text})
                    for i, turn in enumerate(prior_turns):
                        role = "assistant" if i % 2 == 0 else "user"
                        messages.append({"role": role, "content": turn["content"]})
                    messages.append(
                        {"role": "user", "content": f"(round {r} — your turn, {agent['name']})"}
                    )

                    full_content = ""
                    try:
                        async for chunk in stream_completion(messages, model=agent["model_alias"]):
                            if chunk.startswith("data: "):
                                payload = chunk[6:].strip()
                                if payload and payload != "[DONE]":
                                    try:
                                        obj = json.loads(payload)
                                        if obj.get("delta"):
                                            full_content += obj["delta"]
                                            yield _sse({
                                                "type": "token",
                                                "round": r,
                                                "agent_id": agent["id"],
                                                "delta": obj["delta"],
                                            })
                                        elif obj.get("error"):
                                            yield _sse({"type": "error", "message": obj["error"]})
                                    except Exception:
                                        pass
                    except Exception as exc:
                        logger.warning("council stream error for agent %s: %s", agent["id"], exc)
                        full_content = full_content or "[Stream error]"

                    turn_record = {
                        "agent_id": agent["id"],
                        "agent_name": agent["name"],
                        "round": r,
                        "content": full_content,
                        "ts": _utcnow().isoformat(),
                    }
                    transcript.append(turn_record)
                    yield _sse({"type": "agent_end", "round": r, "agent_id": agent["id"], "full_content": full_content})

            # Persist meeting
            _persist_meeting(meeting_id, owner, title, prompt_text, body.agent_ids, rounds, transcript)
            yield _sse({"type": "meeting_end", "meeting_id": meeting_id, "transcript": transcript})

        return StreamingResponse(_stream(), media_type="text/event-stream")

    @router.get("/meetings")
    def list_meetings(request: Request, limit: int = 20) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            meetings = (
                db.query(CerberusCouncilMeeting)
                .filter(CerberusCouncilMeeting.owner == owner)
                .order_by(CerberusCouncilMeeting.created_at.desc())
                .limit(limit)
                .all()
            )
            result = []
            for m in meetings:
                d = m.to_dict()
                transcript_raw = d.get("transcript", "[]")
                try:
                    turns = json.loads(transcript_raw)
                    summary_text = turns[0]["content"][:200] if turns else ""
                except Exception:
                    summary_text = ""
                result.append({
                    "id":                m.id,
                    "title":             m.title,
                    "prompt":            m.prompt,
                    "agent_ids":         m.agent_ids,
                    "rounds":            m.rounds,
                    "transcript_summary": summary_text,
                    "created_at":        d["created_at"],
                })
            return {"meetings": result}
        finally:
            db.close()

    @router.get("/meetings/{meeting_id}")
    def get_meeting(meeting_id: str, request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            m = db.query(CerberusCouncilMeeting).filter(
                CerberusCouncilMeeting.id == meeting_id,
                CerberusCouncilMeeting.owner == owner,
            ).first()
            if not m:
                raise HTTPException(404, "Meeting not found")
            return m.to_dict()
        except HTTPException:
            raise
        finally:
            db.close()

    @router.delete("/meetings/{meeting_id}")
    def delete_meeting(meeting_id: str, request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            m = db.query(CerberusCouncilMeeting).filter(
                CerberusCouncilMeeting.id == meeting_id,
                CerberusCouncilMeeting.owner == owner,
            ).first()
            if not m:
                raise HTTPException(404, "Meeting not found")
            db.delete(m)
            db.commit()
            return {"deleted": meeting_id}
        except HTTPException:
            raise
        except Exception as exc:
            db.rollback()
            raise HTTPException(500, f"Failed to delete meeting: {exc}")
        finally:
            db.close()

    return router


def _persist_meeting(
    meeting_id: str,
    owner: str,
    title: str,
    prompt: str,
    agent_ids: List[str],
    rounds: int,
    transcript: List[Dict],
) -> None:
    """Persist the completed meeting record to the database."""
    db = SessionLocal()
    try:
        meeting = CerberusCouncilMeeting(
            id=meeting_id,
            owner=owner,
            title=title,
            prompt=prompt,
            agent_ids=json.dumps(agent_ids),
            rounds=rounds,
            transcript=json.dumps(transcript),
        )
        db.add(meeting)
        db.commit()
    except Exception as exc:
        logger.warning("_persist_meeting failed: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()
