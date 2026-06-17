"""Agent thread routes — persistent 1:1 chat history per agent.

Endpoints:
  GET    /api/agents/{id}/thread       — get or create thread; returns message history
  POST   /api/agents/{id}/thread/send  — send a message, stream SSE reply, persist both sides
  DELETE /api/agents/{id}/thread       — clear all messages (keeps the thread row)
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.database import AgentThread, AgentMessage, CerberusAgent, SessionLocal
from src.auth_helpers import require_user

logger = logging.getLogger(__name__)


class SendMessageBody(BaseModel):
    message: str


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _get_or_create_thread(db, agent_id: str, owner: str) -> AgentThread:
    thread = (
        db.query(AgentThread)
        .filter(AgentThread.agent_id == agent_id, AgentThread.owner == owner)
        .first()
    )
    if not thread:
        thread = AgentThread(id=str(uuid.uuid4()), agent_id=agent_id, owner=owner)
        db.add(thread)
        db.commit()
        db.refresh(thread)
    return thread


def _save_assistant_message(thread_id: str, content: str) -> None:
    db = SessionLocal()
    try:
        thread = db.query(AgentThread).filter(AgentThread.id == thread_id).first()
        if not thread or not content.strip():
            return
        db.add(AgentMessage(
            id=str(uuid.uuid4()), thread_id=thread_id,
            role="assistant", content=content,
        ))
        thread.message_count = (thread.message_count or 0) + 1
        thread.last_message_at = _utcnow()
        db.commit()
    except Exception as exc:
        logger.warning("_save_assistant_message failed: %s", exc)
    finally:
        db.close()


def setup_agent_thread_routes() -> APIRouter:
    router = APIRouter(prefix="/api/agents", tags=["agent-threads"])

    @router.get("/{agent_id}/thread")
    def get_thread(agent_id: str, request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            # Verify agent belongs to owner
            agent = (
                db.query(CerberusAgent)
                .filter(CerberusAgent.id == agent_id, CerberusAgent.owner == owner)
                .first()
            )
            if not agent:
                raise HTTPException(404, "Agent not found")
            thread = _get_or_create_thread(db, agent_id, owner)
            messages = [
                {
                    "role": m.role,
                    "content": m.content,
                    "timestamp": m.timestamp.isoformat() if m.timestamp else None,
                }
                for m in thread.messages
            ]
            return {"thread_id": thread.id, "messages": messages}
        finally:
            db.close()

    @router.post("/{agent_id}/thread/send")
    async def send_message(
        agent_id: str, request: Request, body: SendMessageBody,
    ) -> StreamingResponse:
        owner = require_user(request)
        text = (body.message or "").strip()
        if not text:
            raise HTTPException(400, "Message is required")

        db = SessionLocal()
        try:
            agent = (
                db.query(CerberusAgent)
                .filter(CerberusAgent.id == agent_id, CerberusAgent.owner == owner)
                .first()
            )
            if not agent:
                raise HTTPException(404, "Agent not found")
            system_prompt = agent.system_prompt or ""
            model_alias   = agent.model_alias or "default"

            thread = _get_or_create_thread(db, agent_id, owner)
            thread_id = thread.id

            # Persist user message first
            db.add(AgentMessage(
                id=str(uuid.uuid4()), thread_id=thread_id,
                role="user", content=text,
            ))
            thread.message_count = (thread.message_count or 0) + 1
            thread.last_message_at = _utcnow()

            # Build history for context (last 20 messages before the one just added)
            history = [
                {"role": m.role, "content": m.content}
                for m in thread.messages[-20:]
            ]
            db.commit()
        finally:
            db.close()

        from routes.cerberus_agent_routes import _resolve_agent_endpoint
        url, model, headers = _resolve_agent_endpoint(model_alias, owner)

        messages = (
            [{"role": "system", "content": system_prompt}]
            + history
            + [{"role": "user", "content": text}]
        )

        async def _generate():
            from src.llm_core import stream_llm
            if not url or not model:
                yield (
                    f'event: error\ndata: {json.dumps({"error": "No LLM provider configured."
                    " Add a model in Settings → Add Models.", "status": 503})}\n\n'
                )
                return

            parts: list[str] = []
            try:
                async for chunk in stream_llm(url, model, messages, headers=headers):
                    if chunk.startswith("event: error"):
                        yield chunk
                        continue
                    for line in chunk.split("\n"):
                        if line.startswith("data:") and "[DONE]" not in line:
                            try:
                                obj = json.loads(line[5:].strip())
                                if obj.get("type") != "usage":
                                    delta = obj.get("delta") or obj.get("text") or obj.get("content") or ""
                                    if delta:
                                        parts.append(delta)
                            except Exception:
                                pass
                    yield chunk
            except Exception as exc:
                yield f'event: error\ndata: {json.dumps({"error": str(exc), "status": 500})}\n\n'
            finally:
                if parts:
                    _save_assistant_message(thread_id, "".join(parts))

        return StreamingResponse(_generate(), media_type="text/event-stream")

    @router.delete("/{agent_id}/thread")
    def clear_thread(agent_id: str, request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            thread = (
                db.query(AgentThread)
                .filter(AgentThread.agent_id == agent_id, AgentThread.owner == owner)
                .first()
            )
            if thread:
                db.query(AgentMessage).filter(AgentMessage.thread_id == thread.id).delete()
                thread.message_count = 0
                thread.last_message_at = None
                db.commit()
            return {"cleared": True}
        finally:
            db.close()

    return router
