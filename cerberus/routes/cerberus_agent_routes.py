"""CerberusAgent CRUD + invocation routes.

Endpoints:
  GET    /api/agents                — list owner's agents (lazy-seeds + back-fills defaults)
  POST   /api/agents                — create an agent
  PATCH  /api/agents/{id}           — update fields (name, role, agent_type, system_prompt, model_alias, avatar, status)
  DELETE /api/agents/{id}           — delete (soft-suppress for seeded defaults; hard-delete for custom)
  POST   /api/agents/{id}/invoke    — run agent via the provider-agnostic LLM engine (SSE)

Invocation resolves each agent's model_alias against the owner's configured
endpoints (via endpoint_resolver.py / llm_core.py) — not a hardcoded provider.
All routes require authentication via `require_user`.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.database import CerberusAgent, SessionLocal
from routes.cerberus_agent_defaults import _DEFAULT_AGENTS
from src.auth_helpers import require_user

logger = logging.getLogger(__name__)

# Set of names that belong to the seeded defaults — used to choose soft vs hard delete.
_DEFAULT_NAMES: Set[str] = {d["name"] for d in _DEFAULT_AGENTS}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _resolve_agent_endpoint(
    model_alias: str, owner: str
) -> Tuple[Optional[str], Optional[str], Optional[Dict]]:
    """Resolve agent model_alias → (chat_url, model, headers).

    1. Empty / "default" → owner's configured default endpoint.
    2. Specific alias (e.g. "sonnet") → first enabled endpoint whose model
       list contains the alias as a case-insensitive substring.
    3. Falls back to the owner's default if no match found.
    Returns (None, None, None) only when no endpoint is configured at all.
    """
    from src.endpoint_resolver import (
        resolve_endpoint,
        resolve_endpoint_runtime,
        build_chat_url,
        build_headers,
        _endpoint_enabled_models,
    )
    from src.auth_helpers import owner_filter
    from core.database import ModelEndpoint

    alias = (model_alias or "default").strip().lower()
    if alias in ("", "default"):
        return resolve_endpoint("default", owner=owner)

    db = SessionLocal()
    try:
        q = db.query(ModelEndpoint).filter(ModelEndpoint.is_enabled.is_(True))
        q = owner_filter(q, ModelEndpoint, owner)
        for ep in q.all():
            matched = next(
                (m for m in _endpoint_enabled_models(ep) if alias in m.lower()),
                None,
            )
            if not matched:
                continue
            try:
                base, api_key = resolve_endpoint_runtime(ep, owner=owner)
                return build_chat_url(base), matched, build_headers(api_key, base)
            except Exception:
                continue
    except Exception as exc:
        logger.debug("_resolve_agent_endpoint alias search failed: %s", exc)
    finally:
        db.close()

    return resolve_endpoint("default", owner=owner)


def _seed_defaults(db, owner: str) -> None:
    """Insert any missing (and non-suppressed) default agent personas for an owner.

    Called on every GET /api/agents — idempotent; skips names that already exist
    (active or suppressed) so deleted defaults are not resurrected.
    """
    # One query to get all names already in DB (active + suppressed)
    existing_names: Set[str] = {
        row[0] for row in
        db.query(CerberusAgent.name)
        .filter(CerberusAgent.owner == owner)
        .all()
    }
    for defn in _DEFAULT_AGENTS:
        if defn["name"] in existing_names:
            continue
        agent = CerberusAgent(
            id=str(uuid.uuid4()),
            owner=owner,
            is_suppressed=False,
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
    model_alias: Optional[str] = "default"
    avatar: Optional[str] = ""


class AgentPatch(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    agent_type: Optional[str] = None
    status: Optional[str] = None
    current_action: Optional[str] = None
    system_prompt: Optional[str] = None
    model_alias: Optional[str] = None
    score: Optional[int] = None
    avatar: Optional[str] = None


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
            _seed_defaults(db, owner)
            agents = (
                db.query(CerberusAgent)
                .filter(
                    CerberusAgent.owner == owner,
                    CerberusAgent.is_suppressed.is_(False),
                )
                .order_by(CerberusAgent.created_at)
                .all()
            )
            return {"agents": [a.to_dict() for a in agents]}
        finally:
            db.close()

    @router.post("")
    def create_agent(request: Request, body: AgentCreate) -> Dict[str, Any]:
        owner = require_user(request)
        name = (body.name or "").strip()
        if not name:
            raise HTTPException(400, "Agent name is required")
        db = SessionLocal()
        try:
            existing = (
                db.query(CerberusAgent)
                .filter(CerberusAgent.owner == owner, CerberusAgent.name == name)
                .first()
            )
            if existing:
                if existing.is_suppressed:
                    # Un-suppress: restore the deleted default
                    existing.is_suppressed = False
                    existing.role = body.role
                    existing.agent_type = body.agent_type
                    existing.system_prompt = body.system_prompt
                    existing.status = body.status or "idle"
                    existing.model_alias = body.model_alias or "default"
                    existing.avatar = body.avatar or ""
                    db.commit()
                    db.refresh(existing)
                    return existing.to_dict()
                raise HTTPException(409, f"Agent '{name}' already exists")
            agent = CerberusAgent(
                id=str(uuid.uuid4()),
                owner=owner,
                name=name,
                role=body.role,
                agent_type=body.agent_type,
                system_prompt=body.system_prompt,
                status=body.status or "idle",
                model_alias=body.model_alias or "default",
                avatar=body.avatar or "",
                is_suppressed=False,
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
            if body.name is not None:
                new_name = body.name.strip()
                if not new_name:
                    raise HTTPException(400, "Agent name cannot be empty")
                # Check uniqueness (ignore self)
                clash = (
                    db.query(CerberusAgent)
                    .filter(
                        CerberusAgent.owner == owner,
                        CerberusAgent.name == new_name,
                        CerberusAgent.id != agent_id,
                    )
                    .first()
                )
                if clash:
                    raise HTTPException(409, f"Agent name '{new_name}' already exists")
                agent.name = new_name
            if body.role is not None:
                agent.role = body.role
            if body.agent_type is not None:
                agent.agent_type = body.agent_type
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
            if body.avatar is not None:
                agent.avatar = body.avatar
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
        """Delete an agent.

        Seeded defaults are soft-deleted (is_suppressed=True) so the back-fill
        on GET /api/agents does not resurrect them. Custom agents are hard-deleted.
        """
        owner = require_user(request)
        db = SessionLocal()
        try:
            agent = _get_agent_for_owner(db, agent_id, owner)
            if agent.name in _DEFAULT_NAMES:
                agent.is_suppressed = True
                agent.status = "idle"
                agent.current_action = None
                db.commit()
            else:
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

        db = SessionLocal()
        try:
            agent = _get_agent_for_owner(db, agent_id, owner)
            system_prompt = agent.system_prompt or ""
            agent_id_val = agent.id
            model_alias = agent.model_alias or "default"
            agent.status = "active"
            agent.current_action = f"Invoking: {body.prompt[:80]}"
            db.commit()
        finally:
            db.close()

        url, model, headers = _resolve_agent_endpoint(model_alias, owner)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": body.prompt.strip()},
        ]

        async def _generate():
            from src.llm_core import stream_llm
            if not url or not model:
                yield (
                    f'event: error\ndata: {json.dumps({"error": "No LLM provider configured."
                    " Add a model in Settings → Add Models.", "status": 503})}\n\n'
                )
                _finalize_invocation(agent_id_val, owner, False, 0, 0, "")
                return
            state = {"success": True, "in_tok": 0, "out_tok": 0}
            try:
                async for chunk in stream_llm(url, model, messages, headers=headers):
                    if chunk.startswith("event: error"):
                        state["success"] = False
                    elif '"type": "usage"' in chunk:
                        for line in chunk.split("\n"):
                            if line.startswith("data:") and "[DONE]" not in line:
                                try:
                                    obj = json.loads(line[5:].strip())
                                    if obj.get("type") == "usage":
                                        d = obj.get("data", {})
                                        state["in_tok"] = d.get("input_tokens", state["in_tok"])
                                        state["out_tok"] = d.get("output_tokens", state["out_tok"])
                                except Exception:
                                    pass
                    yield chunk
            except Exception as exc:
                state["success"] = False
                yield f'event: error\ndata: {json.dumps({"error": str(exc), "status": 500})}\n\n'
            finally:
                _finalize_invocation(
                    agent_id_val, owner, state["success"],
                    state["in_tok"], state["out_tok"], url or "",
                )

        return StreamingResponse(_generate(), media_type="text/event-stream")

    return router


def _finalize_invocation(
    agent_id: str,
    owner: str,
    success: bool,
    in_tokens: int = 0,
    out_tokens: int = 0,
    endpoint_url: str = "",
) -> None:
    """Post-stream: update status, score, token totals, last_active_at."""
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
        if in_tokens or out_tokens:
            agent.total_input_tokens = (agent.total_input_tokens or 0) + in_tokens
            agent.total_output_tokens = (agent.total_output_tokens or 0) + out_tokens
        if endpoint_url:
            agent.last_run_url = endpoint_url
        db.commit()
    except Exception as exc:
        logger.warning("_finalize_invocation failed: %s", exc)
    finally:
        db.close()
