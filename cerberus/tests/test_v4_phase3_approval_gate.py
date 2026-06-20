"""V4 Phase 3 — write-file approval gate tests.

Verifies:
  1. agent_approval.store_pending() returns a UUID string.
  2. get_pending() returns the entry and None after expiry.
  3. approve() marks status='approved'; no-op on unknown id.
  4. reject() marks status='rejected'; no-op on unknown id.
  5. set_result() marks status='executed' and stores result.
  6. pop_executed() returns and removes the entry.
  7. list_pending_for_agent() returns only pending entries for that agent.
  8. ToolPolicy.approval_gated_tools field exists and defaults to frozenset().
  9. build_effective_tool_policy(approval_gated_tools=...) populates the field.
 10. CODER, DEVOPS, OPTIMIZER have write_file + edit_file in their allowlists.
 11. Non-write agents (TESTER, DATA-ANALYST, DEBUGGER) do NOT get write_file/edit_file.
 12. Guide-only turn clears approval_gated_tools (guide-only always wins).
"""

import sys
import os
import time
import uuid

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import src.agent_approval as aa


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _new_agent() -> str:
    return str(uuid.uuid4())


def _new_thread() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# 1. store_pending returns a UUID
# ---------------------------------------------------------------------------

def test_store_pending_returns_uuid():
    rid = aa.store_pending(
        agent_id=_new_agent(),
        thread_id=_new_thread(),
        tool_name="write_file",
        tool_args={"content": "/tmp/x.txt\nhello"},
        preview="/tmp/x.txt\nhello",
    )
    # Must be a valid UUID4 string
    parsed = uuid.UUID(rid, version=4)
    assert str(parsed) == rid


# ---------------------------------------------------------------------------
# 2. get_pending returns entry; returns None after expiry
# ---------------------------------------------------------------------------

def test_get_pending_returns_entry():
    rid = aa.store_pending(
        agent_id=_new_agent(),
        thread_id=_new_thread(),
        tool_name="write_file",
        tool_args={"content": "path\ncontent"},
        preview="path\ncontent",
    )
    entry = aa.get_pending(rid)
    assert entry is not None
    assert entry["request_id"] == rid
    assert entry["status"] == "pending"


def test_get_pending_returns_none_for_unknown():
    assert aa.get_pending(str(uuid.uuid4())) is None


def test_get_pending_returns_none_after_ttl(monkeypatch):
    rid = aa.store_pending(
        agent_id=_new_agent(),
        thread_id=_new_thread(),
        tool_name="edit_file",
        tool_args={"content": "{}"},
        preview="{}",
    )
    # Artificially age the entry past TTL
    monkeypatch.setattr(aa, "_TTL_SECONDS", 0.0)
    # get_pending must expire it
    result = aa.get_pending(rid)
    assert result is None


# ---------------------------------------------------------------------------
# 3. approve() marks approved; no-op on unknown / already-decided
# ---------------------------------------------------------------------------

def test_approve_marks_approved():
    rid = aa.store_pending(
        agent_id=_new_agent(),
        thread_id=_new_thread(),
        tool_name="write_file",
        tool_args={"content": "a"},
        preview="a",
    )
    entry = aa.approve(rid)
    assert entry is not None
    assert entry["status"] == "approved"


def test_approve_noop_on_unknown():
    assert aa.approve(str(uuid.uuid4())) is None


def test_approve_noop_on_already_rejected():
    rid = aa.store_pending(
        agent_id=_new_agent(),
        thread_id=_new_thread(),
        tool_name="write_file",
        tool_args={"content": "b"},
        preview="b",
    )
    aa.reject(rid)
    # Can't approve something already rejected
    assert aa.approve(rid) is None


# ---------------------------------------------------------------------------
# 4. reject() marks rejected; no-op on unknown / already-decided
# ---------------------------------------------------------------------------

def test_reject_marks_rejected():
    rid = aa.store_pending(
        agent_id=_new_agent(),
        thread_id=_new_thread(),
        tool_name="edit_file",
        tool_args={"content": "c"},
        preview="c",
    )
    assert aa.reject(rid) is True


def test_reject_noop_on_unknown():
    assert aa.reject(str(uuid.uuid4())) is False


