"""CC email composer endpoints.

Two thin endpoints power the GATEWAY-tab email composer panel:

  GET  /api/email/compose-allowlist
        Returns the GATEWAY_EMAIL_ALLOWLIST addresses (lowercased, de-duped)
        so the composer can prefill the "to" field. Owner-only — the
        composer is mounted in the CC, which is itself owner-only.

  POST /api/email/compose-send
        Owner-only. Validates the request body (`to`, `subject`, `body`
        all required) and the recipient against GATEWAY_EMAIL_ALLOWLIST
        BEFORE touching the SMTP layer. On success delegates to the
        existing _send_smtp_message helper from email_helpers; returns
        { ok: bool, error: str|None } so the composer can render
        // SENT / // FAILED / // BLOCKED status.

Separate from /api/email/send because:
  - /api/email/send powers many flows (drafts, replies, attachments,
    Cerberus-internal mail) and adding a hard GATEWAY_EMAIL_ALLOWLIST
    check there would break unrelated paths.
  - The composer is a CC-only surface — only this path needs the
    allowlist enforcement.

This module re-uses the proven SMTP plumbing from routes.email_routes /
routes.email_helpers; it does NOT re-implement send/MIME logic.
"""

from __future__ import annotations

import logging
import os
from email.message import EmailMessage
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


_ALLOWLIST_ENV = "GATEWAY_EMAIL_ALLOWLIST"


def _parse_allowlist() -> List[str]:
    """Return GATEWAY_EMAIL_ALLOWLIST as a lowercased, de-duped list.

    Empty (env unset or blank) → empty list. Same parsing as the gateway
    approval endpoint so a recipient that's accepted there is accepted here."""
    raw = os.environ.get(_ALLOWLIST_ENV, "").strip()
    if not raw:
        return []
    seen: Dict[str, None] = {}
    for entry in raw.split(","):
        entry = entry.strip().lower()
        if entry:
            seen.setdefault(entry, None)
    return list(seen.keys())


class ComposeSendRequest(BaseModel):
    to: str = Field(..., max_length=254)
    subject: str = Field(..., max_length=998)
    body: str = Field(..., max_length=200_000)


def setup_email_compose_routes() -> APIRouter:
    """Factory for the CC email compose router.

    The factory pattern keeps test setup symmetrical with
    setup_email_routes / setup_webhook_routes — tests construct a fresh
    router per test fixture and pull the handler directly off it."""

    router = APIRouter(prefix="/api/email", tags=["email-compose"])

    # --- helpers (imported lazily so this module stays importable in
    #     environments where routes.email_routes can't load — e.g. early
    #     test collection paths) -----------------------------------------

    def _resolve_owner(request: Request) -> str:
        from src.auth_helpers import require_user
        return require_user(request)

    def _resolve_smtp_config(owner: str) -> Dict[str, Any]:
        from routes.email_routes import _resolve_send_config
        return _resolve_send_config(None, owner=owner)

    def _smtp_send(cfg: Dict[str, Any], from_addr: str,
                   recipients: List[str], message: str) -> None:
        from routes.email_helpers import _send_smtp_message
        _send_smtp_message(cfg, from_addr, recipients, message)

    # --- GET /api/email/compose-allowlist -----------------------------

    @router.get("/compose-allowlist")
    def compose_allowlist(request: Request) -> Dict[str, Any]:
        _resolve_owner(request)
        addresses = _parse_allowlist()
        return {
            "addresses": addresses,
            "count": len(addresses),
            "enabled": bool(addresses),
        }

    # --- POST /api/email/compose-send ---------------------------------

    @router.post("/compose-send")
    def compose_send(request: Request, body: ComposeSendRequest) -> Dict[str, Any]:
        owner = _resolve_owner(request)

        # 1. Body-level validation — Pydantic enforces presence; trim
        #    whitespace and reject if any field collapses to empty.
        to = (body.to or "").strip()
        subject = (body.subject or "").strip()
        message_body = (body.body or "").strip()
        if not to:
            raise HTTPException(400, "Recipient (to) is required")
        if not subject:
            raise HTTPException(400, "Subject is required")
        if not message_body:
            raise HTTPException(400, "Message body is required")

        # 2. Recipient allowlist — checked BEFORE SMTP resolve so a
        #    misconfigured env doesn't leak a connection attempt for a
        #    disallowed address. The composer prefills from the allowlist,
        #    so a 403 only fires when the user types/edits a non-allowed
        #    address manually.
        allowlist = set(_parse_allowlist())
        if not allowlist:
            raise HTTPException(
                403,
                f"Email send is blocked: {_ALLOWLIST_ENV} is empty",
            )
        if to.lower() not in allowlist:
            raise HTTPException(
                403,
                f"Recipient not in {_ALLOWLIST_ENV}: {to}",
            )

        # 3. Resolve SMTP config (same lookup the main /api/email/send
        #    uses) and bail with a structured error if no account is
        #    SMTP-ready.
        try:
            cfg = _resolve_smtp_config(owner)
        except Exception as exc:
            logger.warning("compose_send: SMTP config resolve failed: %s", exc)
            return {"ok": False, "error": str(exc) or "No SMTP-capable email account configured"}

        # 4. Build a minimal EmailMessage — plain-text only by design.
        #    The composer is a quick-send surface; richer formatting is
        #    out of scope and would duplicate the main email flow.
        msg = EmailMessage()
        from_addr = cfg.get("from_address") or cfg.get("smtp_user") or ""
        msg["From"] = from_addr
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(message_body)

        try:
            _smtp_send(cfg, from_addr, [to], msg.as_string())
        except Exception as exc:
            logger.exception("compose_send: SMTP delivery failed")
            return {"ok": False, "error": str(exc) or "SMTP delivery failed"}

        return {"ok": True, "error": None}

    return router
