"""V4 Phase 1 — per-agent tool allowlist tests.

Verifies:
  1. build_effective_tool_policy() blocks tools not in the allowlist.
  2. Tools already in NON_ADMIN_BLOCKED_TOOLS cannot be unlocked via allowlist.
  3. plan_mode_disabled_tools() overrides allowlist (plan mode is the final gate).
  4. guide-only turn overrides allowlist.
  5. agent_allowlist=None ⟹ no extra blocking (open policy).
  6. All 16 default agents have a non-empty tool_allowlist.
"""

import json
import sys
import os

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_policy(allowlist, last_msg=""):
    from src.tool_policy import build_effective_tool_policy
    return build_effective_tool_policy(
        agent_allowlist=allowlist,
        last_user_message=last_msg,
    )


# ---------------------------------------------------------------------------
# 1. Allowlist inversion — tools outside the list are blocked
# ---------------------------------------------------------------------------

def test_allowlist_blocks_tool_outside_list():
    policy = _make_policy({"web_search", "read_file"})
    assert policy.blocks("bash"), "bash must be blocked — not in allowlist"
    assert policy.blocks("python"), "python must be blocked — not in allowlist"


def test_allowlist_permits_tool_inside_list():
    policy = _make_policy({"web_search", "read_file"})
    assert not policy.blocks("web_search"), "web_search is in allowlist — must not be blocked"
    assert not policy.blocks("read_file"), "read_file is in allowlist — must not be blocked"


def test_allowlist_reason_string():
    policy = _make_policy({"web_search"})
    reason = policy.reason_for("bash")
    assert "allowlist" in reason.lower(), f"Expected allowlist mention in reason, got: {reason!r}"


# ---------------------------------------------------------------------------
# 2. NON_ADMIN_BLOCKED_TOOLS cannot be unlocked via allowlist
# ---------------------------------------------------------------------------

def test_non_admin_blocked_tools_are_independent_of_allowlist():
    """stream_agent_loop applies blocked_tools_for_owner() *after* the policy;
    allowlist cannot circumvent it.  Here we test that the policy itself does
    NOT mark NON_ADMIN_BLOCKED_TOOLS as permitted — they may or may not appear
    in known_tool_names(), but the owner gate is a separate, additive layer.

    We specifically confirm that a privileged tool like 'bash' stays in the
    disabled set when it was already in the pre-existing disabled_tools param.
    """
    from src.tool_policy import build_effective_tool_policy
    # Simulate: caller passes disabled_tools={"bash"} from owner gate, AND
    # agent allowlist includes "bash" (would be an escalation attempt).
    policy = build_effective_tool_policy(
        disabled_tools={"bash"},
        agent_allowlist={"bash", "web_search"},
    )
    # The pre-existing disabled entry must survive; allowlist cannot remove it.
    assert policy.blocks("bash"), "bash must remain blocked — owner gate cannot be bypassed by allowlist"


# ---------------------------------------------------------------------------
# 3. plan_mode_disabled_tools() overrides allowlist
# ---------------------------------------------------------------------------

def test_plan_mode_disables_tools_beyond_allowlist():
    from src.tool_security import plan_mode_disabled_tools
    from src.tool_policy import build_effective_tool_policy
    plan_blocked = plan_mode_disabled_tools()
    if not plan_blocked:
        pytest.skip("plan_mode_disabled_tools returned empty set")
    # Pick a tool that plan mode disables
    sample = next(iter(plan_blocked))
    # Build policy with that tool explicitly in the allowlist
    policy = build_effective_tool_policy(
        disabled_tools=plan_blocked,
        agent_allowlist={sample, "web_search"},
    )
    # The plan-mode block (passed as disabled_tools) must win
    assert policy.blocks(sample), (
        f"{sample!r} must remain blocked — plan-mode block passed via disabled_tools"
    )


# ---------------------------------------------------------------------------
# 4. guide-only turn overrides allowlist
# ---------------------------------------------------------------------------

def test_guide_only_turn_overrides_allowlist():
    policy = _make_policy(
        {"web_search", "read_file", "bash"},
        last_msg="do not use any tools for this request",
    )
    assert policy.block_all_tool_calls, "guide-only turn must set block_all_tool_calls"
    assert policy.mode == "guide_only"
    assert policy.disable_mcp


# ---------------------------------------------------------------------------
# 5. agent_allowlist=None means no extra blocking
# ---------------------------------------------------------------------------

def test_no_allowlist_does_not_block_any_tool():
    policy = _make_policy(None)
    assert not policy.block_all_tool_calls
    assert len(policy.disabled_tools) == 0, "No allowlist — no extra disabled tools"


# ---------------------------------------------------------------------------
# 6. All 16 default agents have a non-empty tool_allowlist
# ---------------------------------------------------------------------------

def test_all_default_agents_have_tool_allowlist():
    from routes.cerberus_agent_defaults import _DEFAULT_AGENTS
    missing = []
    empty = []
    for agent in _DEFAULT_AGENTS:
        allowlist = agent.get("tool_allowlist")
        if allowlist is None:
            missing.append(agent["name"])
        elif not allowlist:
            empty.append(agent["name"])
    assert not missing, f"Agents missing tool_allowlist: {missing}"
    assert not empty, f"Agents with empty tool_allowlist: {empty}"


def test_default_agent_allowlists_are_lists_of_strings():
    from routes.cerberus_agent_defaults import _DEFAULT_AGENTS
    for agent in _DEFAULT_AGENTS:
        al = agent.get("tool_allowlist", [])
        assert isinstance(al, list), f"{agent['name']}: tool_allowlist must be list"
        for entry in al:
            assert isinstance(entry, str), f"{agent['name']}: allowlist entry must be str, got {entry!r}"


# ---------------------------------------------------------------------------
# 7. Backfill serialization — list values become JSON strings
# ---------------------------------------------------------------------------

def test_seed_defaults_serializes_list_values():
    """_seed_defaults must JSON-encode list fields before inserting into Text column."""
    from unittest.mock import MagicMock
    import routes.cerberus_agent_routes as car

    added: list = []
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.all.return_value = []
    mock_db.add.side_effect = added.append

    car._seed_defaults(mock_db, "test-owner")

    assert added, "Expected at least one agent to be inserted"
    # Every added agent that has a tool_allowlist must have it as a JSON string
    for agent in added:
        al = getattr(agent, "tool_allowlist", None)
        if al is not None:
            assert isinstance(al, str), (
                f"tool_allowlist must be a JSON string, got {type(al).__name__}: {al!r}"
            )
            parsed = json.loads(al)
            assert isinstance(parsed, list), "Deserialized tool_allowlist must be a list"
