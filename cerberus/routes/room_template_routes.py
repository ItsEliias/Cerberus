"""Conference Room template routes.

Hardcoded preset templates that spin up a multi-agent room with one click.
Templates are not stored in the DB — they're a fixed list of common team
compositions surfaced through two endpoints:

  GET  /api/rooms/templates                       — list templates (no auth)
  POST /api/rooms/templates/{template_id}/create  — create room from template

Room creation mirrors POST /api/rooms in conference_room_routes.py: agents are
resolved by name within the caller's CerberusAgent collection, then a
ConferenceRoom is inserted with the JSON-encoded participant_ids. Agents that
don't exist for this owner are skipped (logged), not 500'd — but if NONE
resolve we return 400 so the caller learns the template is unusable here.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Request

from core.database import CerberusAgent, ConferenceRoom, SessionLocal
from src.auth_helpers import require_user

logger = logging.getLogger(__name__)


# Preset templates. Order is the display order in the UI. Each `agents` entry
# is a CerberusAgent.name (case-sensitive) — name lookup happens per owner.
_TEMPLATES: List[Dict[str, Any]] = [
    {
        "id": "ship-a-feature",
        "name": "Ship a Feature",
        "description": "Full delivery cycle — architecture through review.",
        "icon": "🚀",
        "agents": ["ORCHESTRATOR", "ARCHITECT", "CODER", "TESTER", "REVIEWER"],
    },
    {
        "id": "security-audit",
        "name": "Security Audit",
        "description": "Threat model, code audit, and hardening review.",
        "icon": "🔒",
        "agents": ["ORCHESTRATOR", "SECURITY", "REVIEWER", "DEVOPS"],
    },
    {
        "id": "research-and-plan",
        "name": "Research & Plan",
        "description": "Investigate a problem and produce a phased plan.",
        "icon": "🔭",
        "agents": ["ORCHESTRATOR", "RESEARCHER", "PLANNER", "SCRIBE"],
    },
    {
        "id": "debug-and-fix",
        "name": "Debug & Fix",
        "description": "Root-cause a bug, fix it, and verify the fix.",
        "icon": "🐛",
        "agents": ["ORCHESTRATOR", "DEBUGGER", "CODER", "TESTER"],
    },
    {
        "id": "data-sprint",
        "name": "Data Sprint",
        "description": "Analyse data, surface insights, document findings.",
        "icon": "📊",
        "agents": ["ORCHESTRATOR", "DATA-ANALYST", "RESEARCHER", "SCRIBE"],
    },
    {
        "id": "design-review",
        "name": "Design Review",
        "description": "Critique and improve a UI/UX design or component.",
        "icon": "🎨",
        "agents": ["ORCHESTRATOR", "DESIGNER", "REVIEWER", "SCRIBE"],
    },
    {
        "id": "optimise",
        "name": "Optimise",
        "description": "Profile, identify bottlenecks, and improve performance.",
        "icon": "⚡",
        "agents": ["ORCHESTRATOR", "OPTIMIZER", "CODER", "TESTER"],
    },
]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _find_template(template_id: str) -> Dict[str, Any]:
    for tpl in _TEMPLATES:
        if tpl["id"] == template_id:
            return tpl
    raise HTTPException(404, "Template not found")


def _room_dict(room: ConferenceRoom) -> Dict[str, Any]:
    """Mirror conference_room_routes._room_dict so the frontend can drop the
    payload straight into the existing room list/open flow."""
    return {
        "id": room.id,
        "name": room.name,
        "owner": room.owner,
        "participant_ids": json.loads(room.participant_ids or "[]"),
        "created_at": room.created_at.isoformat() if room.created_at else None,
        "last_message_at": room.last_message_at.isoformat() if room.last_message_at else None,
        "message_count": room.message_count or 0,
        "mode": getattr(room, "mode", None) or "routed",
        "round_cap": getattr(room, "round_cap", None) or 5,
        "total_input_tokens": getattr(room, "total_input_tokens", None) or 0,
        "total_output_tokens": getattr(room, "total_output_tokens", None) or 0,
    }


def setup_room_template_routes() -> APIRouter:
    router = APIRouter(prefix="/api/rooms/templates", tags=["conference-rooms"])

    @router.get("")
    def list_templates() -> Dict[str, Any]:
        return {"templates": list(_TEMPLATES)}

    @router.post("/{template_id}/create")
    def create_from_template(template_id: str, request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        tpl = _find_template(template_id)

        db = SessionLocal()
        try:
            agents = (
                db.query(CerberusAgent)
                .filter(
                    CerberusAgent.owner == owner,
                    CerberusAgent.name.in_(tpl["agents"]),
                )
                .all()
            )
            by_name = {a.name: a.id for a in agents}
            resolved_ids: List[str] = []
            for name in tpl["agents"]:
                aid = by_name.get(name)
                if aid:
                    resolved_ids.append(aid)
                else:
                    logger.warning(
                        "room template %s: skipping missing agent %s for owner %s",
                        template_id, name, owner,
                    )

            if not resolved_ids:
                raise HTTPException(400, "No matching agents found for template")

            room_name = f"{tpl['name']} — {_utcnow().strftime('%d %b %H:%M')}"
            room = ConferenceRoom(
                id=str(uuid.uuid4()),
                name=room_name,
                owner=owner,
                participant_ids=json.dumps(resolved_ids),
            )
            db.add(room)
            db.commit()
            db.refresh(room)
            return {"room": _room_dict(room), "template_id": template_id}
        finally:
            db.close()

    return router
