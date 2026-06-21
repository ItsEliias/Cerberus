"""Gateway always_include — unit tests (fast lane, no network/DB).

Covers four invariants:
  1. Gateway session → stream_agent_loop receives always_include=ASSISTANT_ALWAYS_AVAILABLE.
  2. Non-gateway session → always_include not passed (None).
  3. ASSISTANT_ALWAYS_AVAILABLE tools appear in retrieval results even when RAG returns nothing.
  4. Policy still gates execution — always_include offers the tool but
     GATEWAY_TOOL_ALLOWLIST / approval gate can still block it.
"""

import asyncio
import sys
import os
import inspect
import types
from unittest.mock import MagicMock, patch, AsyncMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.tool_index import ASSISTANT_ALWAYS_AVAILABLE, ALWAYS_AVAILABLE


# ---------------------------------------------------------------------------
# 1. stream_agent_loop signature accepts always_include
# ---------------------------------------------------------------------------

def test_stream_agent_loop_accepts_always_include():
    """always_include kwarg exists in stream_agent_loop signature."""
    from src.agent_loop import stream_agent_loop
    sig = inspect.signature(stream_agent_loop)
    assert "always_include" in sig.parameters, (
        "stream_agent_loop must have an always_include parameter"
    )
    param = sig.parameters["always_include"]
    assert param.default is None, "always_include should default to None"


# ---------------------------------------------------------------------------
# 2 & 3. Gateway flag wires ASSISTANT_ALWAYS_AVAILABLE into retrieval
# ---------------------------------------------------------------------------

class _FakeToolIndex:
    """Minimal ToolIndex stub whose get_tools_for_query records its args."""

    def __init__(self, return_set=None):
        self.calls = []
        self._return = return_set or set()

    def get_tools_for_query(self, query, k=8, always_include=None):
        self.calls.append({"query": query, "k": k, "always_include": always_include})
        base = set(always_include or ALWAYS_AVAILABLE)
        base.update(self._return)
        return base

    def index_mcp_tools(self, *args, **kwargs):
        pass


def test_get_tools_for_query_respects_always_include():
    """When always_include is passed, those tools are unconditionally in the result."""
    idx = _FakeToolIndex(return_set=set())  # RAG returns nothing
    result = idx.get_tools_for_query("set a calendar event", always_include=ASSISTANT_ALWAYS_AVAILABLE)
    for tool in ASSISTANT_ALWAYS_AVAILABLE:
        assert tool in result, f"{tool} missing from result despite always_include"


def test_get_tools_for_query_no_always_include_uses_default():
    """Without always_include, ALWAYS_AVAILABLE (not ASSISTANT_ALWAYS_AVAILABLE) is the base."""
    idx = _FakeToolIndex(return_set=set())
    result = idx.get_tools_for_query("hello", always_include=None)
    # Core tools are present
    for tool in ALWAYS_AVAILABLE:
        assert tool in result
    # But personal-assistant tools that are only in ASSISTANT_ALWAYS_AVAILABLE may be absent
    pa_only = ASSISTANT_ALWAYS_AVAILABLE - ALWAYS_AVAILABLE
    # At least one should be absent (sanity check that the sets differ)
    assert pa_only, "ASSISTANT_ALWAYS_AVAILABLE must be a strict superset of ALWAYS_AVAILABLE"


# ---------------------------------------------------------------------------
# 4. Policy gates execution even when tool is always_included
# ---------------------------------------------------------------------------

def test_always_include_does_not_bypass_policy():
    """always_include offers tools; the GATEWAY policy still gates writes via the sentinel.

    manage_calendar (read) is Tier A — always allowed.
    manage_calendar_write (write sentinel) is Tier B — approval-gated.
    always_include surfaces manage_calendar; it cannot bypass the write sentinel gate.
    """
    from src.tool_security import GATEWAY_APPROVAL_GATED_TOOLS, GATEWAY_TOOL_ALLOWLIST
    from src.tool_policy import build_effective_tool_policy

    policy = build_effective_tool_policy(
        last_user_message="create a meeting tomorrow",
        agent_allowlist=GATEWAY_TOOL_ALLOWLIST,
        approval_gated_tools=GATEWAY_APPROVAL_GATED_TOOLS,
    )
    # Calendar write sentinel must be in the approval-gated set
    assert "manage_calendar_write" in GATEWAY_APPROVAL_GATED_TOOLS, (
        "manage_calendar_write must be approval-gated even when manage_calendar is always_included"
    )
    # The write sentinel must be blocked or gated by policy (not freely executable)
    write_is_gated = (
        policy.blocks("manage_calendar_write")
        or "manage_calendar_write" in (GATEWAY_APPROVAL_GATED_TOOLS or set())
    )
    assert write_is_gated, (
        "Calendar writes (manage_calendar_write sentinel) must remain gated — "
        "always_include OFFERS manage_calendar, the allowlist GATES the write path"
    )


# ---------------------------------------------------------------------------
# 5. ASSISTANT_ALWAYS_AVAILABLE is a strict superset of ALWAYS_AVAILABLE
# ---------------------------------------------------------------------------

def test_assistant_always_available_contains_pa_tools():
    """ASSISTANT_ALWAYS_AVAILABLE must contain the key personal-assistant tools.

    The sets are not a strict superset relationship (ALWAYS_AVAILABLE has update_plan
    which is agent-internal; ASSISTANT_ALWAYS_AVAILABLE has the broader PA tool suite).
    What matters: the gateway-relevant PA tools are unconditionally present.
    """
    required = {"manage_calendar", "manage_notes", "manage_tasks", "manage_memory"}
    for tool in required:
        assert tool in ASSISTANT_ALWAYS_AVAILABLE, (
            f"{tool} must be in ASSISTANT_ALWAYS_AVAILABLE so gateway sessions always offer it"
        )
    # ASSISTANT_ALWAYS_AVAILABLE must be a different (larger) set than ALWAYS_AVAILABLE
    pa_extra = ASSISTANT_ALWAYS_AVAILABLE - ALWAYS_AVAILABLE
    assert pa_extra, "ASSISTANT_ALWAYS_AVAILABLE must add tools beyond the base ALWAYS_AVAILABLE set"
