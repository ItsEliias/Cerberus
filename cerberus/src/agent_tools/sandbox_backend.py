"""
sandbox_backend.py — OpenSandbox connection and lifecycle helpers.

Wraps the opensandbox Python SDK so BashTool and PythonTool can delegate
execution to an isolated container sandbox instead of the host shell.

Design constraints:
- One sandbox per agent task; torn down on completion (no persistent pools).
- Egress: deny-by-default NetworkPolicy; only the explicit EGRESS_ALLOWLIST is
  permitted.  The list is intentionally conservative — operators extend it via
  the SANDBOX_EGRESS_ALLOWLIST env var.
- The server URL is internal-only (localhost / compose network).
- When the sandbox server is unavailable, SandboxUnavailableError is raised so
  the caller can decide whether to fail hard or fall back.

Environment variables read at import time:
  SANDBOX_URL      — base URL of the opensandbox server
                     Default: http://localhost:8090
  SANDBOX_IMAGE    — Docker image used for sandboxes
                     Default: python:3.11-slim
  SANDBOX_TIMEOUT  — sandbox lifetime in seconds
                     Default: 300 (5 min)
  SANDBOX_API_KEY  — API key forwarded to the server (optional for local dev)
  SANDBOX_EGRESS_ALLOWLIST — comma-separated hostnames the sandbox may reach
                             Default: (empty — no outbound network)
"""

from __future__ import annotations

import ipaddress
import logging
import os
import re
from contextlib import asynccontextmanager
from datetime import timedelta
from typing import AsyncIterator, List, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration (read once at import time, never from user input)
# ---------------------------------------------------------------------------

SANDBOX_URL: str = os.environ.get("SANDBOX_URL", "http://localhost:8090")
SANDBOX_IMAGE: str = os.environ.get("SANDBOX_IMAGE", "python:3.11-slim")
SANDBOX_TIMEOUT_S: int = int(os.environ.get("SANDBOX_TIMEOUT", "300"))
SANDBOX_API_KEY: str = os.environ.get("SANDBOX_API_KEY", "cerberus-local-dev")

# Hostnames the sandbox may reach via outbound network (deny-by-default).
# An empty allowlist means no egress at all.
_EGRESS_ENV: str = os.environ.get("SANDBOX_EGRESS_ALLOWLIST", "")
EGRESS_ALLOWLIST: List[str] = (
    [h.strip() for h in _EGRESS_ENV.split(",") if h.strip()]
    if _EGRESS_ENV else []
)

_DEFAULT_API_KEY = "cerberus-local-dev"

# Validated once at module load so misconfiguration is caught before the first
# execution attempt, not silently deferred to runtime.
_SANDBOX_URL_SAFE: bool = True  # set False by _validate_sandbox_config()


def _is_safe_sandbox_host(hostname: str) -> bool:
    """Return True if hostname is a loopback address or a bare compose-network name.

    Allowed:
      - "localhost"
      - 127.x.x.x or ::1 (loopback IP)
      - a simple identifier with no dots (docker-compose service name, e.g. "opensandbox")
      - RFC-1918 addresses (10.x, 172.16-31.x, 192.168.x) — LAN / overlay network

    Rejected: any hostname that looks like a public-internet FQDN or routable IP.
    """
    hostname = hostname.lower().split(":")[0]  # strip port if present
    if hostname in ("localhost", "::1", ""):
        return True
    # bare label (no dots) — docker compose service name
    if "." not in hostname:
        return True
    try:
        addr = ipaddress.ip_address(hostname)
        return addr.is_loopback or addr.is_private
    except ValueError:
        pass
    # Multi-label hostname — treat as external FQDN
    return False


