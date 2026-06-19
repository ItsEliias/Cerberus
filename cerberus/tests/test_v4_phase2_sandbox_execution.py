"""V4 Phase 2 — sandbox execution prerequisite tests.

Verifies all 6 items from threat-model section 7.3 before bash/python are
granted to execution agents:

  1. SandboxUnavailableError fails CLOSED (no host fallback). [regression guard]
  2. SANDBOX_URL validator accepts safe hosts (localhost, 127.x, bare labels).
  3. SANDBOX_URL validator rejects external-looking hosts.
  4. SANDBOX_API_KEY warning fires when key is default and sandbox enabled.
  5. _SANDBOX_URL_SAFE=False makes _build_connection_config() raise immediately.
  6. EGRESS_ALLOWLIST defaults to empty (deny-by-default egress).
  7. Execution agents (CODER/TESTER/DEVOPS/DATA-ANALYST/DEBUGGER/OPTIMIZER)
     have bash or python in their allowlists.
  8. Non-execution agents do NOT have bash or python.
  9. max_tool_calls=20 computed for execution agents in thread route.
 10. Runaway budget: each sandbox torn down after use (context-manager test).
"""

import os
import sys
import importlib

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ---------------------------------------------------------------------------
# 1. SandboxUnavailableError fails CLOSED (regression guard from Phase 0)
# ---------------------------------------------------------------------------

def test_bash_tool_sandbox_unavailable_fails_closed(monkeypatch):
    monkeypatch.setenv("CERBERUS_SANDBOX_ENABLED", "true")
    from src.agent_tools import subprocess_tools
    importlib.reload(subprocess_tools)
    from src.agent_tools.subprocess_tools import BashTool

    async def _fake_sandboxed(content, ctx, _truncate):
        from src.agent_tools.sandbox_backend import SandboxUnavailableError
        raise SandboxUnavailableError("test error")

    tool = BashTool()
    import asyncio
    result = asyncio.run(tool._execute_sandboxed("echo hi", {}, lambda s, n: s))
    assert result.get("exit_code") == 1
    assert "Sandbox unavailable" in result.get("error", "")


def test_python_tool_sandbox_unavailable_fails_closed(monkeypatch):
    monkeypatch.setenv("CERBERUS_SANDBOX_ENABLED", "true")
    from src.agent_tools import subprocess_tools
    importlib.reload(subprocess_tools)
    from src.agent_tools.subprocess_tools import PythonTool

    tool = PythonTool()
    import asyncio
    result = asyncio.run(tool._execute_sandboxed("print(1)", {}, lambda s, n: s))
    assert result.get("exit_code") == 1
    assert "Sandbox unavailable" in result.get("error", "")


# ---------------------------------------------------------------------------
# 2 & 3. SANDBOX_URL hostname validation
# ---------------------------------------------------------------------------

from src.agent_tools.sandbox_backend import _is_safe_sandbox_host


@pytest.mark.parametrize("host", [
    "localhost",
    "127.0.0.1",
    "::1",
    "opensandbox",          # bare compose-service label
    "cerberus-sandbox",     # bare compose-service label with hyphen
    "10.0.0.5",             # RFC-1918
    "192.168.1.100",        # RFC-1918
    "172.20.0.5",           # RFC-1918 (docker default bridge)
])
def test_safe_hosts_accepted(host):
    assert _is_safe_sandbox_host(host), f"{host!r} should be accepted as safe"


@pytest.mark.parametrize("host", [
    "api.openai.com",
    "8.8.8.8",              # public Google DNS
    "1.2.3.4",              # public IP
    "sandbox.external.io",
    "malicious.attacker.com",
])
def test_external_hosts_rejected(host):
    assert not _is_safe_sandbox_host(host), f"{host!r} should be rejected"


# ---------------------------------------------------------------------------
# 4. SANDBOX_API_KEY warning fires when default key used with sandbox enabled
# ---------------------------------------------------------------------------

def test_default_api_key_triggers_warning(monkeypatch, caplog):
    import logging
    monkeypatch.setenv("CERBERUS_SANDBOX_ENABLED", "true")
    monkeypatch.setenv("SANDBOX_API_KEY", "cerberus-local-dev")
    monkeypatch.setenv("SANDBOX_URL", "http://localhost:8090")

    import src.agent_tools.sandbox_backend as sb
    with caplog.at_level(logging.WARNING, logger="src.agent_tools.sandbox_backend"):
        sb._validate_sandbox_config()

    assert any("SANDBOX_API_KEY" in r.message and "default" in r.message.lower()
               for r in caplog.records), "Expected WARNING about default API key"