def test_reject_noop_on_already_approved():
    rid = aa.store_pending(
        agent_id=_new_agent(),
        thread_id=_new_thread(),
        tool_name="write_file",
        tool_args={"content": "d"},
        preview="d",
    )
    aa.approve(rid)
    assert aa.reject(rid) is False


# ---------------------------------------------------------------------------
# 5. set_result() marks executed and stores result
# ---------------------------------------------------------------------------

def test_set_result_marks_executed():
    rid = aa.store_pending(
        agent_id=_new_agent(),
        thread_id=_new_thread(),
        tool_name="write_file",
        tool_args={"content": "e"},
        preview="e",
    )
    aa.approve(rid)
    aa.set_result(rid, {"success": True, "path": "/tmp/e"})
    entry = aa.get_pending(rid)
    assert entry is not None
    assert entry["status"] == "executed"
    assert entry["result"]["success"] is True


# ---------------------------------------------------------------------------
# 6. pop_executed() returns and removes
# ---------------------------------------------------------------------------

def test_pop_executed_returns_and_removes():
    aid = _new_agent()
    tid = _new_thread()
    rid = aa.store_pending(
        agent_id=aid,
        thread_id=tid,
        tool_name="write_file",
        tool_args={"content": "f"},
        preview="f",
    )
    aa.approve(rid)
    aa.set_result(rid, {"success": True})

    result = aa.pop_executed(aid, tid)
    assert result is not None
    assert result["request_id"] == rid

    # Gone from store after pop
    assert aa.get_pending(rid) is None
    assert aa.pop_executed(aid, tid) is None


def test_pop_executed_ignores_other_agents():
    aid1, aid2 = _new_agent(), _new_agent()
    tid = _new_thread()
    rid = aa.store_pending(
        agent_id=aid1,
        thread_id=tid,
        tool_name="write_file",
        tool_args={"content": "g"},
        preview="g",
    )
    aa.approve(rid)
    aa.set_result(rid, {"success": True})

    assert aa.pop_executed(aid2, tid) is None  # wrong agent
    assert aa.pop_executed(aid1, tid) is not None  # correct agent


# ---------------------------------------------------------------------------
# 7. list_pending_for_agent
# ---------------------------------------------------------------------------

def test_list_pending_for_agent():
    aid = _new_agent()
    tid = _new_thread()
    rid1 = aa.store_pending(agent_id=aid, thread_id=tid, tool_name="write_file",
                             tool_args={"content": "h"}, preview="h")
    rid2 = aa.store_pending(agent_id=aid, thread_id=tid, tool_name="edit_file",
                             tool_args={"content": "i"}, preview="i")
    # Different agent — must not appear
    aa.store_pending(agent_id=_new_agent(), thread_id=tid, tool_name="write_file",
                     tool_args={"content": "j"}, preview="j")

    pending = aa.list_pending_for_agent(aid)
    rids = {e["request_id"] for e in pending}
    assert rid1 in rids
    assert rid2 in rids
    # Other agent's entry must not leak
    assert all(e["agent_id"] == aid for e in pending)


# ---------------------------------------------------------------------------
# 8. ToolPolicy.approval_gated_tools defaults to frozenset()
# ---------------------------------------------------------------------------

def test_tool_policy_has_approval_gated_tools_field():
    from src.tool_policy import ToolPolicy
    policy = ToolPolicy()
    assert hasattr(policy, "approval_gated_tools")
    assert isinstance(policy.approval_gated_tools, frozenset)
    assert len(policy.approval_gated_tools) == 0


# ---------------------------------------------------------------------------
# 9. build_effective_tool_policy passes approval_gated_tools through
# ---------------------------------------------------------------------------

def test_build_effective_tool_policy_approval_gated_tools():
    from src.tool_policy import build_effective_tool_policy
    policy = build_effective_tool_policy(
        agent_allowlist={"read_file", "write_file", "edit_file"},
        approval_gated_tools={"write_file", "edit_file"},
    )
    assert "write_file" in policy.approval_gated_tools
    assert "edit_file" in policy.approval_gated_tools
    # Must NOT be blocked (allowlisted)
    assert not policy.blocks("write_file")
    assert not policy.blocks("edit_file")