def _validate_sandbox_config() -> None:
    """Validate SANDBOX_URL and warn on insecure SANDBOX_API_KEY.

    Logs an ERROR and sets _SANDBOX_URL_SAFE=False if SANDBOX_URL resolves to
    a potential external address, so run_in_sandbox() can fail fast.
    Logs a WARNING if SANDBOX_API_KEY is still the default development value
    while the sandbox is enabled for production use.
    """
    global _SANDBOX_URL_SAFE
    try:
        parsed = urlparse(SANDBOX_URL)
        host = parsed.hostname or ""
        if not _is_safe_sandbox_host(host):
            logger.error(
                "SECURITY: SANDBOX_URL %r hostname %r does not appear to be a "
                "loopback or compose-network address. "
                "Sandbox execution will be blocked until SANDBOX_URL is corrected.",
                SANDBOX_URL, host,
            )
            _SANDBOX_URL_SAFE = False
    except Exception as exc:
        logger.error("SANDBOX_URL validation failed: %s", exc)
        _SANDBOX_URL_SAFE = False

    _sandbox_enabled = os.environ.get("CERBERUS_SANDBOX_ENABLED", "true").lower() != "false"
    if _sandbox_enabled and SANDBOX_API_KEY == _DEFAULT_API_KEY:
        logger.warning(
            "SANDBOX_API_KEY is still the default development value %r. "
            "Set SANDBOX_API_KEY to a strong secret before exposing the sandbox "
            "to any non-local network.",
            _DEFAULT_API_KEY,
        )


class SandboxUnavailableError(RuntimeError):
    """Raised when the OpenSandbox server cannot be reached."""


# Run startup validation now that all helpers and constants are defined.
_validate_sandbox_config()


def _build_connection_config():
    """Return a ConnectionConfig for the local opensandbox server."""
    if not _SANDBOX_URL_SAFE:
        raise SandboxUnavailableError(
            f"SANDBOX_URL {SANDBOX_URL!r} failed startup safety check — "
            "must be a loopback or compose-network address. "
            "Correct SANDBOX_URL and restart to enable sandbox execution."
        )
    try:
        from opensandbox.config import ConnectionConfig
    except ImportError as exc:
        raise SandboxUnavailableError(
            "opensandbox package is not installed — run: pip install opensandbox"
        ) from exc

    # Strip trailing slash; the SDK expects bare domain[:port]
    domain = SANDBOX_URL.removeprefix("http://").removeprefix("https://").rstrip("/")
    protocol = "https" if SANDBOX_URL.startswith("https://") else "http"
    return ConnectionConfig(
        api_key=SANDBOX_API_KEY,
        domain=domain,
        protocol=protocol,
        request_timeout=timedelta(seconds=SANDBOX_TIMEOUT_S),
    )


def _build_network_policy():
    """
    Return a deny-by-default NetworkPolicy that allows only EGRESS_ALLOWLIST hosts.
    An empty allowlist produces a completely isolated policy.
    """
    try:
        from opensandbox.models.sandboxes import NetworkPolicy, NetworkRule
    except ImportError:
        return None

    rules = [
        NetworkRule(action="allow", target=host)
        for host in EGRESS_ALLOWLIST
    ]
    return NetworkPolicy(defaultAction="deny", egress=rules)


@asynccontextmanager
async def open_sandbox(
    *,
    image: Optional[str] = None,
    env: Optional[dict] = None,
) -> AsyncIterator:
    """
    Async context manager that creates a sandbox, yields it, and tears it down.

    Usage::

        async with open_sandbox() as sbx:
            result = await sbx.commands.run("echo hello")

    Raises SandboxUnavailableError if the server is unreachable or the SDK is
    not installed.
    """
    try:
        from opensandbox.sandbox import Sandbox
        from opensandbox.exceptions import SandboxException
    except ImportError as exc:
        raise SandboxUnavailableError(
            "opensandbox package is not installed"
        ) from exc

    config = _build_connection_config()
    policy = _build_network_policy()
    _image = image or SANDBOX_IMAGE
    _timeout = timedelta(seconds=SANDBOX_TIMEOUT_S)

    logger.debug(
        "sandbox: creating sandbox image=%s timeout=%ss egress=%s",
        _image, SANDBOX_TIMEOUT_S, EGRESS_ALLOWLIST or "[]",
    )

    try:
        sandbox = await Sandbox.create(
            _image,
            connection_config=config,
            timeout=_timeout,
            env=env or {},
            network_policy=policy,
        )
    except SandboxException as exc:
        raise SandboxUnavailableError(
            f"sandbox: server returned error — {exc}"
        ) from exc
    except Exception as exc:
        raise SandboxUnavailableError(
            f"sandbox: could not connect to {SANDBOX_URL} — {exc}"
        ) from exc

    try:
        async with sandbox:
            yield sandbox
    finally:
        # kill() terminates the remote container immediately; close() closes the
        # local HTTP session.  Both are best-effort on teardown.
        try:
            await sandbox.kill()
        except Exception:
            pass


