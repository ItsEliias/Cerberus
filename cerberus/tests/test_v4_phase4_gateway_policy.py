"""V4 Phase 4a — gateway tool policy + approval gate tests.

Owner decisions covered (see docs/V4_PHASE4_GATEWAY_THREATMODEL.md):
  - email via Discord allowed only behind owner approval + recipient allowlist
  - calendar writes via Discord allowed only behind owner approval
  - gateway detection via `is_gateway` Boolean on the Session model
  - flat policy across Discord/Telegram/Slack

Verifies:
  1. Session model has the `is_gateway` column.
  2. A gateway session gets the restrictive Tier-A+B allowlist — bash, python,
     write_file, manage_webhooks are all blocked.
  3. Tier A read tools (web_search, manage_calendar, manage_memory, web_fetch,
     search_chats, manage_notes) are NOT blocked under the gateway policy.
  4. `mcp__email__send_email` is in approval_gated_tools when the gateway
     allowlist + approval set are applied.
  5. `manage_calendar` with a write action maps to the `manage_calendar_write`
     sentinel — and that sentinel is in approval_gated_tools.
  6. The approve-endpoint email-allowlist helper rejects a recipient outside
     `GATEWAY_EMAIL_ALLOWLIST` with HTTP 403.
  7. Empty `GATEWAY_EMAIL_ALLOWLIST` blocks every email approve attempt.
  8. The allowlist helper passes through when every recipient is listed.
  9. Per-session rate limit: 3 executed email approvals → 4th raises 429.
 10. A non-gateway session is unaffected — `is_gateway_session()` is False,
     so chat_routes passes `agent_allowlist=None` and no gateway restriction
     applies.

Fast lane (no @pytest.mark.slow). No real DB / HTTP — exercises module-level
helpers and the in-process approval store directly.
"""

import json
import os
import sys
import uuid
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ---------------------------------------------------------------------------
# 1. Session model has the is_gateway column
# ---------------------------------------------------------------------------

def test_is_gateway_column_exists():
    from core.database import Session as DbSession

    cols = {c.name for c in DbSession.__table__.columns}
    assert "is_gateway" in cols, (
        "core.database.Session is missing the is_gateway column added in "
        "V4 Phase 4a (see _migrate_add_is_gateway_column)"
    )

    # In-memory Session dataclass mirror must also expose the field
    from core.models import Session as MemSession

    s = MemSession(id="x", name="", endpoint_url="", model="")
    assert hasattr(s, "is_gateway")
    assert s.is_gateway is False  # default


# ---------------------------------------------------------------------------
# 2. Gateway session policy blocks the Tier-C surface
# ---------------------------------------------------------------------------

def test_gateway_session_gets_restricted_policy():
    from src.tool_policy import build_effective_tool_policy
    from src.tool_security import (
        GATEWAY_APPROVAL_GATED_TOOLS,
        GATEWAY_TOOL_ALLOWLIST,
    )

    policy = build_effective_tool_policy(
        agent_allowlist=GATEWAY_TOOL_ALLOWLIST,
        approval_gated_tools=GATEWAY_APPROVAL_GATED_TOOLS,
    )

    # Tier C — must all be blocked under the gateway policy
    tier_c = [
        "bash", "python", "write_file", "edit_file", "read_file",
        "grep", "glob", "ls",
        "manage_webhooks", "manage_tokens", "manage_settings", "manage_mcp",
        "manage_endpoints",
        "vault_get", "vault_unlock", "vault_search",
        "reply_to_email", "bulk_email", "delete_email", "archive_email",
        "mark_email_read",
        "api_call", "app_api",
        "create_session", "manage_session", "send_to_session", "pipeline",
        "chat_with_model", "generate_image",
        "serve_model", "download_model", "stop_served_model",
    ]
    leaked = [t for t in tier_c if not policy.blocks(t)]
    assert not leaked, f"Tier-C tools leaked through gateway allowlist: {leaked}"


# ---------------------------------------------------------------------------
# 3. Tier A is permitted
# ---------------------------------------------------------------------------

def test_gateway_allows_tier_a_tools():
    from src.tool_policy import build_effective_tool_policy
    from src.tool_security import GATEWAY_TOOL_ALLOWLIST

    policy = build_effective_tool_policy(agent_allowlist=GATEWAY_TOOL_ALLOWLIST)
    tier_a = [
        "web_search", "web_fetch",
        "manage_calendar", "manage_memory", "manage_notes",
        "search_chats",
    ]
    blocked = [t for t in tier_a if policy.blocks(t)]
    assert not blocked, f"Tier-A tools wrongly blocked: {blocked}"


