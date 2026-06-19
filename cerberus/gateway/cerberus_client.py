"""
gateway/cerberus_client.py — HTTP client for the Cerberus chat REST API.

Routes messages through /api/chat (the main session endpoint) so the gateway
has full tool access — calendar, files, email, web search, etc.

Auth: cookie-based login via POST /api/auth/login (cached for process lifetime).
Session: one Cerberus session per (platform, chat_id), created on first use
         and cached. !reset clears both the local cache and the remote history.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Dict, Optional

import httpx

from gateway.config import CerberusConfig

logger = logging.getLogger(__name__)

# Process-lifetime caches
_AUTH_COOKIE: Optional[str] = None
_AUTH_LOCK = asyncio.Lock()

_SESSION_CACHE: Dict[str, str] = {}          # cache_key → cerberus session id
_SESSION_LOCKS: Dict[str, asyncio.Lock] = {}
_SESSION_LOCKS_LOCK = asyncio.Lock()

_MAX_RESPONSE_CHARS = 32_000


class CerberusClientError(RuntimeError):
    pass


# ── Auth ──────────────────────────────────────────────────────────────────────

async def _get_auth_cookie(cfg: CerberusConfig, client: httpx.AsyncClient) -> str:
    global _AUTH_COOKIE
    async with _AUTH_LOCK:
        if _AUTH_COOKIE:
            return _AUTH_COOKIE
        resp = await client.post(
            f"{cfg.api_url}/api/auth/login",
            json={"username": cfg.username, "password": cfg.token, "remember": True},
            timeout=15.0,
        )
        resp.raise_for_status()
        cookie = resp.cookies.get("cerberus_session")
        if not cookie:
            raise CerberusClientError("Login succeeded but no session cookie returned")
        _AUTH_COOKIE = cookie
        logger.info("cerberus_client: authenticated as %r", cfg.username)
        return cookie


def _cookie_header(cookie: str) -> Dict[str, str]:
    return {"Cookie": f"cerberus_session={cookie}"}


def _clear_auth_cookie() -> None:
    global _AUTH_COOKIE
    _AUTH_COOKIE = None


# ── Session management ────────────────────────────────────────────────────────

async def _channel_lock(key: str) -> asyncio.Lock:
    async with _SESSION_LOCKS_LOCK:
        if key not in _SESSION_LOCKS:
            _SESSION_LOCKS[key] = asyncio.Lock()
        return _SESSION_LOCKS[key]


async def _get_or_create_session(
    cfg: CerberusConfig,
    client: httpx.AsyncClient,
    cookie: str,
    cache_key: str,
    session_name: str,
) -> str:
    if cache_key in _SESSION_CACHE:
        return _SESSION_CACHE[cache_key]

    lock = await _channel_lock(cache_key)
    async with lock:
        if cache_key in _SESSION_CACHE:
            return _SESSION_CACHE[cache_key]

        logger.info("cerberus_client: creating session name=%r", session_name)
        resp = await client.post(
            f"{cfg.api_url}/session",
            data={"name": session_name, "model": cfg.session_model},
            headers=_cookie_header(cookie),
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()
        session_id = data.get("id") or data.get("session_id")
        if not session_id:
            raise CerberusClientError(f"No session ID in response: {data}")
        _SESSION_CACHE[cache_key] = session_id
        logger.info("cerberus_client: session created id=%r", session_id)
        return session_id


# ── Public interface ──────────────────────────────────────────────────────────

async def send_message(
    cfg: CerberusConfig,
    *,
    platform: str,
    chat_id: str | int,
    message: str,
    session_name_prefix: str = "gateway",
) -> str:
    """Send a message through /api/chat and return the assistant response."""
    if not message or not message.strip():
        raise CerberusClientError("Empty message")
    if len(message) > 50_000:
        message = message[:50_000]

    cache_key = f"{platform}:{chat_id}"
    session_name = f"{session_name_prefix}:{platform}:{chat_id}"

    async with httpx.AsyncClient(follow_redirects=False) as client:
        cookie = await _get_auth_cookie(cfg, client)

        # Ensure a Cerberus chat session exists for this channel
        try:
            session_id = await _get_or_create_session(
                cfg, client, cookie, cache_key, session_name
            )
        except Exception as exc:
            raise CerberusClientError(f"Failed to get/create session: {exc}") from exc

        logger.debug(
            "cerberus_client: POST /api/chat session=%r message_len=%d",
            session_id, len(message),
        )

        try:
            resp = await client.post(
                f"{cfg.api_url}/api/chat",
                json={"message": message, "session": session_id},
                headers=_cookie_header(cookie),
                timeout=120.0,
            )

            if resp.status_code == 401:
                # Cookie expired — clear, re-auth, retry once
                _clear_auth_cookie()
                cookie = await _get_auth_cookie(cfg, client)
                resp = await client.post(
                    f"{cfg.api_url}/api/chat",
                    json={"message": message, "session": session_id},
                    headers=_cookie_header(cookie),
                    timeout=120.0,
                )

            if resp.status_code == 404:
                # Session was deleted server-side — evict and let next call recreate
                _SESSION_CACHE.pop(cache_key, None)
                raise CerberusClientError(
                    "Chat session not found (deleted server-side) — retry"
                )

            resp.raise_for_status()
            data = resp.json()
            response_text = data.get("response", "")
            if not isinstance(response_text, str):
                response_text = str(response_text)
            return response_text[:_MAX_RESPONSE_CHARS]

        except CerberusClientError:
            raise
        except Exception as exc:
            raise CerberusClientError(f"Cerberus API unreachable: {exc}") from exc


def invalidate_session(platform: str, chat_id: str | int) -> None:
    """Remove the cached session for this channel (called on !reset)."""
    key = f"{platform}:{chat_id}"
    removed = _SESSION_CACHE.pop(key, None)
    if removed:
        logger.info("cerberus_client: invalidated session %r for %r", removed, key)
    else:
        logger.info("cerberus_client: no cached session for %r to invalidate", key)
