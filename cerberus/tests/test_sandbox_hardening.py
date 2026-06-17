"""Verifies OpenSandbox API-key hardening in all compose files.

Guards:
- SANDBOX_API_KEY is wired on the cerberus service (cerberus → sandbox auth)
- OPENSANDBOX_SERVER_API_KEY is wired on opensandbox-server (server enforces auth)
- OPENSANDBOX_INSECURE_SERVER=YES is absent from all compose files (bypass removed)
- The two env var values reference the same source variable (shared secret)
"""

from pathlib import Path
import yaml
import pytest

ROOT = Path(__file__).resolve().parents[1]

COMPOSE_FILES = [
    ROOT / "docker-compose.yml",
    ROOT / "docker-compose.gpu-nvidia.yml",
    ROOT / "docker-compose.gpu-amd.yml",
]


def _env_list(data: dict, service: str) -> list[str]:
    return data["services"][service].get("environment", [])


def _has_key_prefix(env: list[str], prefix: str) -> bool:
    return any(e.startswith(prefix) for e in env)


def _value_for(env: list[str], key: str) -> str | None:
    for e in env:
        if e.startswith(f"{key}="):
            return e.split("=", 1)[1]
    return None


# ── Cerberus service wiring ──────────────────────────────────────────────────

@pytest.mark.parametrize("compose_path", COMPOSE_FILES, ids=lambda p: p.name)
def test_cerberus_has_sandbox_api_key(compose_path):
    data = yaml.safe_load(compose_path.read_text())
    env = _env_list(data, "cerberus")
    assert _has_key_prefix(env, "SANDBOX_API_KEY="), (
        f"{compose_path.name}: cerberus service must set SANDBOX_API_KEY"
    )


# ── OpenSandbox server wiring ────────────────────────────────────────────────

@pytest.mark.parametrize("compose_path", COMPOSE_FILES, ids=lambda p: p.name)
def test_opensandbox_server_has_api_key(compose_path):
    data = yaml.safe_load(compose_path.read_text())
    env = _env_list(data, "opensandbox-server")
    assert _has_key_prefix(env, "OPENSANDBOX_SERVER_API_KEY="), (
        f"{compose_path.name}: opensandbox-server must set OPENSANDBOX_SERVER_API_KEY"
    )


# ── Insecure bypass removed ───────────────────────────────────────────────────

@pytest.mark.parametrize("compose_path", COMPOSE_FILES, ids=lambda p: p.name)
def test_insecure_server_bypass_absent(compose_path):
    text = compose_path.read_text()
    assert "OPENSANDBOX_INSECURE_SERVER" not in text, (
        f"{compose_path.name}: OPENSANDBOX_INSECURE_SERVER bypass must be removed"
    )


# ── Both sides reference the same shared variable ────────────────────────────

@pytest.mark.parametrize("compose_path", COMPOSE_FILES, ids=lambda p: p.name)
def test_shared_key_variable_consistent(compose_path):
    """SANDBOX_API_KEY and OPENSANDBOX_SERVER_API_KEY both expand OPENSANDBOX_API_KEY."""
    data = yaml.safe_load(compose_path.read_text())
    cerberus_val = _value_for(_env_list(data, "cerberus"), "SANDBOX_API_KEY")
    server_val   = _value_for(_env_list(data, "opensandbox-server"), "OPENSANDBOX_SERVER_API_KEY")
    assert cerberus_val is not None
    assert server_val is not None
    assert "OPENSANDBOX_API_KEY" in cerberus_val, (
        "SANDBOX_API_KEY must reference OPENSANDBOX_API_KEY"
    )
    assert "OPENSANDBOX_API_KEY" in server_val, (
        "OPENSANDBOX_SERVER_API_KEY must reference OPENSANDBOX_API_KEY"
    )


# ── sandbox_backend reads SANDBOX_API_KEY ────────────────────────────────────

def test_sandbox_backend_reads_api_key_env_var():
    """sandbox_backend.py must source SANDBOX_API_KEY, not hard-code a fixed value."""
    src = (ROOT / "src" / "agent_tools" / "sandbox_backend.py").read_text()
    assert 'os.environ.get("SANDBOX_API_KEY"' in src, (
        "sandbox_backend.py must read SANDBOX_API_KEY from environment"
    )
