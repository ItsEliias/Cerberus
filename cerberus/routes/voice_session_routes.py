"""Voice session listing — read-only view over the Note store.

Voice calls (static/js/cyberapps/command-center/voice.js) persist their
transcript as a Note with ``source='voice'`` and a ``Voice session — …``
title when the user backs out of the call. This route surfaces the most
recent such notes so the voice panel can show a "RECENT SESSIONS" block
without standing up a dedicated schema.

  GET /api/voice/sessions?limit=20

Returns the caller's last N voice notes, newest first. Response shape is
deliberately narrow (id/title/created_at/preview) so the frontend doesn't
need to fetch the full Note document just to render a row.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request

from core.database import Note, SessionLocal
from src.auth_helpers import require_user

logger = logging.getLogger(__name__)

_DEFAULT_LIMIT = 20
_MAX_LIMIT = 100
_PREVIEW_CHARS = 100
_VOICE_SOURCE = "voice"
_TITLE_PREFIX = "Voice session —"


def _preview(content: Optional[str]) -> str:
    if not content:
        return ""
    text = " ".join(content.split())  # collapse whitespace for a clean preview
    return text[:_PREVIEW_CHARS]


def _session_dict(note: Note) -> Dict[str, Any]:
    return {
        "id": note.id,
        "title": note.title or "",
        "created_at": note.created_at.isoformat() if note.created_at else None,
        "preview": _preview(note.content),
    }


def setup_voice_session_routes() -> APIRouter:
    router = APIRouter(prefix="/api/voice", tags=["voice"])

    @router.get("/sessions")
    def list_voice_sessions(
        request: Request,
        limit: int = _DEFAULT_LIMIT,
    ) -> Dict[str, List[Dict[str, Any]]]:
        owner = require_user(request)
        # Clamp limit so a hostile client can't sweep the whole table.
        try:
            limit = max(1, min(int(limit), _MAX_LIMIT))
        except (TypeError, ValueError):
            limit = _DEFAULT_LIMIT

        db = SessionLocal()
        try:
            # source='voice' is the primary marker (set by the voice panel POST).
            # The title-prefix branch covers notes written by older voice
            # builds before the source field was wired up — keeps history
            # surfaced even on rolling upgrades.
            notes = (
                db.query(Note)
                .filter(Note.owner == owner)
                .filter(Note.archived == False)  # noqa: E712 — sqlalchemy filter
                .filter(
                    (Note.source == _VOICE_SOURCE)
                    | (Note.title.like(f"{_TITLE_PREFIX}%"))
                )
                .order_by(Note.created_at.desc())
                .limit(limit)
                .all()
            )
            return {"sessions": [_session_dict(n) for n in notes]}
        finally:
            db.close()

    return router