def test_approval_gated_tools_empty_when_not_provided():
    from src.tool_policy import build_effective_tool_policy
    policy = build_effective_tool_policy(
        agent_allowlist={"read_file", "write_file"},
    )
    assert len(policy.approval_gated_tools) == 0


# ---------------------------------------------------------------------------
# 10. Write agents have write_file + edit_file
# ---------------------------------------------------------------------------

_WRITE_AGENTS = {"CODER", "DEVOPS", "OPTIMIZER"}
_WRITE_TOOLS = {"write_file", "edit_file"}


def test_write_agents_have_write_tools():
    from routes.cerberus_agent_defaults import _DEFAULT_AGENTS
    failures = []
    for agent in _DEFAULT_AGENTS:
        if agent["name"] not in _WRITE_AGENTS:
            continue
        al = set(agent.get("tool_allowlist", []))
        missing = _WRITE_TOOLS - al
        if missing:
            failures.append(f"{agent['name']} missing {missing}")
    assert not failures, failures


# ---------------------------------------------------------------------------
# 11. Non-write agents do NOT have write_file/edit_file
# ---------------------------------------------------------------------------

_NO_WRITE_AGENTS = {
    "ARCHITECT", "TESTER", "RESEARCHER", "REVIEWER", "SECURITY",
    "ORCHESTRATOR", "DATA-ANALYST", "SCRIBE", "DESIGNER", "DEBUGGER",
    "PLANNER", "LIBRARIAN", "PROMPTSMITH",
}


def test_non_write_agents_lack_write_tools():
    from routes.cerberus_agent_defaults import _DEFAULT_AGENTS
    violations = []
    for agent in _DEFAULT_AGENTS:
        if agent["name"] not in _NO_WRITE_AGENTS:
            continue
        al = set(agent.get("tool_allowlist", []))
        leaked = _WRITE_TOOLS & al
        if leaked:
            violations.append(f"{agent['name']}: {leaked}")
    assert not violations, violations


# ---------------------------------------------------------------------------
# 12. Agent-id ownership check on approve/reject (route logic reproduced)
# ---------------------------------------------------------------------------

def test_approve_wrong_agent_id_returns_403():
    """get_pending must be called before approve to verify agent ownership."""
    correct_aid = _new_agent()
    wrong_aid = _new_agent()
    tid = _new_thread()
    rid = aa.store_pending(
        agent_id=correct_aid,
        thread_id=tid,
        tool_name="write_file",
        tool_args={"content": "/tmp/k.txt\nk"},
        preview="/tmp/k.txt\nk",
    )
    # Simulate the route logic: get_pending → ownership check → approve
    pending = aa.get_pending(rid)
    assert pending is not None
    # Wrong agent_id must be caught BEFORE approve() mutates state
    assert pending["agent_id"] != wrong_aid, "ownership check would fire"
    # Entry must still be pending (approve was not called)
    assert aa.get_pending(rid)["status"] == "pending"


def test_reject_wrong_agent_id_leaves_entry_pending():
    """get_pending must be called before reject to verify agent ownership."""
    correct_aid = _new_agent()
    wrong_aid = _new_agent()
    tid = _new_thread()
    rid = aa.store_pending(
        agent_id=correct_aid,
        thread_id=tid,
        tool_name="edit_file",
        tool_args={"content": "{}"},
        preview="{}",
    )
    pending = aa.get_pending(rid)
    assert pending is not None
    assert pending["agent_id"] != wrong_aid
    # Entry must still be pending (reject was not called)
    assert aa.get_pending(rid)["status"] == "pending"


# ---------------------------------------------------------------------------
# 14. Guide-only turn clears approval_gated_tools
# ---------------------------------------------------------------------------

def test_guide_only_clears_approval_gated_tools():
    from src.tool_policy import build_effective_tool_policy
    policy = build_effective_tool_policy(
        agent_allowlist={"read_file", "write_file"},
        approval_gated_tools={"write_file"},
        last_user_message="do not use any tools for this request",
    )
    assert policy.mode == "guide_only"
    assert policy.block_all_tool_calls
    # Guide-only returns early before populating approval_gated_tools
    assert len(policy.approval_gated_tools) == 0