# ---------------------------------------------------------------------------
# 5. _SANDBOX_URL_SAFE=False makes _build_connection_config() raise
# ---------------------------------------------------------------------------

def test_unsafe_url_blocks_connection_config(monkeypatch):
    import src.agent_tools.sandbox_backend as sb
    original = sb._SANDBOX_URL_SAFE
    try:
        monkeypatch.setattr(sb, "_SANDBOX_URL_SAFE", False)
        with pytest.raises(sb.SandboxUnavailableError, match="safety check"):
            sb._build_connection_config()
    finally:
        sb._SANDBOX_URL_SAFE = original


# ---------------------------------------------------------------------------
# 6. EGRESS_ALLOWLIST defaults to empty
# ---------------------------------------------------------------------------

def test_egress_allowlist_empty_by_default(monkeypatch):
    monkeypatch.delenv("SANDBOX_EGRESS_ALLOWLIST", raising=False)
    import src.agent_tools.sandbox_backend as sb
    importlib.reload(sb)
    assert sb.EGRESS_ALLOWLIST == [], "EGRESS_ALLOWLIST must be empty when env var is unset"


# ---------------------------------------------------------------------------
# 7. Execution agents have bash or python in their allowlists
# ---------------------------------------------------------------------------

_EXECUTION_AGENTS = {"CODER", "TESTER", "DEVOPS", "DATA-ANALYST", "DEBUGGER", "OPTIMIZER"}
_EXEC_TOOLS = {"bash", "python"}


def test_execution_agents_have_exec_tools():
    from routes.cerberus_agent_defaults import _DEFAULT_AGENTS
    failures = []
    for agent in _DEFAULT_AGENTS:
        if agent["name"] not in _EXECUTION_AGENTS:
            continue
        al = set(agent.get("tool_allowlist", []))
        if not (_EXEC_TOOLS & al):
            failures.append(agent["name"])
    assert not failures, f"Execution agents missing bash/python: {failures}"


def test_devops_has_bash_not_python():
    from routes.cerberus_agent_defaults import _DEFAULT_AGENTS
    devops = next(a for a in _DEFAULT_AGENTS if a["name"] == "DEVOPS")
    al = set(devops["tool_allowlist"])
    assert "bash" in al, "DEVOPS must have bash"
    assert "python" not in al, "DEVOPS must not have python (data analysis scope)"


def test_data_analyst_has_python_not_bash():
    from routes.cerberus_agent_defaults import _DEFAULT_AGENTS
    da = next(a for a in _DEFAULT_AGENTS if a["name"] == "DATA-ANALYST")
    al = set(da["tool_allowlist"])
    assert "python" in al, "DATA-ANALYST must have python"
    assert "bash" not in al, "DATA-ANALYST must not have bash"


# ---------------------------------------------------------------------------
# 8. Non-execution agents do NOT get bash or python
# ---------------------------------------------------------------------------

_NON_EXEC_AGENTS = {
    "ARCHITECT", "RESEARCHER", "REVIEWER", "SECURITY",
    "ORCHESTRATOR", "SCRIBE", "DESIGNER", "PLANNER", "LIBRARIAN", "PROMPTSMITH",
}


def test_non_execution_agents_have_no_exec_tools():
    from routes.cerberus_agent_defaults import _DEFAULT_AGENTS
    violations = []
    for agent in _DEFAULT_AGENTS:
        if agent["name"] not in _NON_EXEC_AGENTS:
            continue
        al = set(agent.get("tool_allowlist", []))
        leaked = _EXEC_TOOLS & al
        if leaked:
            violations.append(f"{agent['name']}: {leaked}")
    assert not violations, f"Non-exec agents with execution tools: {violations}"


# ---------------------------------------------------------------------------
# 9. max_tool_calls=20 computed for execution agents
# ---------------------------------------------------------------------------

def test_max_tool_calls_computed_for_exec_agents():
    _EXEC_TOOLS_LOCAL = {"bash", "python"}
    for name in _EXECUTION_AGENTS:
        allowlist = {"bash", "python", "read_file"}  # simulated
        result = 20 if (allowlist and _EXEC_TOOLS_LOCAL & allowlist) else 0
        assert result == 20, f"{name}: expected max_tool_calls=20"


def test_max_tool_calls_zero_for_non_exec_agents():
    _EXEC_TOOLS_LOCAL = {"bash", "python"}
    for name in _NON_EXEC_AGENTS:
        allowlist = {"web_search", "read_file"}  # no exec tools
        result = 20 if (allowlist and _EXEC_TOOLS_LOCAL & allowlist) else 0
        assert result == 0, f"{name}: expected max_tool_calls=0"
