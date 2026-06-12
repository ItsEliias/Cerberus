"""CerberusAgent CRUD + invocation + messaging routes (Phase E1/E2).

All routes require authentication via `require_user`.
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

from core.database import CerberusAgent, CerberusAgentMessage, SessionLocal
from src.auth_helpers import require_user

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default agent seed definitions
# ---------------------------------------------------------------------------

_DEFAULT_AGENTS: List[Dict[str, str]] = [
    {
        "name": "Daedalus",
        "role": "architect",
        "agent_type": "system-architect",
        "status": "idle",
        "model_alias": "sonnet",
        "system_prompt": (
            "You are Daedalus, master architect. "
            "Reason about system structure, module boundaries, data flow. "
            "Concise, structural answers."
        ),
    },
    {
        "name": "Hephaestus",
        "role": "backend-dev",
        "agent_type": "backend-dev",
        "status": "idle",
        "model_alias": "sonnet",
        "system_prompt": (
            "You are Hephaestus, god of craft. "
            "Implement clean code, prefer simplicity, ship working solutions."
        ),
    },
    {
        "name": "Themis",
        "role": "tester",
        "agent_type": "tester",
        "status": "idle",
        "model_alias": "sonnet",
        "system_prompt": (
            "You are Themis, embodiment of order. "
            "Identify edge cases, validate assumptions, enforce correctness."
        ),
    },
    {
        "name": "Athena",
        "role": "researcher",
        "agent_type": "researcher",
        "status": "idle",
        "model_alias": "sonnet",
        "system_prompt": (
            "You are Athena, wisdom incarnate. "
            "Investigate prior art, gather context, synthesize findings."
        ),
    },
    {
        "name": "Argus",
        "role": "reviewer",
        "agent_type": "reviewer",
        "status": "idle",
        "model_alias": "sonnet",
        "system_prompt": (
            "You are Argus Panoptes, hundred-eyed watcher. "
            "Review code for bugs, style, security gaps."
        ),
    },
    {
        "name": "Aegis",
        "role": "security-auditor",
        "agent_type": "security-auditor",
        "status": "standby",
        "model_alias": "sonnet",
        "system_prompt": (
            "You are Aegis, shield of Zeus. "
            "Audit for vulnerabilities, threat models, defensive measures."
        ),
    },
]

# Mapping from old default names to Greek personas (for seed-greek endpoint)
_GREEK_RENAME_MAP: List[Dict[str, str]] = [
    {"old_name": "ARCHITECT", "new_name": "Daedalus", "role": "architect", "system_prompt": _DEFAULT_AGENTS[0]["system_prompt"]},
    {"old_name": "CODER",     "new_name": "Hephaestus", "role": "backend-dev", "system_prompt": _DEFAULT_AGENTS[1]["system_prompt"]},
    {"old_name": "TESTER",    "new_name": "Themis",     "role": "tester",       "system_prompt": _DEFAULT_AGENTS[2]["system_prompt"]},
    {"old_name": "RESEARCHER","new_name": "Athena",     "role": "researcher",   "system_prompt": _DEFAULT_AGENTS[3]["system_prompt"]},
    {"old_name": "REVIEWER",  "new_name": "Argus",      "role": "reviewer",     "system_prompt": _DEFAULT_AGENTS[4]["system_prompt"]},
    {"old_name": "SECURITY",  "new_name": "Aegis",      "role": "security-auditor", "system_prompt": _DEFAULT_AGENTS[5]["system_prompt"]},
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _seed_defaults(db, owner: str) -> None:
    """Insert the 6 default agent personas for a new owner. Idempotent."""
    for defn in _DEFAULT_AGENTS:
        existing = (
            db.query(CerberusAgent)
            .filter(CerberusAgent.owner == owner, CerberusAgent.name == defn["name"])
            .first()
        )
        if existing:
            continue
        agent = CerberusAgent(
            id=str(uuid.uuid4()),
            owner=owner,
            **defn,
        )
        db.add(agent)
    db.commit()


def _get_agent_for_owner(db, agent_id: str, owner: str) -> CerberusAgent:
    """Return agent or raise 404/403."""
    agent = db.query(CerberusAgent).filter(CerberusAgent.id == agent_id).first()
    if not agent:
        raise HTTPException(404, "Agent not found")
    if owner and agent.owner != owner:
        raise HTTPException(403, "Not your agent")
    return agent


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class AgentCreate(BaseModel):
    name: str
    role: str
    agent_type: str
    system_prompt: str
    status: Optional[str] = "idle"
    model_alias: Optional[str] = "sonnet"


class AgentPatch(BaseModel):
    status: Optional[str] = None
    current_action: Optional[str] = None
    system_prompt: Optional[str] = None
    model_alias: Optional[str] = None
    score: Optional[int] = None


class AgentInvoke(BaseModel):
    prompt: str


class MessageCreate(BaseModel):
    content: str


# ---------------------------------------------------------------------------
# Route factory
# ---------------------------------------------------------------------------

def setup_cerberus_agent_routes() -> APIRouter:
    router = APIRouter(prefix="/api/agents", tags=["cerberus-agents"])

    @router.get("")
    def list_agents(request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            count = db.query(CerberusAgent).filter(CerberusAgent.owner == owner).count()
            if count == 0:
                _seed_defaults(db, owner)
            agents = (
                db.query(CerberusAgent)
                .filter(CerberusAgent.owner == owner)
                .order_by(CerberusAgent.created_at)
                .all()
            )
            return {"agents": [a.to_dict() for a in agents]}
        finally:
            db.close()

    @router.post("")
    def create_agent(request: Request, body: AgentCreate) -> Dict[str, Any]:
        owner = require_user(request)
        if not body.name.strip():
            raise HTTPException(400, "Agent name is required")
        db = SessionLocal()
        try:
            existing = (
                db.query(CerberusAgent)
                .filter(CerberusAgent.owner == owner, CerberusAgent.name == body.name.strip())
                .first()
            )
            if existing:
                raise HTTPException(409, f"Agent '{body.name}' already exists")
            agent = CerberusAgent(
                id=str(uuid.uuid4()),
                owner=owner,
                name=body.name.strip(),
                role=body.role,
                agent_type=body.agent_type,
                system_prompt=body.system_prompt,
                status=body.status or "idle",
                model_alias=body.model_alias or "sonnet",
            )
            db.add(agent)
            db.commit()
            db.refresh(agent)
            return agent.to_dict()
        except HTTPException:
            raise
        except Exception as exc:
            db.rollback()
            logger.error("create_agent failed: %s", exc)
            raise HTTPException(500, f"Failed to create agent: {exc}")
        finally:
            db.close()

    @router.patch("/{agent_id}")
    def patch_agent(agent_id: str, request: Request, body: AgentPatch) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            agent = _get_agent_for_owner(db, agent_id, owner)
            if body.status is not None:
                agent.status = body.status
            if body.current_action is not None:
                agent.current_action = body.current_action
            if body.system_prompt is not None:
                agent.system_prompt = body.system_prompt
            if body.model_alias is not None:
                agent.model_alias = body.model_alias
            if body.score is not None:
                agent.score = body.score
            db.commit()
            db.refresh(agent)
            return agent.to_dict()
        except HTTPException:
            raise
        except Exception as exc:
            db.rollback()
            raise HTTPException(500, f"Failed to update agent: {exc}")
        finally:
            db.close()

    @router.delete("/{agent_id}")
    def delete_agent(agent_id: str, request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            agent = _get_agent_for_owner(db, agent_id, owner)
            db.delete(agent)
            db.commit()
            return {"deleted": agent_id}
        except HTTPException:
            raise
        except Exception as exc:
            db.rollback()
            raise HTTPException(500, f"Failed to delete agent: {exc}")
        finally:
            db.close()

    @router.post("/seed-greek")
    def seed_greek(request: Request) -> Dict[str, Any]:
        """Rename legacy default-named agents to Greek personas. Idempotent."""
        owner = require_user(request)
        db = SessionLocal()
        renamed: List[str] = []
        try:
            for mapping in _GREEK_RENAME_MAP:
                agent = (
                    db.query(CerberusAgent)
                    .filter(
                        CerberusAgent.owner == owner,
                        CerberusAgent.name == mapping["old_name"],
                    )
                    .first()
                )
                if not agent:
                    continue
                agent.name = mapping["new_name"]
                agent.system_prompt = mapping["system_prompt"]
                renamed.append(f"{mapping['old_name']} → {mapping['new_name']}")
            db.commit()
            return {"renamed": renamed, "count": len(renamed)}
        except Exception as exc:
            db.rollback()
            logger.error("seed_greek failed: %s", exc)
            raise HTTPException(500, f"seed-greek failed: {exc}")
        finally:
            db.close()

    @router.get("/{agent_id}/messages")
    def get_messages(agent_id: str, request: Request, limit: int = 100) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            _get_agent_for_owner(db, agent_id, owner)
            msgs = (
                db.query(CerberusAgentMessage)
                .filter(CerberusAgentMessage.agent_id == agent_id)
                .order_by(CerberusAgentMessage.created_at.asc())
                .all()
            )
            tail = msgs[-limit:] if limit and len(msgs) > limit else msgs
            return {"messages": [m.to_dict() for m in tail]}
        finally:
            db.close()

    @router.post("/{agent_id}/messages")
    async def post_message(agent_id: str, request: Request, body: MessageCreate) -> StreamingResponse:
        owner = require_user(request)
        if not (body.content or "").strip():
            raise HTTPException(400, "Message content is required")

        db = SessionLocal()
        try:
            agent = _get_agent_for_owner(db, agent_id, owner)
            system_prompt = agent.system_prompt or ""
            model_alias   = agent.model_alias or "sonnet"
            agent.status  = "active"
            agent.current_action = "Chatting…"
            db.commit()

            # Persist user message
            user_msg = CerberusAgentMessage(
                id=str(uuid.uuid4()),
                agent_id=agent_id,
                owner=owner,
                role="user",
                content=body.content.strip(),
            )
            db.add(user_msg)
            db.commit()

            # Build conversation history (last 30 turns = 60 messages)
            history = (
                db.query(CerberusAgentMessage)
                .filter(CerberusAgentMessage.agent_id == agent_id)
                .order_by(CerberusAgentMessage.created_at.asc())
                .all()
            )
            recent = history[-60:]
            messages: List[Dict] = [{"role": "system", "content": system_prompt}]
            for h in recent:
                messages.append({"role": "user" if h.role == "user" else "assistant", "content": h.content})
        except HTTPException:
            raise
        except Exception as exc:
            db.rollback()
            raise HTTPException(500, f"Failed to prepare message: {exc}")
        finally:
            db.close()

        agent_msg_id = str(uuid.uuid4())

        async def _generate():
            from src.claude_subscription import stream_completion
            accumulated = ""
            success = True
            try:
                async for chunk in stream_completion(messages, model=model_alias):
                    if chunk.startswith("data: "):
                        payload = chunk[6:].strip()
                        if payload and payload != "[DONE]":
                            try:
                                obj = json.loads(payload)
                                if obj.get("delta"):
                                    accumulated += obj["delta"]
                            except Exception:
                                pass
                    yield chunk
            except Exception as exc:
                success = False
                yield f'event: error\ndata: {json.dumps({"error": str(exc), "status": 500})}\n\n'
            finally:
                _finalize_message(agent_id, agent_msg_id, owner, accumulated, success)

        return StreamingResponse(_generate(), media_type="text/event-stream")

    @router.delete("/{agent_id}/messages")
    def delete_messages(agent_id: str, request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            _get_agent_for_owner(db, agent_id, owner)
            deleted = (
                db.query(CerberusAgentMessage)
                .filter(CerberusAgentMessage.agent_id == agent_id)
                .delete(synchronize_session=False)
            )
            db.commit()
            return {"deleted": deleted}
        except HTTPException:
            raise
        except Exception as exc:
            db.rollback()
            raise HTTPException(500, f"Failed to delete messages: {exc}")
        finally:
            db.close()

    @router.post("/{agent_id}/invoke")
    async def invoke_agent(agent_id: str, request: Request, body: AgentInvoke) -> StreamingResponse:
        owner = require_user(request)
        if not (body.prompt or "").strip():
            raise HTTPException(400, "Prompt is required")

        db = SessionLocal()
        try:
            agent = _get_agent_for_owner(db, agent_id, owner)
            system_prompt = agent.system_prompt or ""
            agent_id_val = agent.id
            agent.status = "active"
            agent.current_action = f"Invoking: {body.prompt[:80]}"
            db.commit()
        finally:
            db.close()

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": body.prompt.strip()},
        ]

        async def _generate():
            from src.claude_subscription import stream_completion
            success = True
            try:
                async for chunk in stream_completion(messages):
                    yield chunk
            except Exception as exc:
                success = False
                yield f'event: error\ndata: {json.dumps({"error": str(exc), "status": 500})}\n\n'
            finally:
                _finalize_invocation(agent_id_val, owner, success)

        return StreamingResponse(_generate(), media_type="text/event-stream")

    return router


def _update_agent_post_stream(db, agent_id: str, success: bool, err_action: str) -> None:
    """Shared helper: flip status + bump score after a stream completes."""
    agent = db.query(CerberusAgent).filter(CerberusAgent.id == agent_id).first()
    if not agent:
        return
    agent.status = "idle" if success else "alert"
    agent.current_action = None if success else err_action
    if success:
        agent.score = (agent.score or 0) + 1
    agent.last_active_at = _utcnow()


def _finalize_message(agent_id: str, msg_id: str, owner: str, content: str, success: bool) -> None:
    """Post-stream: persist agent reply, update agent stats."""
    db = SessionLocal()
    try:
        saved = content if content else ("[Stream error]" if not success else "")
        db.add(CerberusAgentMessage(id=msg_id, agent_id=agent_id, owner=owner, role="agent", content=saved))
        _update_agent_post_stream(db, agent_id, success, "Error — see chat")
        db.commit()
    except Exception as exc:
        logger.warning("_finalize_message failed: %s", exc)
        try: db.rollback()
        except Exception: pass
    finally:
        db.close()


def _finalize_invocation(agent_id: str, owner: str, success: bool) -> None:
    """Post-stream: update status, score, last_active_at."""
    db = SessionLocal()
    try:
        _update_agent_post_stream(db, agent_id, success, "Error — see response")
        db.commit()
    except Exception as exc:
        logger.warning("_finalize_invocation failed: %s", exc)
    finally:
        db.close()
