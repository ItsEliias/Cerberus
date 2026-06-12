"""CerberusAgentTask CRUD routes (Phase E5).

All routes require authentication via `require_user` and are owner-scoped.
"""

from __future__ import annotations

import uuid
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, validator

from core.database import CerberusAgent, CerberusAgentTask, SessionLocal
from src.auth_helpers import require_user

logger = logging.getLogger(__name__)

VALID_STATUSES = {"proposed", "approved", "rejected", "in_progress", "done"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _get_agent_for_owner(db, agent_id: str, owner: str) -> CerberusAgent:
    agent = db.query(CerberusAgent).filter(CerberusAgent.id == agent_id).first()
    if not agent:
        raise HTTPException(404, "Agent not found")
    if agent.owner != owner:
        raise HTTPException(404, "Agent not found")
    return agent


def _get_task_for_owner(db, agent_id: str, task_id: str, owner: str) -> CerberusAgentTask:
    task = (
        db.query(CerberusAgentTask)
        .filter(
            CerberusAgentTask.id == task_id,
            CerberusAgentTask.agent_id == agent_id,
            CerberusAgentTask.owner == owner,
        )
        .first()
    )
    if not task:
        raise HTTPException(404, "Task not found")
    return task


def _build_counts(db, agent_id: str, owner: str) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for s in VALID_STATUSES:
        counts[s] = (
            db.query(CerberusAgentTask)
            .filter(
                CerberusAgentTask.agent_id == agent_id,
                CerberusAgentTask.owner == owner,
                CerberusAgentTask.status == s,
            )
            .count()
        )
    counts["total"] = sum(counts.values())
    return counts


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    context_json: Optional[str] = "{}"
    status: Optional[str] = "proposed"

    @validator("title")
    def title_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("title is required")
        if len(v) > 200:
            raise ValueError("title must be <= 200 characters")
        return v

    @validator("status")
    def status_valid(cls, v: Optional[str]) -> str:
        v = v or "proposed"
        if v not in VALID_STATUSES:
            raise ValueError(f"status must be one of {VALID_STATUSES}")
        return v


class TaskPatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    context_json: Optional[str] = None

    @validator("title")
    def title_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("title cannot be empty")
            if len(v) > 200:
                raise ValueError("title must be <= 200 characters")
        return v

    @validator("status")
    def status_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_STATUSES:
            raise ValueError(f"status must be one of {VALID_STATUSES}")
        return v


# ---------------------------------------------------------------------------
# Route factory
# ---------------------------------------------------------------------------

def setup_cerberus_agent_task_routes() -> APIRouter:
    router = APIRouter(prefix="/api/agents", tags=["cerberus-agent-tasks"])

    @router.get("/{agent_id}/tasks/counts")
    def task_counts(agent_id: str, request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            _get_agent_for_owner(db, agent_id, owner)
            return _build_counts(db, agent_id, owner)
        finally:
            db.close()

    @router.get("/{agent_id}/tasks")
    def list_tasks(
        agent_id: str,
        request: Request,
        status: Optional[str] = Query(default=None),
    ) -> Dict[str, Any]:
        owner = require_user(request)
        if status and status not in VALID_STATUSES:
            raise HTTPException(400, f"Invalid status filter. Must be one of {VALID_STATUSES}")
        db = SessionLocal()
        try:
            _get_agent_for_owner(db, agent_id, owner)
            q = (
                db.query(CerberusAgentTask)
                .filter(
                    CerberusAgentTask.agent_id == agent_id,
                    CerberusAgentTask.owner == owner,
                )
                .order_by(CerberusAgentTask.created_at.desc())
            )
            if status:
                q = q.filter(CerberusAgentTask.status == status)
            tasks = q.all()
            counts = _build_counts(db, agent_id, owner)
            return {"tasks": [t.to_dict() for t in tasks], "counts": counts}
        finally:
            db.close()

    @router.post("/{agent_id}/tasks")
    def create_task(
        agent_id: str, request: Request, body: TaskCreate
    ) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            _get_agent_for_owner(db, agent_id, owner)
            task = CerberusAgentTask(
                id=str(uuid.uuid4()),
                agent_id=agent_id,
                owner=owner,
                title=body.title,
                description=body.description or "",
                status=body.status or "proposed",
                context_json=body.context_json or "{}",
            )
            db.add(task)
            db.commit()
            db.refresh(task)
            return task.to_dict()
        except HTTPException:
            raise
        except Exception as exc:
            db.rollback()
            logger.error("create_task failed: %s", exc)
            raise HTTPException(500, f"Failed to create task: {exc}")
        finally:
            db.close()

    @router.patch("/{agent_id}/tasks/{task_id}")
    def update_task(
        agent_id: str, task_id: str, request: Request, body: TaskPatch
    ) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            task = _get_task_for_owner(db, agent_id, task_id, owner)
            if body.title is not None:
                task.title = body.title
            if body.description is not None:
                task.description = body.description
            if body.status is not None:
                task.status = body.status
            if body.context_json is not None:
                task.context_json = body.context_json
            task.updated_at = _utcnow()
            db.commit()
            db.refresh(task)
            return task.to_dict()
        except HTTPException:
            raise
        except Exception as exc:
            db.rollback()
            logger.error("update_task failed: %s", exc)
            raise HTTPException(500, f"Failed to update task: {exc}")
        finally:
            db.close()

    @router.delete("/{agent_id}/tasks/{task_id}")
    def delete_task(
        agent_id: str, task_id: str, request: Request
    ) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            task = _get_task_for_owner(db, agent_id, task_id, owner)
            db.delete(task)
            db.commit()
            return {"deleted": True}
        except HTTPException:
            raise
        except Exception as exc:
            db.rollback()
            logger.error("delete_task failed: %s", exc)
            raise HTTPException(500, f"Failed to delete task: {exc}")
        finally:
            db.close()

    return router
