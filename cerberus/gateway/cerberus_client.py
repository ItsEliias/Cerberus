"""
gateway/cerberus_client.py — HTTP client for the Cerberus chat REST API.

Routes Discord/Telegram/Slack messages through the Cerberus agent thread
endpoint (/api/agents/{id}/thread/send) so the gateway has a proper identity,
system prompt, and persistent conversation history.

Auth: cookie-based session (logs in as the gateway user on first use).
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

# Cache the auth cookie for the process lifetime
_AUTH_COOKIE: Optional[str] = None
_AUTH_LOCK = asyncio.Lock()

# Cache per-channel session locks
_SESSION_LOCKS: Dict[str, asyncio.Lock] = {}
_SESSION_LOCKS_LOCK = asyncio.Lock()

_MAX_RESPONSE_CHARS = 32_000

GATEWAY_AGENT_ID = os.environ.get("CERBERUS_GATEWAY_AGENT_ID", "")


async def _session_lock(key: str) -> asyncio.Lock:
    async with _SESSION_LOCKS_LOCK:
        if key not in _SESSION_LOCKS:
            _SESSION_LOCKS[key] = asyncio.Lock()
        return _SESSION_LOCKS[key]


async def _get_auth_cookie(cfg: CerberusConfig, client: httpx.AsyncClient) -> str:
    """Login to Cerberus and return the session cookie value."""
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


class CerberusClientError(RuntimeError):
    pass


async def send_message(
    cfg: CerberusConfig,
    *,
    platform: str,
    chat_id: str | int,
    message: str,
    session_name_prefix: str = "gateway",
) -> str:
    """
    Send a message to Cerberus via the agent thread endpoint and return
    the full assistant response text.
    """
    if not message or not message.strip():
        raise CerberusClientError("Empty message")
    if len(message) > 50_000:
        message = message[:50_000]

    if not GATEWAY_AGENT_ID:
        raise CerberusClientError(
            "CERBERUS_GATEWAY_AGENT_ID not set — create a gateway agent and set the env var"
        )

    async with httpx.AsyncClient(follow_redirects=False) as client:
        cookie = await _get_auth_cookie(cfg, client)

        logger.debug(
            "cerberus_client: POST /api/agents/%s/thread/send message_len=%d",
            GATEWAY_AGENT_ID, len(message),
        )

        try:
            async with client.stream(
                "POST",
                f"{cfg.api_url}/api/agents/{GATEWAY_AGENT_ID}/thread/send",
                json={"message": message},
                headers=_cookie_header(cookie),
                timeout=120.0,
            ) as resp:
                if resp.status_code == 401:
                    # Cookie expired — clear and retry once
                    global _AUTH_COOKIE
                    _AUTH_COOKIE = None
                    cookie = await _get_auth_cookie(cfg, client)
                    raise CerberusClientError("Auth expired — retry")

                if resp.status_code != 200:
                    body = await resp.aread()
                    raise CerberusClientError(
                        f"Cerberus API error {resp.status_code}: {body[:200].decode()}"
                    )

                # Consume SSE stream and collect text deltas
                parts: list[str] = []
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if not raw or "[DONE]" in raw:
                        continue
                    try:
                        obj = json.loads(raw)
                        if obj.get("type") == "usage":
                            continue
                        delta = (
                            obj.get("delta")
                            or obj.get("text")
                            or obj.get("content")
                            or ""
                        )
                        if delta:
                            parts.append(delta)
                    except Exception:
                        pass

                response_text = "".join(parts)
                return response_text[:_MAX_RESPONSE_CHARS] if response_text else ""

        except CerberusClientError:
            raise
        except Exception as exc:
            raise CerberusClientError(f"Cerberus API unreachable: {exc}") from exc


def invalidate_session(platform: str, chat_id: str | int) -> None:
    """On !reset — clear the agent thread instead of a session."""
    logger.info("cerberus_client: reset requested for %s:%s", platform, chat_id)
    # Thread history is cleared via DELETE /api/agents/{id}/thread
    # We fire this async in the background from the discord adapter
