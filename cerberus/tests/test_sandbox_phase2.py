"""
test_sandbox_phase2.py — Phase 2 OpenSandbox integration tests.

These tests run with CERBERUS_SANDBOX_ENABLED=false so the host subprocess
backend is used — they exercise the Python-level interface contract and
sandbox_backend module without requiring a live opensandbox server.

Live integration tests (escape + egress) are in the _live_ variants below and
are skipped when SANDBOX_INTEGRATION_TESTS env var is not set.
"""

import asyncio
import os
import sys
import types
import importlib
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Ensure host subprocess fallback works when opensandbox is not installed
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _disable_sandbox(monkeypatch):
    """Force host-subprocess mode for unit tests."""
    monkeypatch.setenv("CERBERUS_SANDBOX_ENABLED", "false")


@pytest.mark.asyncio
async def test_bash_tool_host_fallback_returns_output():
    """BashTool._execute_host returns output from host subprocess."""
    import importlib
    import src.agent_tools.subprocess_tools as st
    # Re-read the module-level flag after monkeypatch
    importlib.reload(st)

    tool = st.BashTool()
    result = await tool.execute("echo cerberus-phase2", ctx={})
    assert result.get("exit_code") == 0
    assert "cerberus-phase2" in result.get("output", "")


@pytest.mark.asyncio
async def test_python_tool_host_fallback_returns_output():
    """PythonTool._execute_host runs python code on host."""
    import importlib
    import src.agent_tools.subprocess_tools as st
    importlib.reload(st)

    tool = st.PythonTool()
    result = await tool.execute("print('hello-from-sandbox-test')", ctx={})
    assert result.get("exit_code") == 0
    assert "hello-from-sandbox-test" in result.get("output", "")


# ---------------------------------------------------------------------------
# sandbox_backend module: unit-test the wrappers without a live server
# ---------------------------------------------------------------------------

class _FakeSandbox:
    """Minimal stand-in for the opensandbox Sandbox object."""

    def __init__(self):
        self.commands = self
        self._killed = False

    async def run(self, cmd, handlers=None):
        if handlers and handlers.on_stdout:
            msg = MagicMock()
            msg.text = f"mocked:{cmd}"
            await handlers.on_stdout(msg)
        result = MagicMock()
        result.exit_code = 0
        return result

    async def kill(self):
        self._killed = True

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        pass


def _patch_opensandbox(fake_sandbox):
    """Return a context-manager that injects fake opensandbox modules."""
    sandbox_mod = types.ModuleType("opensandbox")
    sandbox_cls_mod = types.ModuleType("opensandbox.sandbox")
    config_mod = types.ModuleType("opensandbox.config")
    exceptions_mod = types.ModuleType("opensandbox.exceptions")
    execd_mod = types.ModuleType("opensandbox.models.execd")
    models_mod = types.ModuleType("opensandbox.models")
    sandboxes_mod = types.ModuleType("opensandbox.models.sandboxes")

    # ConnectionConfig
    class FakeConnectionConfig:
        def __init__(self, **kwargs):
            pass

    config_mod.ConnectionConfig = FakeConnectionConfig

    # Sandbox.create
    class FakeSandboxCls:
        @staticmethod
        async def create(*args, **kwargs):
            return fake_sandbox

    sandbox_cls_mod.Sandbox = FakeSandboxCls

    # Exceptions
    class FakeSandboxException(Exception):
        def __init__(self, msg=""):
            self.error = MagicMock()
            self.error.code = "ERR"
            self.error.message = msg
            self.request_id = None

    exceptions_mod.SandboxException = FakeSandboxException

    # ExecutionHandlers
    class FakeExecutionHandlers:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)

    execd_mod.ExecutionHandlers = FakeExecutionHandlers

    # NetworkPolicy / NetworkRule
    class FakeNetworkPolicy:
        def __init__(self, **kwargs):
            pass

    class FakeNetworkRule:
        def __init__(self, **kwargs):
            pass

    sandboxes_mod.NetworkPolicy = FakeNetworkPolicy
    sandboxes_mod.NetworkRule = FakeNetworkRule

    import contextlib

    @contextlib.contextmanager
    def _ctx():
        orig = {}
        mods = {
            "opensandbox": sandbox_mod,
            "opensandbox.sandbox": sandbox_cls_mod,
            "opensandbox.config": config_mod,
            "opensandbox.exceptions": exceptions_mod,
            "opensandbox.models": models_mod,
            "opensandbox.models.execd": execd_mod,
            "opensandbox.models.sandboxes": sandboxes_mod,
        }
        for name, mod in mods.items():
            orig[name] = sys.modules.get(name)
            sys.modules[name] = mod
        try:
            yield
        finally:
            for name, old in orig.items():
                if old is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = old

    return _ctx()


