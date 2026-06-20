"""In-process approval store for Phase 3 agent write-file gates.

When the agent loop intercepts an approval-gated tool call (write_file, edit_file),
it stores a pending approval here and emits a `tool_approval_request` SSE event.
The user approves or rejects via the thread/approve endpoint.  On approval the
tool is executed immediately and the result stored; on the next send_message the
result is injected into the conversation so the agent can continue.

Thread-safe.  Approvals expire after _TTL_SECONDS (1 hour by default).  Server
restart clears all pending approvals — callers must re-trigger the write.
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Dict, Optional

_TTL_SECONDS: float = 3600.0

_store: Dict[str, dict] = {}
_lock = threading.Lock()


def store_pending(
    *,
    agent_id: str,
    thread_id: str,
    tool_name: str,
    tool_args: dict,
    preview: str,
) -> str:
    request_id = str(uuid.uuid4())
    with _lock:
        _store[request_id] = {
            "request_id": request_id,
            "agent_id": agent_id,
            "thread_id": thread_id,
            "tool_name": tool_name,
            "tool_args": tool_args,
            "preview": preview,
            "status": "pending",
            "result": None,
            "created_at": time.time(),
        }
    return request_id


def get_pending(request_id: str) -> Optional[dict]:
    with _lock:
        entry = _store.get(request_id)
        if entry is None:
            return None
        if time.time() - entry["created_at"] > _TTL_SECONDS:
            del _store[request_id]
            return None
        return dict(entry)


def approve(request_id: str) -> Optional[dict]:
    """Mark a pending approval as approved.  Returns the entry or None if not found."""
    with _lock:
        entry = _store.get(request_id)
        if not entry or entry["status"] != "pending":
            return None
        entry["status"] = "approved"
        return dict(entry)


def reject(request_id: str) -> bool:
    """Mark a pending approval as rejected.  Returns True if found."""
    with _lock:
        entry = _store.get(request_id)
        if not entry or entry["status"] != "pending":
            return False
        entry["status"] = "rejected"
        return True


def set_result(request_id: str, result: dict) -> None:
    """Store the executed tool result and mark status='executed'."""
    with _lock:
        if request_id in _store:
            _store[request_id]["result"] = result
            _store[request_id]["status"] = "executed"


def pop_executed(agent_id: str, thread_id: str) -> Optional[dict]:
    """Return and remove the first executed approval for this agent thread."""
    with _lock:
        for rid, entry in list(_store.items()):
            if (
                entry["agent_id"] == agent_id
                and entry["thread_id"] == thread_id
                and entry["status"] == "executed"
            ):
                del _store[rid]
                return entry
        return None


def list_pending_for_agent(agent_id: str) -> list:
    """Return all pending (not yet decided) approvals for an agent."""
    now = time.time()
    with _lock:
        return [
            dict(e) for e in _store.values()
            if e["agent_id"] == agent_id
            and e["status"] == "pending"
            and now - e["created_at"] <= _TTL_SECONDS
        ]


def _cleanup_expired() -> None:
    now = time.time()
    with _lock:
        expired = [
            rid for rid, e in _store.items()
            if now - e["created_at"] > _TTL_SECONDS
        ]
        for rid in expired:
            del _store[rid]


# ── V4 Phase 4a: per-session rate limiting for gateway-approved tool calls ──

def count_executed_today(agent_id: str, thread_id: str, tool_name: str) -> int:
    """Count `executed` approvals for this (agent_id, thread_id, tool_name)
    triple in the trailing 24 hours.

    Used by the gateway approval endpoint to cap side-effecting actions per
    session (e.g. 3 emails or 10 calendar writes per Discord channel per day).
    The store is in-process and cleared on restart, so a restart effectively
    resets the per-session window — that's intentional (the per-channel
    `!reset` already invalidates the upstream session cache and any rate
    cap with it)."""
    cutoff = time.time() - 86400.0
    with _lock:
        return sum(
            1
            for e in _store.values()
            if e["agent_id"] == agent_id
            and e["thread_id"] == thread_id
            and e["tool_name"] == tool_name
            and e["status"] == "executed"
            and e["created_at"] >= cutoff
        )


def count_pending() -> int:
    """Total non-expired pending approvals across all sessions/agents.

    Used by the gateway status endpoint for the dashboard badge."""
    now = time.time()
    with _lock:
        return sum(
            1
            for e in _store.values()
            if e["status"] == "pending"
            and now - e["created_at"] <= _TTL_SECONDS
        )


def list_recent_executed(limit: int = 5) -> list:
    """Return up to `limit` recently-executed approvals, newest first.

    Each entry is a shallow copy of the stored dict — caller may safely
    mutate or serialize without affecting the live store."""
    with _lock:
        executed = [
            dict(e) for e in _store.values() if e["status"] == "executed"
        ]
    executed.sort(key=lambda e: e["created_at"], reverse=True)
    return executed[: max(0, int(limit))]
