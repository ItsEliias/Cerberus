"""Owner-saved council presets.

A saved room composition beyond the seven hardcoded templates in
routes/room_template_routes.py. The owner saves the current room's
participant names as a named preset; later they can launch a fresh
ConferenceRoom from any preset with one click.

Endpoints (all owner-only via require_user):
  GET    /api/council/presets                 → list owner's presets
  POST   /api/council/presets                 → create from {name, description, agent_names}
  DELETE /api/council/presets/{id}            → delete
  POST   /api/council/presets/{id}/create-room → spin up a fresh room

Room creation mirrors room_template_routes.py's create_from_template:
resolve agent names within the caller's CerberusAgent collection,
JSON-encode the resolved ids, insert a ConferenceRoom row, and return
the same _room_dict() shape so the frontend can drop the payload
straight into the existing room-open flow.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from core.database import (
    CerberusAgent,
    ConferenceRoom,
    CouncilPreset,
    SessionLocal,
)
from src.auth_helpers import require_user

logger = logging.getLogger(__name__)


# Caps mirror the existing room/template flow + a reasonable budget for a
# stored preset description.
_MAX_NAME_LEN = 100
_MAX_DESC_LEN = 500
_MAX_AGENTS   = 32


class CouncilPresetCreate(BaseModel):
    name: str = Field(..., max_length=_MAX_NAME_LEN)
    description: Optional[str] = Field(None, max_length=_MAX_DESC_LEN)
    agent_names: List[str] = Field(default_factory=list)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _preset_dict(p: CouncilPreset) -> Dict[str, Any]:
    """Serialise a CouncilPreset row for the API. agent_names is JSON in the
    DB; surface a list. agent_count is included as a convenience so the UI
    doesn't have to len(agent_names) on every render."""
    try:
        names = json.loads(p.agent_names or "[]")
        if not isinstance(names, list):
            names = []
    except (TypeError, ValueError):
        names = []
    return {
        "id": p.id,
        "owner": p.owner,
        "name": p.name,
        "description": p.description,
        "agent_names": names,
        "agent_count": len(names),
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def _room_dict(room: ConferenceRoom) -> Dict[str, Any]:
    """Same shape room_template_routes._room_dict emits — keep them in sync
    so the frontend's _openRoom flow accepts either payload."""
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


def setup_council_preset_routes() -> APIRouter:
    """Factory for the council-presets router. Mounted under /api/council."""

    router = APIRouter(prefix="/api/council", tags=["council-presets"])

    # ── GET /api/council/presets ──────────────────────────────────────────

    @router.get("/presets")
    def list_presets(request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            rows = (
                db.query(CouncilPreset)
                .filter(CouncilPreset.owner == owner)
                .order_by(CouncilPreset.created_at.desc())
                .all()
            )
            return {"presets": [_preset_dict(p) for p in rows]}
        finally:
            db.close()

    # ── POST /api/council/presets ─────────────────────────────────────────

    @router.post("/presets")
    def create_preset(request: Request, body: CouncilPresetCreate) -> Dict[str, Any]:
        owner = require_user(request)
        name = (body.name or "").strip()
        if not name:
            raise HTTPException(400, "Preset name is required")

        # Trim + cap the agent_names list. We DON'T validate that each name
        # resolves to an existing CerberusAgent at save time — the owner may
        # save a preset that references an agent they later delete, and we
        # still want the preset to load (the create-room handler will skip
        # missing agents, same as room_template_routes does).
        raw_names = body.agent_names or []
        names: List[str] = []
        seen = set()
        for n in raw_names:
            s = str(n).strip()
            if s and s not in seen:
                seen.add(s)
                names.append(s)
            if len(names) >= _MAX_AGENTS:
                break
        if not names:
            raise HTTPException(400, "At least one agent_name is required")

        description = (body.description or "").strip() or None

        db = SessionLocal()
        try:
            preset = CouncilPreset(
                id=str(uuid.uuid4()),
                owner=owner,
                name=name,
                description=description,
                agent_names=json.dumps(names),
                created_at=_utcnow(),
            )
            db.add(preset)
            db.commit()
            db.refresh(preset)
            return _preset_dict(preset)
        finally:
            db.close()

    # ── DELETE /api/council/presets/{id} ──────────────────────────────────

    @router.delete("/presets/{preset_id}")
    def delete_preset(request: Request, preset_id: str) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            preset = (
                db.query(CouncilPreset)
                .filter(CouncilPreset.id == preset_id)
                .first()
            )
            if not preset:
                raise HTTPException(404, "Preset not found")
            # Owner-scope: 404 (not 403) so existence isn't leaked through
            # the response code — mirrors the gateway/mobile pattern.
            if owner and preset.owner != owner:
                raise HTTPException(404, "Preset not found")
            db.delete(preset)
            db.commit()
            return {"status": "deleted", "id": preset_id}
        finally:
            db.close()

    # ── POST /api/council/presets/{id}/create-room ───────────────────────

    @router.post("/presets/{preset_id}/create-room")
    def create_room_from_preset(request: Request, preset_id: str) -> Dict[str, Any]:
        owner = require_user(request)
        db = SessionLocal()
        try:
            preset = (
                db.query(CouncilPreset)
                .filter(CouncilPreset.id == preset_id)
                .first()
            )
            if not preset:
                raise HTTPException(404, "Preset not found")
            if owner and preset.owner != owner:
                raise HTTPException(404, "Preset not found")

            try:
                wanted = json.loads(preset.agent_names or "[]")
                if not isinstance(wanted, list):
                    wanted = []
            except (TypeError, ValueError):
                wanted = []
            if not wanted:
                raise HTTPException(400, "Preset has no agent_names")

            # Same resolve-by-name path as room_template_routes — missing
            # agents are skipped (logged), not 500'd, but if NONE resolve
            # the preset is unusable for this owner and we 400.
            agents = (
                db.query(CerberusAgent)
                .filter(
                    CerberusAgent.owner == owner,
                    CerberusAgent.name.in_(wanted),
                )
                .all()
            )
            by_name = {a.name: a.id for a in agents}
            resolved_ids: List[str] = []
            for name in wanted:
                aid = by_name.get(name)
                if aid:
                    resolved_ids.append(aid)
                else:
                    logger.warning(
                        "council preset %s: skipping missing agent %s for owner %s",
                        preset_id, name, owner,
                    )
            if not resolved_ids:
                raise HTTPException(400, "No matching agents found for preset")

            room_name = f"{preset.name} — {_utcnow().strftime('%d %b %H:%M')}"
            room = ConferenceRoom(
                id=str(uuid.uuid4()),
                name=room_name,
                owner=owner,
                participant_ids=json.dumps(resolved_ids),
            )
            db.add(room)
            db.commit()
            db.refresh(room)
            return {"room": _room_dict(room), "preset_id": preset_id}
        finally:
            db.close()

    return router
