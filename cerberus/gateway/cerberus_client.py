"""
gateway/cerberus_client.py — HTTP client for the Cerberus chat REST API.

This is the critical seam between the gateway and Cerberus.
hermes-agent called its own AIAgent / agent loop here.
We call Cerberus's existing POST /api/chat instead — no agent loop changes.

Session lifecycle:
  - The gateway creates one Cerberus session per (platform, chat_id) pair on
    first use and caches the session ID in memory for the process lifetime.
  - Sessions are created with a gateway-only name prefix so they're
    identifiable in the Cerberus UI.
  - A per-chat asyncio lock prevents concurrent messages from the same chat
    racing on session creation.

Auth:
  - Uses the CERBERUS_GATEWAY_TOKEN as a Bearer token.
  - Falls back to username/password if no token is configured (dev mode).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Dict, Optional

import httpx

from gateway.config import CerberusConfig

logger = logging.getLogger(__name__)

_SESSION_CACHE: Dict[str, str] = {}
_SESSION_LOCKS: Dict[str, asyncio.Lock] = {}
_SESSION_LOCKS_LOCK = asyncio.Lock()

# Maximum characters to return from a Cerberus response (avoid Telegram
# message size limits further up the stack — Telegram caps at 4096 chars;
# that truncation is platform-specific and handled in the adapter).
_MAX_RESPONSE_CHARS = 32_000


async def _session_lock(key: str) -> asyncio.Lock:
    async with _SESSION_LOCKS_LOCK:
        if key not in _SESSION_LOCKS:
            _SESSION_LOCKS[key] = asyncio.Lock()
        return _SESSION_LOCKS[key]


def _auth_headers(cfg: CerberusConfig) -> Dict[str, str]:
    if cfg.token:
        return {"Authorization": f"Bearer {cfg.token}"}
    return {}


async def _get_or_create_session(
    cfg: CerberusConfig,
    client: httpx.AsyncClient,
    cache_key: str,
    session_name: str,
) -> str:
    """Return a cached session ID, or create a new one."""
    if cache_key in _SESSION_CACHE:
        return _SESSION_CACHE[cache_key]

    lock = await _session_lock(cache_key)
    async with lock:
        if cache_key in _SESSION_CACHE:
            return _SESSION_CACHE[cache_key]

        logger.info("cerberus_client: creating session name=%r", session_name)
        try:
            resp = await client.post(
                f"{cfg.api_url}/session",
                data={
                    "name": session_name,
                    "model": cfg.session_model,
                },
                headers=_auth_headers(cfg),
                timeout=15.0,
            )
            resp.raise_for_status()
            data = resp.json()
            session_id = data.get("id") or data.get("session_id")
            if not session_id:
                raise ValueError(f"No session ID in response: {data}")
            _SESSION_CACHE[cache_key] = session_id
            logger.info("cerberus_client: session created id=%r", session_id)
            return session_id
        except Exception as exc:
            raise CerberusClientError(
                f"Failed to create Cerberus session: {exc}"
            ) from exc


class CerberusClientError(RuntimeError):
    """Raised when the Cerberus API returns an error or is unreachable."""


async def send_message(
    cfg: CerberusConfig,
    *,
    platform: str,
    chat_id: str | int,
    message: str,
    session_name_prefix: str = "gateway",
) -> str:
    """
    Send a message to Cerberus and return the assistant's response text.

    Creates (and caches) a session for the (platform, chat_id) pair on first
    call. Raises CerberusClientError on network or API failures.
    """
    cache_key = f"{platform}:{chat_id}"
    session_name = f"{session_name_prefix}:{platform}:{chat_id}"

    # Validate message length before sending
    if not message or not message.strip():
        raise CerberusClientError("Empty message — not sending to Cerberus")
    if len(message) > 50_000:
        message = message[:50_000]

    async with httpx.AsyncClient() as client:
        session_id = await _get_or_create_session(
            cfg, client, cache_key, session_name
        )

        logger.debug(
            "cerberus_client: POST /api/chat session=%r message_len=%d",
            session_id,
            len(message),
        )

        try:
            resp = await client.post(
                f"{cfg.api_url}/api/chat",
                json={
                    "message": message,
                    "session": session_id,
                },
                headers=_auth_headers(cfg),
                timeout=120.0,  # agent tasks can take a while
            )
            resp.raise_for_status()
            data = resp.json()
            response_text = data.get("response", "")
            if not isinstance(response_text, str):
                response_text = str(response_text)
            return response_text[:_MAX_RESPONSE_CHARS]
        except httpx.HTTPStatusError as exc:
            # If the session was deleted on the server, evict it and let
            # the next call recreate it.
            if exc.response.status_code == 404:
                _SESSION_CACHE.pop(cache_key, None)
            raise CerberusClientError(
                f"Cerberus API error {exc.response.status_code}: {exc.response.text[:200]}"
            ) from exc
        except Exception as exc:
            raise CerberusClientError(
                f"Cerberus API unreachable: {exc}"
            ) from exc


def invalidate_session(platform: str, chat_id: str | int) -> None:
    """Remove a cached session, e.g. on /reset command."""
    key = f"{platform}:{chat_id}"
    _SESSION_CACHE.pop(key, None)
    logger.info("cerberus_client: invalidated session cache for %r", key)