async def run_in_sandbox(
    command: str,
    *,
    image: Optional[str] = None,
    env: Optional[dict] = None,
    timeout: float = float(SANDBOX_TIMEOUT_S),
) -> dict:
    """
    Run a shell command inside a fresh sandbox and return the result dict.

    Returns a dict with keys: stdout, stderr, exit_code, timed_out.
    Raises SandboxUnavailableError on connection failure.
    """
    import asyncio

    stdout_lines: list[str] = []
    stderr_lines: list[str] = []

    try:
        from opensandbox.models.execd import ExecutionHandlers
    except ImportError as exc:
        raise SandboxUnavailableError("opensandbox not installed") from exc

    async def _on_stdout(msg):
        stdout_lines.append(getattr(msg, "text", str(msg)))

    async def _on_stderr(msg):
        stderr_lines.append(getattr(msg, "text", str(msg)))

    handlers = ExecutionHandlers(
        on_stdout=_on_stdout,
        on_stderr=_on_stderr,
    )

    timed_out = False
    exit_code = 0

    async with open_sandbox(image=image, env=env) as sbx:
        try:
            result = await asyncio.wait_for(
                sbx.commands.run(command, handlers=handlers),
                timeout=timeout,
            )
            # SDK may expose exit_code on the result object
            exit_code = getattr(result, "exit_code", 0) or 0
        except asyncio.TimeoutError:
            timed_out = True
            exit_code = 124

    return {
        "stdout": "\n".join(stdout_lines),
        "stderr": "\n".join(stderr_lines),
        "exit_code": exit_code,
        "timed_out": timed_out,
    }


async def run_python_in_sandbox(
    code: str,
    *,
    env: Optional[dict] = None,
    timeout: float = float(SANDBOX_TIMEOUT_S),
) -> dict:
    """
    Execute Python code inside an isolated sandbox using the CodeInterpreter
    high-level API when available, falling back to `python3 -c '<code>'` inside
    a fresh sandbox.

    Returns a dict with keys: stdout, stderr, exit_code, timed_out.
    """
    import asyncio
    import shlex

    # Try CodeInterpreter first (higher-level, more robust for notebooks/REPL)
    try:
        from opensandbox.code_interpreter import CodeInterpreter  # type: ignore
        return await _run_via_code_interpreter(code, env=env, timeout=timeout)
    except (ImportError, AttributeError):
        pass

    # Fall back: write the code to a temp file and exec with python3
    safe_code = code.replace("\\", "\\\\").replace("'", "\\'")
    command = f"python3 -c '{safe_code}'"
    return await run_in_sandbox(command, image=SANDBOX_IMAGE, env=env, timeout=timeout)


async def _run_via_code_interpreter(
    code: str,
    *,
    env: Optional[dict] = None,
    timeout: float = float(SANDBOX_TIMEOUT_S),
) -> dict:
    """Execute Python code via the CodeInterpreter SDK class."""
    import asyncio

    try:
        from opensandbox.code_interpreter import CodeInterpreter  # type: ignore
        from opensandbox.config import ConnectionConfig
    except ImportError as exc:
        raise SandboxUnavailableError("CodeInterpreter not available") from exc

    config = _build_connection_config()
    stdout_lines: list[str] = []
    stderr_lines: list[str] = []
    timed_out = False
    exit_code = 0

    try:
        async with CodeInterpreter.create(connection_config=config) as ci:
            try:
                result = await asyncio.wait_for(
                    ci.notebook.exec_cell(code),
                    timeout=timeout,
                )
                # Collect stdout/stderr from cell outputs
                for out in getattr(result, "results", []):
                    text = getattr(out, "text", None) or getattr(out, "stdout", None)
                    if text:
                        stdout_lines.append(str(text))
                for err in getattr(result, "logs", []):
                    text = getattr(err, "stderr", None) or getattr(err, "text", None)
                    if text:
                        stderr_lines.append(str(text))
                exit_code = getattr(result, "exit_code", 0) or 0
            except asyncio.TimeoutError:
                timed_out = True
                exit_code = 124
    except Exception as exc:
        raise SandboxUnavailableError(
            f"CodeInterpreter error: {exc}"
        ) from exc

    return {
        "stdout": "\n".join(stdout_lines),
        "stderr": "\n".join(stderr_lines),
        "exit_code": exit_code,
        "timed_out": timed_out,
    }
