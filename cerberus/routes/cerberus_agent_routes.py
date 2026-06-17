"""CerberusAgent CRUD + invocation routes.

Endpoints:
  GET    /api/agents                — list owner's agents (lazy-seeds + back-fills defaults)
  POST   /api/agents                — create an agent
  PATCH  /api/agents/{id}           — update fields
  DELETE /api/agents/{id}           — delete
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
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.database import CerberusAgent, SessionLocal
from routes.cerberus_agent_defaults import _DEFAULT_AGENTS
from src.auth_helpers import require_user

logger = logging.getLogger(__name__)


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
    """Insert any missing default agent personas for an owner. Idempotent.

    Called on every GET /api/agents so new defaults are back-filled for
    existing owners without duplicating already-present names.
    """
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
    model_alias: Optional[str] = "default"


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
            # Always call seed — it's idempotent and back-fills new defaults
            # for existing owners without duplicating already-present names.
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
                model_alias=body.model_alias or "default",
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

        # Resolve endpoint before opening the stream so auth errors surface
        # immediately rather than mid-stream.
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
