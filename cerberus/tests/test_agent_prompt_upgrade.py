"""Tests for the agent roster upgrade — verifies defaults content and migration script logic."""

import os
import sys
import types
import argparse
from pathlib import Path
from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# Stub heavy imports before any project module is loaded
# ---------------------------------------------------------------------------

for _mod in [
    "sqlalchemy", "sqlalchemy.orm", "sqlalchemy.ext", "sqlalchemy.ext.declarative",
    "sqlalchemy.ext.hybrid", "sqlalchemy.sql", "sqlalchemy.sql.expression",
    "core.database", "src.auth_helpers",
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

from routes.cerberus_agent_defaults import _DEFAULT_AGENTS

EXPECTED_NAMES = {
    "ORCHESTRATOR", "ARCHITECT", "CODER", "TESTER", "RESEARCHER",
    "REVIEWER", "SECURITY", "DEVOPS", "DATA-ANALYST", "SCRIBE",
    "DESIGNER", "DEBUGGER", "PLANNER", "LIBRARIAN", "OPTIMIZER", "PROMPTSMITH",
}

# ---------------------------------------------------------------------------
# Tests: _DEFAULT_AGENTS content
# ---------------------------------------------------------------------------

def test_all_16_agents_present():
    names = {a["name"] for a in _DEFAULT_AGENTS}
    missing = EXPECTED_NAMES - names
    assert not missing, f"Missing agents: {missing}"


def test_no_duplicate_names():
    names = [a["name"] for a in _DEFAULT_AGENTS]
    assert len(names) == len(set(names))


def test_all_required_fields_present():
    required = {"name", "role", "agent_type", "status", "model_alias", "system_prompt"}
    for agent in _DEFAULT_AGENTS:
        missing = required - set(agent.keys())
        assert not missing, f"{agent.get('name')} missing: {missing}"


def test_all_prompts_exceed_400_chars():
    for agent in _DEFAULT_AGENTS:
        length = len(agent["system_prompt"].strip())
        assert length > 400, (
            f"{agent['name']} prompt too short: {length} chars (want > 400)"
        )


def test_prompts_contain_framework_markers():
    """Each upgraded prompt should contain numbered steps or explicit framework language."""
    framework_indicators = ["1.", "Step", "framework", "Framework", "STRIDE", "ADR", "TDD"]
    for agent in _DEFAULT_AGENTS:
        prompt = agent["system_prompt"]
        found = any(ind in prompt for ind in framework_indicators)
        assert found, f"{agent['name']} prompt appears to lack framework structure"


def test_security_agent_references_invariants():
    security = next(a for a in _DEFAULT_AGENTS if a["name"] == "SECURITY")
    prompt = security["system_prompt"]
    assert "loopback" in prompt or "OpenSandbox" in prompt or "invariant" in prompt.lower()


def test_orchestrator_does_not_self_assign():
    orch = next(a for a in _DEFAULT_AGENTS if a["name"] == "ORCHESTRATOR")
    prompt = orch["system_prompt"]
    assert "never assign work to yourself" in prompt.lower() or "do not execute" in prompt.lower()


# ---------------------------------------------------------------------------
# Tests: migration script logic (no live DB)
# ---------------------------------------------------------------------------

def _build_fake_db(existing_names: set[str], owner: str = "itseliias"):
    """Return a fake SQLAlchemy session that returns agents for names in existing_names."""
    agents_by_name: dict[str, MagicMock] = {}
    for name in existing_names:
        agent = MagicMock()
        agent.name = name
        agent.system_prompt = f"old prompt for {name}"
        agents_by_name[name] = agent

    class _Q:
        def __init__(self):
            self._owner_filter = None
            self._name_filter = None

        def filter(self, *args, **kwargs):
            # Capture the name from the filter args by inspecting the call
            # In practice the script does: .filter(owner==, name==)
            # We just return self and resolve in first()
            return self

        def first(self_inner):
            # We can't easily introspect SQLAlchemy BinaryExpression mocks,
            # so we iterate and check which name the script is looking up.
            # The script loops _DEFAULT_AGENTS in order; track via a counter.
            name = _Q._current_name
            return agents_by_name.get(name)

        _current_name = ""

    class _FakeDB:
        def query(self, model):
            return _Q()

        def commit(self):
            pass

        def close(self):
            pass

    return _FakeDB(), agents_by_name


def test_migration_script_imports_cleanly():
    """The migration script module must be importable without side effects."""
    script_path = Path(__file__).parent.parent / "scripts" / "upgrade_agent_prompts.py"
    assert script_path.exists(), "scripts/upgrade_agent_prompts.py not found"

    spec = __import__("importlib").util.spec_from_file_location("upgrade_agent_prompts", script_path)
    mod = __import__("importlib").util.module_from_spec(spec)
    # Patch heavy imports so loading the module doesn't try to connect to DB
    with patch.dict(sys.modules, {
        "core.database": MagicMock(SessionLocal=MagicMock(), CerberusAgent=MagicMock()),
        "routes.cerberus_agent_defaults": MagicMock(_DEFAULT_AGENTS=_DEFAULT_AGENTS),
    }):
        spec.loader.exec_module(mod)

    assert hasattr(mod, "main"), "upgrade_agent_prompts must define main()"


def test_migration_script_exists():
    script_path = Path(__file__).parent.parent / "scripts" / "upgrade_agent_prompts.py"
    assert script_path.exists()
    content = script_path.read_text()
    assert "UPDATE" in content or "system_prompt" in content
    assert "--owner" in content
    assert "--dry-run" in content


# ---------------------------------------------------------------------------
# Tests: skill files (8 skills across 3 categories)
# ---------------------------------------------------------------------------

_skills_root = Path(__file__).parent.parent / "data" / "skills"

# (category, slug) pairs
SKILLS = [
    # cerberus category
    ("cerberus", "cerberus-security-invariants"),
    ("cerberus", "cerberus-stack"),
    ("cerberus", "cerberus-known-gotchas"),
    ("cerberus", "cerberus-api-surface"),
    # engineering category
    ("engineering", "git-verification-protocol"),
    ("engineering", "adr-template"),
    ("engineering", "threat-model-template"),
    # design category
    ("design", "nexus-hud-design-tokens"),
]


def test_all_8_skill_files_exist():
    missing = [
        f"{cat}/{slug}/SKILL.md"
        for cat, slug in SKILLS
        if not (_skills_root / cat / slug / "SKILL.md").exists()
    ]
    assert not missing, f"Missing skill files: {missing}"


def test_skill_files_have_required_frontmatter():
    required_keys = ["name:", "description:", "version:", "category:", "tags:", "status:", "owner:", "created:"]
    for cat, slug in SKILLS:
        content = (_skills_root / cat / slug / "SKILL.md").read_text()
        for key in required_keys:
            assert key in content, f"{cat}/{slug}/SKILL.md missing frontmatter key: {key}"


def test_skill_files_have_procedure_section():
    for cat, slug in SKILLS:
        content = (_skills_root / cat / slug / "SKILL.md").read_text()
        assert "## Procedure" in content, f"{cat}/{slug}/SKILL.md missing ## Procedure section"
        assert "## When to Use" in content, f"{cat}/{slug}/SKILL.md missing ## When to Use section"


def test_skill_files_category_matches_directory():
    """The 'category:' frontmatter value must match the directory name."""
    for cat, slug in SKILLS:
        content = (_skills_root / cat / slug / "SKILL.md").read_text()
        assert f"category: {cat}" in content, (
            f"{cat}/{slug}/SKILL.md has wrong category — expected 'category: {cat}'"
        )
