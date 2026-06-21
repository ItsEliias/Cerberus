"""LLMLingua compression — unit tests (fast lane, no model download).

All tests mock PromptCompressor so nothing requires torch or a model on disk.

Covers six invariants:
  1. compress_tool_output returns compressed text when compressor is available.
  2. Falls back to original on compression error.
  3. LLMLINGUA_ENABLED=false skips compression and returns original.
  4. compress_rag_chunks handles each chunk independently; error returns original chunk.
  5. Never raises — always returns a string.
  6. Missing llmlingua import → identity fallback.
"""

import os
import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import src.llmlingua_compressor as lc


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    """Reset the module-level compressor cache and stats before every test."""
    lc._reset_for_tests()
    yield
    lc._reset_for_tests()


def _make_compressor(compressed="COMPRESSED", *, raise_on_call=False):
    """Return a mock PromptCompressor that returns a predictable result."""
    mock = MagicMock()
    if raise_on_call:
        mock.compress_prompt_llmlingua2.side_effect = RuntimeError("boom")
    else:
        mock.compress_prompt_llmlingua2.return_value = {
            "compressed_prompt": compressed,
            "origin_tokens": 100,
            "compressed_tokens": 20,
            "ratio": 0.2,
        }
    return mock


# ---------------------------------------------------------------------------
# 1. Returns compressed text when compressor available
# ---------------------------------------------------------------------------

def test_compress_tool_output_returns_compressed(monkeypatch):
    """compress_tool_output returns the compressed string on success."""
    monkeypatch.setattr(lc, "LLMLINGUA_ENABLED", True)
    monkeypatch.setattr(lc, "_get_compressor", lambda: _make_compressor("COMPRESSED"))
    result = lc.compress_tool_output("A" * 200)
    assert result == "COMPRESSED"


# ---------------------------------------------------------------------------
# 2. Falls back to original on compression error
# ---------------------------------------------------------------------------

def test_compress_tool_output_fallback_on_error(monkeypatch):
    """Returns original text when the compressor call raises."""
    monkeypatch.setattr(lc, "LLMLINGUA_ENABLED", True)
    monkeypatch.setattr(lc, "_get_compressor", lambda: _make_compressor(raise_on_call=True))
    original = "original content " * 10
    result = lc.compress_tool_output(original)
    assert result == original


# ---------------------------------------------------------------------------
# 3. LLMLINGUA_ENABLED=false skips compression
# ---------------------------------------------------------------------------

def test_compress_tool_output_disabled(monkeypatch):
    """When LLMLINGUA_ENABLED is False, compression is bypassed."""
    monkeypatch.setattr(lc, "LLMLINGUA_ENABLED", False)
    called = []
    monkeypatch.setattr(lc, "_get_compressor", lambda: called.append(1) or _make_compressor())
    original = "should not be compressed " * 10
    result = lc.compress_tool_output(original)
    assert result == original
    assert not called, "_get_compressor must not be called when disabled"


# ---------------------------------------------------------------------------
# 4. compress_rag_chunks handles each chunk independently
# ---------------------------------------------------------------------------

def test_compress_rag_chunks_per_chunk_failure(monkeypatch):
    """Error on one chunk returns that chunk's original; others still compress."""
    monkeypatch.setattr(lc, "LLMLINGUA_ENABLED", True)
    call_count = [0]

    def _mock_compress(text, **_):
        call_count[0] += 1
        if "FAIL" in text:
            raise RuntimeError("simulated failure")
        return "COMPRESSED"

    monkeypatch.setattr(lc, "compress_tool_output", _mock_compress)

    chunks = ["good chunk " * 20, "FAIL chunk " * 20, "another good " * 20]
    result = lc.compress_rag_chunks(chunks)

    assert result[0] == "COMPRESSED"
    assert result[1] == chunks[1]  # original returned on error
    assert result[2] == "COMPRESSED"
    assert len(result) == 3


def test_compress_rag_chunks_preserves_order(monkeypatch):
    """Output list has same length and ordering as input."""
    monkeypatch.setattr(lc, "LLMLINGUA_ENABLED", True)
    idx = [0]

    def _seq_compress(text, **_):
        idx[0] += 1
        return f"C{idx[0]}"

    monkeypatch.setattr(lc, "compress_tool_output", _seq_compress)
    chunks = ["a " * 100, "b " * 100, "c " * 100]
    result = lc.compress_rag_chunks(chunks)
    assert result == ["C1", "C2", "C3"]


# ---------------------------------------------------------------------------
# 5. Never raises — always returns a string
# ---------------------------------------------------------------------------

def test_compress_tool_output_never_raises(monkeypatch):
    """compress_tool_output must never raise, even with completely broken state."""
    monkeypatch.setattr(lc, "LLMLINGUA_ENABLED", True)
    monkeypatch.setattr(lc, "_get_compressor", lambda: (_ for _ in ()).throw(Exception("broken")))
    # Should not raise; returns original
    try:
        result = lc.compress_tool_output("some text " * 20)
        assert isinstance(result, str)
    except Exception as e:
        pytest.fail(f"compress_tool_output raised unexpectedly: {e}")


def test_compress_rag_chunks_never_raises(monkeypatch):
    """compress_rag_chunks must never raise."""
    monkeypatch.setattr(lc, "LLMLINGUA_ENABLED", True)
    monkeypatch.setattr(lc, "_get_compressor", lambda: (_ for _ in ()).throw(Exception("broken")))
    try:
        result = lc.compress_rag_chunks(["text " * 30, "more " * 30])
        assert isinstance(result, list)
    except Exception as e:
        pytest.fail(f"compress_rag_chunks raised unexpectedly: {e}")


# ---------------------------------------------------------------------------
# 6. Missing llmlingua import → identity fallback
# ---------------------------------------------------------------------------

def test_missing_llmlingua_import_falls_back(monkeypatch):
    """If llmlingua is not installed, _get_compressor returns None and text passes through."""
    monkeypatch.setattr(lc, "LLMLINGUA_ENABLED", True)
    # Simulate an import error by making _get_compressor return None
    monkeypatch.setattr(lc, "_get_compressor", lambda: None)
    original = "text that would be compressed " * 10
    result = lc.compress_tool_output(original)
    assert result == original, "Should fall back to identity when compressor is None"


# ---------------------------------------------------------------------------
# 7. Short inputs bypass compression (perf guard)
# ---------------------------------------------------------------------------

def test_short_input_bypasses_compression(monkeypatch):
    """Inputs below _BYPASS_BELOW_CHARS are returned as-is without calling the compressor."""
    monkeypatch.setattr(lc, "LLMLINGUA_ENABLED", True)
    called = []
    monkeypatch.setattr(lc, "_get_compressor", lambda: called.append(1) or _make_compressor())
    result = lc.compress_tool_output("short")
    assert result == "short"
    assert not called, "Compressor should not be invoked for very short inputs"
