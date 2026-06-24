"""Tests for STT 503 detail, profile-persona gate, and reasoning-tag stripping.

Stubs numpy + rag chain before any services.* import so conftest's import of
core.database doesn't pull in VectorRAG (which needs numpy).
"""

import sys
import types
from unittest.mock import MagicMock
import pytest

# ── Stub numpy and rag chain before any services.* import ────────────────────
for _mod in ("numpy", "src.rag_vector", "src.rag_manager"):
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()  # type: ignore

# Also stub services.docs and services.research which import rag_manager
for _mod in ("services.docs", "services.research", "services.memory", "services.shell", "services.search"):
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()  # type: ignore


# ── Issue 1: STT unavailable_reason ──────────────────────────────────────────

class TestSTTUnavailableReason:
    def _service(self, **settings_overrides):
        from services.stt.stt_service import STTService
        svc = STTService()
        defaults = {
            "stt_enabled": True,
            "stt_provider": "local",
            "stt_model": "base",
            "stt_language": "",
        }
        defaults.update(settings_overrides)
        svc._load_settings = lambda: defaults
        return svc

    def test_disabled_setting(self):
        svc = self._service(stt_enabled=False)
        reason = svc.unavailable_reason
        assert reason
        assert "disabled" in reason.lower()
        assert not svc.available

    def test_provider_disabled(self):
        svc = self._service(stt_provider="disabled")
        reason = svc.unavailable_reason
        assert reason
        assert not svc.available

    def test_provider_browser(self):
        svc = self._service(stt_provider="browser")
        reason = svc.unavailable_reason
        assert reason
        assert "browser" in reason.lower()
        assert not svc.available

    def test_local_missing_faster_whisper(self):
        svc = self._service(stt_provider="local")
        # Stub faster_whisper as unavailable
        real = sys.modules.get("faster_whisper", _SENTINEL := object())
        sys.modules["faster_whisper"] = None  # type: ignore
        try:
            reason = svc.unavailable_reason
        finally:
            if real is _SENTINEL:
                sys.modules.pop("faster_whisper", None)
            else:
                sys.modules["faster_whisper"] = real  # type: ignore
        assert "faster-whisper" in reason.lower() or "faster_whisper" in reason.lower()
        assert "install" in reason.lower()

    def test_endpoint_available(self):
        svc = self._service(stt_provider="endpoint:my-endpoint")
        assert svc.unavailable_reason == ""
        assert svc.available

    @pytest.mark.asyncio
    async def test_503_detail_uses_specific_reason(self):
        """stt_routes uses unavailable_reason, not the old generic message."""
        from fastapi import HTTPException
        from routes.stt_routes import setup_stt_routes

        fake_svc = MagicMock()
        fake_svc.available = False
        fake_svc.unavailable_reason = (
            "faster-whisper is not installed — run: pip install faster-whisper"
        )

        router = setup_stt_routes(fake_svc)
        route_fn = None
        for route in router.routes:
            if getattr(route, "name", None) == "transcribe_audio":
                route_fn = route.endpoint
                break
        assert route_fn is not None, "transcribe_audio route not found"

        mock_file = MagicMock()
        with pytest.raises(HTTPException) as exc_info:
            await route_fn(file=mock_file)

        assert exc_info.value.status_code == 503
        detail = exc_info.value.detail
        msg = detail.get("message", "") if isinstance(detail, dict) else str(detail)
        assert "faster-whisper" in msg or "install" in msg.lower()
        # Old generic message must NOT appear
        assert "not available or set to browser mode" not in msg


# ── Issue 2: Profile-persona gate ────────────────────────────────────────────