# ---------------------------------------------------------------------------
# 4. Email send requires approval under gateway policy
# ---------------------------------------------------------------------------

def test_gateway_approval_required_for_email():
    from src.tool_policy import build_effective_tool_policy
    from src.tool_security import (
        GATEWAY_APPROVAL_GATED_TOOLS,
        GATEWAY_TOOL_ALLOWLIST,
    )

    policy = build_effective_tool_policy(
        agent_allowlist=GATEWAY_TOOL_ALLOWLIST,
        approval_gated_tools=GATEWAY_APPROVAL_GATED_TOOLS,
    )
    assert "mcp__email__send_email" in policy.approval_gated_tools
    # Email is allowlisted (Tier B) — must not be hard-blocked
    assert not policy.blocks("mcp__email__send_email")


# ---------------------------------------------------------------------------
# 5. Calendar write actions resolve to the sentinel, which is approval-gated
# ---------------------------------------------------------------------------

def test_gateway_approval_required_for_calendar_write():
    from src.tool_policy import build_effective_tool_policy
    from src.tool_security import (
        GATEWAY_APPROVAL_GATED_TOOLS,
        GATEWAY_CALENDAR_WRITE_ACTIONS,
        GATEWAY_TOOL_ALLOWLIST,
        effective_approval_tool_name,
    )

    # The sentinel itself is in the approval set
    assert "manage_calendar_write" in GATEWAY_APPROVAL_GATED_TOOLS

    policy = build_effective_tool_policy(
        agent_allowlist=GATEWAY_TOOL_ALLOWLIST,
        approval_gated_tools=GATEWAY_APPROVAL_GATED_TOOLS,
    )
    assert "manage_calendar_write" in policy.approval_gated_tools

    # Each write action maps `manage_calendar` → sentinel
    for action in GATEWAY_CALENDAR_WRITE_ACTIONS:
        content = json.dumps({"action": action, "title": "x"})
        eff = effective_approval_tool_name("manage_calendar", content)
        assert eff == "manage_calendar_write", (
            f"action={action} should resolve to sentinel, got {eff}"
        )

    # Read actions stay as manage_calendar (Tier A pass-through)
    for action in ("list_events", "get_event"):
        eff = effective_approval_tool_name(
            "manage_calendar", json.dumps({"action": action})
        )
        assert eff == "manage_calendar"


# ---------------------------------------------------------------------------
# 6. Email allowlist rejects unknown recipient (403)
# ---------------------------------------------------------------------------

def test_email_allowlist_blocks_unknown_recipient(monkeypatch):
    from fastapi import HTTPException

    monkeypatch.setenv("GATEWAY_EMAIL_ALLOWLIST", "alice@example.com")
    from routes.cerberus_agent_thread_routes import (
        _enforce_email_recipient_allowlist,
    )

    entry = {
        "tool_name": "mcp__email__send_email",
        "tool_args": {"content": json.dumps({
            "to": "evil@attacker.example",
            "subject": "x", "body": "y",
        })},
    }
    with pytest.raises(HTTPException) as ei:
        _enforce_email_recipient_allowlist(entry)
    assert ei.value.status_code == 403
    assert "GATEWAY_EMAIL_ALLOWLIST" in str(ei.value.detail)


# ---------------------------------------------------------------------------
# 7. Empty GATEWAY_EMAIL_ALLOWLIST blocks ALL email approvals
# ---------------------------------------------------------------------------

def test_email_allowlist_empty_blocks_all(monkeypatch):
    from fastapi import HTTPException

    monkeypatch.delenv("GATEWAY_EMAIL_ALLOWLIST", raising=False)
    from routes.cerberus_agent_thread_routes import (
        _enforce_email_recipient_allowlist,
    )

    entry = {
        "tool_name": "mcp__email__send_email",
        "tool_args": {"content": json.dumps({
            "to": "anybody@example.com",
            "subject": "x", "body": "y",
        })},
    }
    with pytest.raises(HTTPException) as ei:
        _enforce_email_recipient_allowlist(entry)
    assert ei.value.status_code == 403
    assert "empty" in str(ei.value.detail).lower()

    # Blank string should be treated the same as unset
    monkeypatch.setenv("GATEWAY_EMAIL_ALLOWLIST", "   ")
    with pytest.raises(HTTPException) as ei2:
        _enforce_email_recipient_allowlist(entry)
    assert ei2.value.status_code == 403