@pytest.mark.asyncio
async def test_run_in_sandbox_returns_stdout():
    """run_in_sandbox collects stdout via ExecutionHandlers and returns it."""
    fake = _FakeSandbox()
    with _patch_opensandbox(fake):
        # Force reload so the module picks up patched sys.modules
        import importlib
        import src.agent_tools.sandbox_backend as sb
        importlib.reload(sb)

        result = await sb.run_in_sandbox("echo hello", timeout=10)

    assert "mocked:echo hello" in result["stdout"]
    assert result["exit_code"] == 0
    assert not result["timed_out"]


@pytest.mark.asyncio
async def test_sandbox_unavailable_error_on_import_failure():
    """SandboxUnavailableError is raised when opensandbox is not importable."""
    # Temporarily hide opensandbox
    orig = sys.modules.pop("opensandbox", None)
    orig_sandbox = sys.modules.pop("opensandbox.sandbox", None)
    orig_config = sys.modules.pop("opensandbox.config", None)

    try:
        import importlib
        import src.agent_tools.sandbox_backend as sb
        importlib.reload(sb)

        with pytest.raises(sb.SandboxUnavailableError):
            async with sb.open_sandbox():
                pass
    finally:
        for name, mod in [
            ("opensandbox", orig),
            ("opensandbox.sandbox", orig_sandbox),
            ("opensandbox.config", orig_config),
        ]:
            if mod is not None:
                sys.modules[name] = mod
            else:
                sys.modules.pop(name, None)


def test_egress_allowlist_parsed_from_env(monkeypatch):
    """SANDBOX_EGRESS_ALLOWLIST env var is parsed into the allowlist list."""
    monkeypatch.setenv("SANDBOX_EGRESS_ALLOWLIST", "pypi.org,example.com")
    import importlib
    import src.agent_tools.sandbox_backend as sb
    importlib.reload(sb)
    assert "pypi.org" in sb.EGRESS_ALLOWLIST
    assert "example.com" in sb.EGRESS_ALLOWLIST


def test_empty_egress_allowlist_by_default(monkeypatch):
    """Default egress allowlist is empty (deny all)."""
    monkeypatch.delenv("SANDBOX_EGRESS_ALLOWLIST", raising=False)
    import importlib
    import src.agent_tools.sandbox_backend as sb
    importlib.reload(sb)
    assert sb.EGRESS_ALLOWLIST == []


def test_bash_tool_sandbox_flag_respects_env(monkeypatch):
    """CERBERUS_SANDBOX_ENABLED=false disables sandbox routing."""
    monkeypatch.setenv("CERBERUS_SANDBOX_ENABLED", "false")
    import importlib
    import src.agent_tools.subprocess_tools as st
    importlib.reload(st)
    assert st._SANDBOX_ENABLED is False


def test_bash_tool_sandbox_flag_true_by_default(monkeypatch):
    """CERBERUS_SANDBOX_ENABLED defaults to true."""
    monkeypatch.delenv("CERBERUS_SANDBOX_ENABLED", raising=False)
    import importlib
    import src.agent_tools.subprocess_tools as st
    importlib.reload(st)
    assert st._SANDBOX_ENABLED is True


# ---------------------------------------------------------------------------
# Escape test (conceptual — verifies command isolation contract)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_bash_tool_sandbox_unavailable_fails_closed():
    """
    BashTool._execute_sandboxed must return an error dict when the sandbox is
    unavailable — it must NOT fall back to host-side subprocess execution.
    """
    import importlib
    import src.agent_tools.subprocess_tools as st

    with patch.dict(os.environ, {"CERBERUS_SANDBOX_ENABLED": "true"}):
        importlib.reload(st)

        from src.agent_tools.sandbox_backend import SandboxUnavailableError
        with patch(
            "src.agent_tools.sandbox_backend.run_in_sandbox",
            side_effect=SandboxUnavailableError("server down"),
        ):
            result = await st.BashTool().execute("echo safe", ctx={})

    assert result.get("exit_code") == 1
    assert "Sandbox unavailable" in result.get("error", "")
    # Must NOT have succeeded through host subprocess
    assert "output" not in result or result.get("exit_code") != 0


