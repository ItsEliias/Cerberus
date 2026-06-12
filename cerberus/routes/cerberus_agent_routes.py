"""CerberusAgent CRUD + invocation routes.

Endpoints:
  GET    /api/agents                — list owner's agents (lazy-seeds 6 defaults)
  POST   /api/agents                — create an agent
  PATCH  /api/agents/{id}           — update fields
  DELETE /api/agents/{id}           — delete
  POST   /api/agents/{id}/invoke    — run agent via Claude Subscription provider (SSE)

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

from core.database import CerberusAgent, SessionLocal
from src.auth_helpers import require_user

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default agent seed definitions
# ---------------------------------------------------------------------------

_DEFAULT_AGENTS: List[Dict[str, str]] = [
    {
        "name": "ARCHITECT",
        "role": "architect",
        "agent_type": "system-architect",
        "status": "idle",
        "model_alias": "sonnet",
        "system_prompt": (
            "You are ARCHITECT, a senior system architect inside the Cerberus AI workspace. "
            "You design scalable, secure, maintainable systems. You think in components, "
            "interfaces, and trade-offs. When asked to design or review a system, produce "
            "clear diagrams (ASCII or Mermaid), list the components, explain their responsibilities, "
            "and call out the top 3 risks with mitigations. Keep all responses concise and actionable."
        ),
    },
    {
        "name": "CODER",
        "role": "coder",
        "agent_type": "backend-dev",
        "status": "idle",
        "model_alias": "sonnet",
        "system_prompt": (
            "You are CODER, an expert software engineer inside the Cerberus AI workspace. "
            "You write clean, typed, tested code in Python, TypeScript, and Rust. "
            "You follow SOLID principles and always validate inputs at system boundaries. "
            "When asked to implement something, produce working code with inline comments "
            "explaining non-obvious decisions. Functions stay under 20 lines."
        ),
    },
    {
        "name": "TESTER",
        "role": "tester",
        "agent_type": "tester",
        "status": "idle",
        "model_alias": "sonnet",
        "system_prompt": (
            "You are TESTER, a quality-engineering specialist inside the Cerberus AI workspace. "
            "You write comprehensive test suites following the London School TDD approach. "
            "You identify edge cases, boundary conditions, and failure modes. "
            "For every feature or function you receive, produce unit tests, integration tests, "
            "and a smoke-test checklist. Always ask: what can go wrong?"
        ),
    },
    {
        "name": "RESEARCHER",
        "role": "researcher",
        "agent_type": "researcher",
        "status": "idle",
        "model_alias": "sonnet",
        "system_prompt": (
            "You are RESEARCHER, a deep-research specialist inside the Cerberus AI workspace. "
            "You gather, synthesise, and evaluate information from multiple sources. "
            "You surface key facts, contradictions, and knowledge gaps. "
            "Present findings as structured reports: summary, key findings, open questions, "
            "and confidence level per claim. Cite sources when available."
        ),
    },
    {
        "name": "REVIEWER",
        "role": "reviewer",
        "agent_type": "reviewer",
        "status": "idle",
        "model_alias": "sonnet",
        "system_prompt": (
            "You are REVIEWER, a code and design review specialist inside the Cerberus AI workspace. "
            "You critique code for correctness, security, performance, and maintainability. "
            "You give blunt, actionable feedback structured as: MUST-FIX, SHOULD-FIX, SUGGESTION. "
            "For every review you produce a risk score (1-10) and a one-line verdict."
        ),
    },
    {
        "name": "SECURITY",
        "role": "security-auditor",
        "agent_type": "security-auditor",
        "status": "standby",
        "model_alias": "sonnet",
        "system_prompt": (
            "You are SECURITY, a security architect and auditor inside the Cerberus AI workspace. "
            "You identify vulnerabilities, threat vectors, and compliance gaps. "
            "You think in STRIDE, OWASP Top-10, and zero-trust principles. "
            "For every code review or system design, produce a threat model with severity ratings "
            "(CRITICAL/HIGH/MEDIUM/LOW) and concrete remediation steps. Never normalise risk."
        ),
    },
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

    @router.post("/{agent_id}/invoke")
    async def invoke_agent(agent_id: str, request: Request, body: AgentInvoke) -> StreamingResponse:
        owner = require_user(request)
        if not (body.prompt or "").strip():
            raise HTTPException(400, "Prompt is required")

        # Read agent config before streaming
        db = SessionLocal()
        try:
            agent = _get_agent_for_owner(db, agent_id, owner)
            system_prompt = agent.system_prompt or ""
            agent_name = agent.name
            agent_id_val = agent.id
            # Flip to active immediately
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


def _finalize_invocation(agent_id: str, owner: str, success: bool) -> None:
    """Post-stream: update status, score, last_active_at."""
    db = SessionLocal()
    try:
        agent = db.query(CerberusAgent).filter(CerberusAgent.id == agent_id).first()
        if not agent:
            return
        agent.status = "idle" if success else "alert"
        if not success:
            agent.current_action = "Error — see response"
        else:
            agent.current_action = None
            agent.score = (agent.score or 0) + 1
        agent.last_active_at = _utcnow()
        db.commit()
    except Exception as exc:
        logger.warning("_finalize_invocation failed: %s", exc)
    finally:
        db.close()
