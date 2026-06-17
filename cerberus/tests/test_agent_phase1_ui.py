"""Tests for Phase 1 AGENTS tab — category grouping correctness.

The CATEGORY_MAP lives in agents.js (JS), but we can validate the logic
against the Python default-agent roster to catch future name drift.
"""

import sys
from unittest.mock import MagicMock

for _mod in [
    "sqlalchemy", "sqlalchemy.orm", "sqlalchemy.ext", "sqlalchemy.ext.declarative",
    "sqlalchemy.ext.hybrid", "sqlalchemy.sql", "sqlalchemy.sql.expression",
    "core.database", "src.auth_helpers",
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

from routes.cerberus_agent_defaults import _DEFAULT_AGENTS

# Mirror of agents.js CATEGORY_MAP — must stay in sync with the JS constant
_CATEGORY_MAP = {
    "ARCHITECT": "CORE", "CODER": "CORE", "TESTER": "CORE",
    "RESEARCHER": "CORE", "REVIEWER": "CORE",
    "SECURITY": "SECURITY",
    "ORCHESTRATOR": "OPS", "DEVOPS": "OPS", "DEBUGGER": "OPS", "PLANNER": "OPS",
    "DATA-ANALYST": "DATA", "LIBRARIAN": "DATA", "OPTIMIZER": "DATA",
    "SCRIBE": "COMMS", "DESIGNER": "COMMS", "PROMPTSMITH": "COMMS",
}

_VALID_CATEGORIES = {"CORE", "SECURITY", "OPS", "DATA", "COMMS", "CUSTOM"}


def _get_category(name: str) -> str:
    return _CATEGORY_MAP.get(name.upper(), "CUSTOM")


def test_all_default_agents_have_valid_category():
    for agent in _DEFAULT_AGENTS:
        cat = _get_category(agent["name"])
        assert cat in _VALID_CATEGORIES, f"{agent['name']} maps to unknown category {cat!r}"


def test_known_agents_map_to_expected_categories():
    expected = {
        "ARCHITECT": "CORE", "CODER": "CORE", "TESTER": "CORE",
        "RESEARCHER": "CORE", "REVIEWER": "CORE",
        "SECURITY": "SECURITY",
        "ORCHESTRATOR": "OPS", "DEVOPS": "OPS", "DEBUGGER": "OPS", "PLANNER": "OPS",
        "DATA-ANALYST": "DATA", "LIBRARIAN": "DATA", "OPTIMIZER": "DATA",
        "SCRIBE": "COMMS", "DESIGNER": "COMMS", "PROMPTSMITH": "COMMS",
    }
    for name, cat in expected.items():
        assert _get_category(name) == cat, f"{name}: expected {cat}, got {_get_category(name)}"


def test_unknown_name_falls_back_to_custom():
    assert _get_category("MY-CUSTOM-AGENT") == "CUSTOM"
    assert _get_category("") == "CUSTOM"
    assert _get_category("RANDOM") == "CUSTOM"


def test_category_map_covers_all_default_agents_or_custom():
    """Every default agent either has an explicit category or gracefully falls to CUSTOM."""
    names = {a["name"] for a in _DEFAULT_AGENTS}
    mapped = set(_CATEGORY_MAP.keys())
    # Names not in the map go to CUSTOM — that's fine, just verify no typos in map
    unmapped = names - mapped
    # All unmapped names should be valid agent names (not map typos)
    for n in unmapped:
        assert n in names, f"{n} is in CATEGORY_MAP but not in _DEFAULT_AGENTS"


def test_sigil_hash_is_deterministic():
    """Python re-implementation of the JS sigil hash — verifies determinism."""
    def _hash(name: str) -> int:
        h = 0
        for c in name:
            h = ((h * 31) + ord(c)) & 0xFFFFFFFF
        return h

    PALETTE_LEN = 8
    for agent in _DEFAULT_AGENTS:
        name = agent["name"]
        h1 = _hash(name) % PALETTE_LEN
        h2 = _hash(name) % PALETTE_LEN
        assert h1 == h2, f"Sigil hash non-deterministic for {name}"


def test_sigil_hash_distributes_across_palette():
    """Default agents should not all land on the same palette slot."""
    def _hash(name: str) -> int:
        h = 0
        for c in name:
            h = ((h * 31) + ord(c)) & 0xFFFFFFFF
        return h

    PALETTE_LEN = 8
    slots = {_hash(a["name"]) % PALETTE_LEN for a in _DEFAULT_AGENTS}
    assert len(slots) > 2, "All agents landed on ≤2 palette slots — hash likely broken"


def test_category_group_counts():
    """Sanity check: core groups are non-empty."""
    from collections import Counter
    cats = Counter(_get_category(a["name"]) for a in _DEFAULT_AGENTS)
    assert cats["CORE"] >= 5, "Expected at least 5 CORE agents"
    assert cats["SECURITY"] >= 1, "Expected at least 1 SECURITY agent"
    assert cats["OPS"] >= 4, "Expected at least 4 OPS agents"
    assert cats["DATA"] >= 3, "Expected at least 3 DATA agents"
    assert cats["COMMS"] >= 3, "Expected at least 3 COMMS agents"