@pytest.mark.asyncio
async def test_python_tool_sandbox_unavailable_fails_closed():
    """
    PythonTool._execute_sandboxed must return an error dict when the sandbox is
    unavailable — it must NOT fall back to host-side subprocess execution.
    """
    import importlib
    import src.agent_tools.subprocess_tools as st

    with patch.dict(os.environ, {"CERBERUS_SANDBOX_ENABLED": "true"}):
        importlib.reload(st)

        from src.agent_tools.sandbox_backend import SandboxUnavailableError
        with patch(
            "src.agent_tools.sandbox_backend.run_python_in_sandbox",
            side_effect=SandboxUnavailableError("server down"),
        ):
            result = await st.PythonTool().execute("print('x')", ctx={})

    assert result.get("exit_code") == 1
    assert "Sandbox unavailable" in result.get("error", "")


# ---------------------------------------------------------------------------
# Live integration tests (skipped unless SANDBOX_INTEGRATION_TESTS=1)
# ---------------------------------------------------------------------------

_LIVE = pytest.mark.skipif(
    os.environ.get("SANDBOX_INTEGRATION_TESTS") != "1",
    reason="Set SANDBOX_INTEGRATION_TESTS=1 to run live sandbox tests",
)


@_LIVE
@pytest.mark.asyncio
async def test_live_escape_host_env_not_readable():
    """
    Live escape test: a sandbox command cannot read the host .env file.
    The host .env is NOT bind-mounted into the sandbox container, so the
    path simply does not exist — cat returns a non-zero exit code.
    """
    from src.agent_tools.sandbox_backend import run_in_sandbox
    result = await run_in_sandbox("cat /etc/host-cerberus.env 2>&1; echo EXIT:$?")
    output = result["stdout"] + result["stderr"]
    # Either the file is absent (No such file) or permission denied — both OK
    assert result["exit_code"] != 0 or "No such file" in output or "Permission denied" in output, (
        "ESCAPE: sandbox was able to read host .env — isolation breach"
    )


@_LIVE
@pytest.mark.asyncio
async def test_live_escape_etc_passwd_unmodified():
    """
    Live escape test: /etc/passwd inside the sandbox is the container's
    own passwd, not the host file (it will lack the cerberus unix user).
    """
    from src.agent_tools.sandbox_backend import run_in_sandbox
    result = await run_in_sandbox("grep '^cerberus:' /etc/passwd; echo EXIT:$?")
    # cerberus unix user should NOT be present inside the sandbox
    assert "cerberus:" not in result["stdout"], (
        "ESCAPE: sandbox /etc/passwd contains host cerberus user — isolation breach"
    )


@_LIVE
@pytest.mark.asyncio
async def test_live_egress_non_allowlisted_host_blocked():
    """
    Live egress test: a curl to a non-allowlisted host is blocked.
    Default SANDBOX_EGRESS_ALLOWLIST is empty, so no outbound traffic is
    permitted. curl should fail with a network error.
    """
    import os
    # Only run when allowlist is empty (deny-all)
    if os.environ.get("SANDBOX_EGRESS_ALLOWLIST", "").strip():
        pytest.skip("SANDBOX_EGRESS_ALLOWLIST is non-empty — egress test not applicable")

    from src.agent_tools.sandbox_backend import run_in_sandbox
    result = await run_in_sandbox(
        "curl -s --max-time 5 http://example.com -o /dev/null; echo EXIT:$?",
    )
    # curl exit codes: 6 = DNS failure, 7 = connection refused, 28 = timeout
    # Any non-zero code from curl indicates blocked egress
    combined = result["stdout"] + result["stderr"]
    curl_blocked = (
        result["exit_code"] != 0
        or "EXIT:6" in combined
        or "EXIT:7" in combined
        or "EXIT:28" in combined
        or "EXIT:35" in combined
    )
    assert curl_blocked, (
        "EGRESS: sandbox was able to reach example.com — egress policy not enforced"
    )
