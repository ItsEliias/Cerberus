"""Tests for Cerberus plain-chat identity injection and operator_profile exclusion.

Verifies:
  1. Plain chat (no preset, not agent_mode) receives the Cerberus identity.
  2. When a preset system prompt is set the identity is NOT injected.
  3. Agent mode does NOT receive the plain-chat identity.
  4. With use_profile_persona=False, operator_profile memories never reach context.
  5. Non-profile memories still appear regardless of the flag.
"""

import sys
import types
from unittest.mock import MagicMock
import pytest

# ── Stub heavy imports before any services.* / src.rag* is pulled in ─────────
for _mod in ("numpy", "src.rag_vector", "src.rag_manager"):
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()  # type: ignore

for _mod in (
    "services.docs",
    "services.research",
    "services.memory",
    "services.shell",
    "services.search",
):
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()  # type: ignore


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_processor(profile_pinned: bool = False, extra_memories: list | None = None):
    """Build a minimal ChatProcessor with a stub MemoryManager."""
    from src.chat_processor import ChatProcessor

    memories = [
        {
            "id": "profile-1",
            "text": "Operator: Alice. Role: quality-engineering specialist. Bio: I lead QE.",
            "category": "operator_profile",
            "pinned": profile_pinned,
            "uses": 0,
        },
        {
            "id": "pref-1",
            "text": "User prefers dark mode.",
            "category": "preference",
            "pinned": True,
            "uses": 0,
        },
    ]
    if extra_memories:
        memories.extend(extra_memories)

    mm = MagicMock()
    mm.load.return_value = memories
    mm.increment_uses = MagicMock()

    cp = ChatProcessor.__new__(ChatProcessor)
    cp.memory_manager = mm
    cp.memory_vector = None
    cp.personal_docs_manager = MagicMock()
    cp.skills_manager = MagicMock()
    cp.skills_manager.index_for.return_value = []
    cp._last_used_memories = []
    cp.RAG_SIMILARITY_THRESHOLD = 0.5
    return cp


def _preface_text(preface: list) -> str:
    """Flatten preface system messages into a single searchable string."""
    parts = []
    for m in preface:
        c = m.get("content", "")
        if isinstance(c, str):
            parts.append(c)
        elif isinstance(c, list):
            for block in c:
                if isinstance(block, dict):
                    parts.append(block.get("text", ""))
    return " ".join(parts)


def _call_preface(cp, *, agent_mode=False, preset=None, use_profile_persona=False):
    preface, _, _ = cp.build_context_preface(
        message="hello",
        session=MagicMock(history=[], id="s1"),
        use_memory=True,
        agent_mode=agent_mode,
        incognito=False,
        use_profile_persona=use_profile_persona,
        preset_system_prompt=preset,
    )
    return preface


# ── Tests: Cerberus identity injection ───────────────────────────────────────

class TestCerberusIdentityInjection:
    def test_identity_present_in_plain_chat(self):
        from src.chat_processor import CERBERUS_PLAIN_CHAT_IDENTITY
        cp = _build_processor()
        preface = _call_preface(cp)
        text = _preface_text(preface)
        assert "Cerberus" in text
        assert CERBERUS_PLAIN_CHAT_IDENTITY in text

    def test_identity_absent_when_preset_set(self):
        from src.chat_processor import CERBERUS_PLAIN_CHAT_IDENTITY
        cp = _build_processor()
        preface = _call_preface(cp, preset="You are a pirate assistant.")
        text = _preface_text(preface)
        assert "pirate" in text
        assert CERBERUS_PLAIN_CHAT_IDENTITY not in text

    def test_identity_absent_in_agent_mode(self):
        from src.chat_processor import CERBERUS_PLAIN_CHAT_IDENTITY
        cp = _build_processor()
        preface = _call_preface(cp, agent_mode=True)
        text = _preface_text(preface)
        assert CERBERUS_PLAIN_CHAT_IDENTITY not in text

    def test_identity_constant_is_editable_string(self):
        from src.chat_processor import CERBERUS_PLAIN_CHAT_IDENTITY
        assert isinstance(CERBERUS_PLAIN_CHAT_IDENTITY, str)
        assert len(CERBERUS_PLAIN_CHAT_IDENTITY) > 20


# ── Tests: operator_profile exclusion ────────────────────────────────────────

class TestOperatorProfileExclusion:
    def test_profile_excluded_plain_chat_default(self):
        # Profile pinned so it passes retrieval — must still be excluded.
        cp = _build_processor(profile_pinned=True)
        preface = _call_preface(cp, use_profile_persona=False)
        text = _preface_text(preface)
        assert "quality-engineering specialist" not in text
        assert "Alice" not in text

    def test_profile_included_when_flag_on(self):
        cp = _build_processor(profile_pinned=True)
        preface = _call_preface(cp, use_profile_persona=True)
        text = _preface_text(preface)
        assert "quality-engineering specialist" in text or "Alice" in text

    def test_non_profile_memory_still_injected(self):
        cp = _build_processor(profile_pinned=True)
        preface = _call_preface(cp, use_profile_persona=False)
        text = _preface_text(preface)
        assert "dark mode" in text

    def test_identity_present_and_profile_absent_simultaneously(self):
        """The core combined assertion: identity in, profile out."""
        from src.chat_processor import CERBERUS_PLAIN_CHAT_IDENTITY
        cp = _build_processor(profile_pinned=True)
        preface = _call_preface(cp, use_profile_persona=False)
        text = _preface_text(preface)
        assert CERBERUS_PLAIN_CHAT_IDENTITY in text
        assert "quality-engineering specialist" not in text
        assert "Alice" not in text

    def test_agent_mode_keeps_profile(self):
        cp = _build_processor(profile_pinned=True)
        preface = _call_preface(cp, agent_mode=True, use_profile_persona=True)
        text = _preface_text(preface)
        assert "quality-engineering specialist" in text or "Alice" in text