class TestProfilePersonaGate:
    def _build_processor(self, profile_pinned=False):
        """Minimal ChatProcessor with stub MemoryManager.

        profile_pinned=True makes the operator_profile memory always-included
        (pinned), so we can verify the filter without depending on BM25 retrieval.
        """
        from src.chat_processor import ChatProcessor

        mm = MagicMock()
        mm.load.return_value = [
            {
                "id": "1",
                "text": "Operator: Alice. Role: CEO. Bio: I lead the company.",
                "category": "operator_profile",
                "pinned": profile_pinned,
                "uses": 0,
            },
            {
                "id": "2",
                "text": "User likes dark mode.",
                "category": "preference",
                "pinned": True,
                "uses": 0,
            },
        ]
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

    def test_operator_profile_excluded_by_default(self):
        # Profile is pinned so it would appear if not filtered
        cp = self._build_processor(profile_pinned=True)
        preface, _, _ = cp.build_context_preface(
            message="hello",
            session=MagicMock(history=[], id="s1"),
            use_memory=True,
            agent_mode=False,
            incognito=False,
            use_profile_persona=False,
        )
        combined = " ".join(
            m.get("content", "") for m in preface if isinstance(m.get("content"), str)
        )
        assert "CEO" not in combined
        assert "Alice" not in combined

    def test_preference_memory_still_injected(self):
        cp = self._build_processor(profile_pinned=True)
        preface, _, _ = cp.build_context_preface(
            message="hello",
            session=MagicMock(history=[], id="s1"),
            use_memory=True,
            agent_mode=False,
            incognito=False,
            use_profile_persona=False,
        )
        combined = " ".join(
            m.get("content", "") for m in preface if isinstance(m.get("content"), str)
        )
        assert "dark mode" in combined

    def test_operator_profile_included_when_enabled(self):
        # Profile is pinned so it always makes it through retrieval
        cp = self._build_processor(profile_pinned=True)
        preface, _, _ = cp.build_context_preface(
            message="hello",
            session=MagicMock(history=[], id="s1"),
            use_memory=True,
            agent_mode=False,
            incognito=False,
            use_profile_persona=True,
        )
        combined = " ".join(
            m.get("content", "") for m in preface if isinstance(m.get("content"), str)
        )
        assert "CEO" in combined or "Alice" in combined

    def test_operator_profile_included_in_agent_mode(self):
        cp = self._build_processor(profile_pinned=True)
        preface, _, _ = cp.build_context_preface(
            message="what can you do",
            session=MagicMock(history=[], id="s1"),
            use_memory=True,
            agent_mode=True,
            incognito=False,
            use_profile_persona=True,
        )
        combined = " ".join(
            m.get("content", "") for m in preface if isinstance(m.get("content"), str)
        )
        assert "CEO" in combined or "Alice" in combined

    def test_chat_profile_persona_default_false_in_settings(self):
        from src.settings import DEFAULT_SETTINGS
        assert DEFAULT_SETTINGS.get("chat_profile_persona") is False


# ── Issue 3: Reasoning tag stripping ─────────────────────────────────────────

class TestReasoningTagStripping:
    def test_strip_think_handles_reason_tag(self):
        from src.text_helpers import strip_think
        result = strip_think("<reason>internal reasoning</reason>Final answer.")
        assert "Final answer." in result
        assert "<reason>" not in result
        assert "internal reasoning" not in result

    def test_strip_think_handles_scratchpad_tag(self):
        from src.text_helpers import strip_think
        result = strip_think("<scratchpad>my scratch work</scratchpad>Here is the answer.")
        assert "Here is the answer." in result
        assert "<scratchpad>" not in result
        assert "scratch work" not in result

    def test_strip_think_handles_reasoning_tag(self):
        from src.text_helpers import strip_think
        result = strip_think("<reasoning>step by step</reasoning>Done.")
        assert "Done." in result
        assert "<reasoning>" not in result

    def test_strip_think_inline_reason_block(self):
        from src.text_helpers import strip_think
        result = strip_think("Before. <reason>aside</reason> After.")
        assert "Before." in result
        assert "After." in result
        assert "aside" not in result

    def test_strip_think_unclosed_reason(self):
        from src.text_helpers import strip_think
        result = strip_think("Prefix <reason>unclosed")
        assert "Prefix" in result
        assert "unclosed" not in result

    def test_existing_think_tags_still_stripped(self):
        from src.text_helpers import strip_think
        result = strip_think("<think>thinking...</think>Answer.")
        assert "Answer." in result
        assert "thinking" not in result

    def test_existing_thinking_tags_still_stripped(self):
        from src.text_helpers import strip_think
        result = strip_think("<thinking>internal</thinking>Final.")
        assert "Final." in result
        assert "internal" not in result

    def test_save_path_strips_reason_tags(self):
        """save_assistant_response strips <reason> blocks from saved content."""
        from routes.chat_helpers import save_assistant_response

        sess = MagicMock()
        sess.history = []
        captured = {}

        def fake_add(msg):
            captured["content"] = msg.content

        sess.add_message.side_effect = fake_add
        sess.model = "test-model"
        sm = MagicMock()

        raw = "<reason>step 1: think</reason>Actual answer here."
        save_assistant_response(
            sess, sm, "sess-id",
            raw,
            None,
            incognito=True,
        )

        content = captured.get("content", "")
        assert "<reason>" not in content
        assert "step 1: think" not in content
        assert "Actual answer here." in content