# ---------------------------------------------------------------------------
# 8. Email allowlist permits known recipient
# ---------------------------------------------------------------------------

def test_email_allowlist_permits_known_recipient(monkeypatch):
    monkeypatch.setenv(
        "GATEWAY_EMAIL_ALLOWLIST",
        "alice@example.com, bob@example.com",
    )
    from routes.cerberus_agent_thread_routes import (
        _enforce_email_recipient_allowlist,
    )

    # Single-recipient string
    entry = {
        "tool_name": "mcp__email__send_email",
        "tool_args": {"content": json.dumps({
            "to": "alice@example.com",
            "subject": "x", "body": "y",
        })},
    }
    # No raise = pass
    _enforce_email_recipient_allowlist(entry)

    # Case-insensitive
    entry["tool_args"]["content"] = json.dumps({
        "to": "ALICE@Example.com",
        "subject": "x", "body": "y",
    })
    _enforce_email_recipient_allowlist(entry)

    # to + cc + bcc all allowed
    entry["tool_args"]["content"] = json.dumps({
        "to": "alice@example.com",
        "cc": "bob@example.com",
        "subject": "x", "body": "y",
    })
    _enforce_email_recipient_allowlist(entry)

    # Non-email tool always passes through
    _enforce_email_recipient_allowlist({
        "tool_name": "manage_calendar",
        "tool_args": {"content": "{}"},
    })


# ---------------------------------------------------------------------------
# 9. Per-session rate limit — 3 executed emails → 4th raises 429
# ---------------------------------------------------------------------------

def test_gateway_rate_limit_email():
    from fastapi import HTTPException

    import src.agent_approval as aa
    from routes.cerberus_agent_thread_routes import _enforce_gateway_rate_limit

    sid = f"sess-{uuid.uuid4().hex[:8]}"

    # Seed 3 executed entries scoped to this session
    for _ in range(3):
        rid = aa.store_pending(
            agent_id="",
            thread_id=sid,
            tool_name="mcp__email__send_email",
            tool_args={"content": json.dumps({"to": "alice@example.com"})},
            preview="",
        )
        aa.approve(rid)
        aa.set_result(rid, {"ok": True})

    # 4th approval — must hit the cap
    pending_entry = {
        "agent_id": "",
        "thread_id": sid,
        "tool_name": "mcp__email__send_email",
    }
    with pytest.raises(HTTPException) as ei:
        _enforce_gateway_rate_limit(pending_entry)
    assert ei.value.status_code == 429
    assert "3/3" in str(ei.value.detail) or "rate limit" in str(ei.value.detail).lower()

    # Other-session same tool still has headroom
    other_sid = f"sess-{uuid.uuid4().hex[:8]}"
    _enforce_gateway_rate_limit(
        {"agent_id": "", "thread_id": other_sid, "tool_name": "mcp__email__send_email"}
    )

    # An uncapped tool name passes through regardless
    _enforce_gateway_rate_limit(
        {"agent_id": "", "thread_id": sid, "tool_name": "write_file"}
    )


# ---------------------------------------------------------------------------
# 10. Non-gateway session is unaffected
# ---------------------------------------------------------------------------

def test_non_gateway_session_unaffected():
    from src.tool_policy import build_effective_tool_policy
    from src.tool_security import is_gateway_session

    # is_gateway_session returns False for: None, default Session, bare object
    assert is_gateway_session(None) is False
    from core.models import Session as MemSession
    sess_default = MemSession(id="x", name="", endpoint_url="", model="")
    assert is_gateway_session(sess_default) is False
    assert is_gateway_session(object()) is False

    # …True for explicit is_gateway=True
    sess_gw = MemSession(
        id="y", name="gateway:discord:1", endpoint_url="", model="",
        is_gateway=True,
    )
    assert is_gateway_session(sess_gw) is True

    # chat_routes branch on is_gateway: with False we pass agent_allowlist=None,
    # which means no Phase 4a restriction is applied to the resulting policy.
    is_gw = is_gateway_session(sess_default)
    policy = build_effective_tool_policy(
        agent_allowlist=None if not is_gw else frozenset({"web_search"}),
        approval_gated_tools=None if not is_gw else frozenset({"write_file"}),
    )
    # Without an allowlist, normal tools are NOT auto-blocked by Phase 4a
    assert not policy.blocks("bash")
    assert not policy.blocks("write_file")
    assert not policy.blocks("manage_calendar")
    # And no approval gating layered on
    assert len(policy.approval_gated_tools) == 0
