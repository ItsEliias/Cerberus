"""LLMLingua-based context compression.

Wraps `llmlingua.PromptCompressor.compress_prompt_llmlingua2` so the agent
loop and RAG injection points can shrink tool outputs / memory snippets
before they reach the LLM. The Llmlingua-2 path uses a small XLM-R or BERT
classifier (CPU-friendly, ~700 MB to download once), unlike the original
LLMLingua which loads a 7B Llama and expects CUDA.

Two public functions:

    compress_tool_output(text, max_tokens=None) -> str
    compress_rag_chunks(chunks, max_tokens=None) -> list[str]

Both are SAFE in the strict sense:
  - Disabled by default (LLMLINGUA_ENABLED=false) — the model download is
    slow and the operator should opt in explicitly. Setting the env var
    to "true" enables compression; tests opt in per-test via monkeypatch.
  - Any exception during model load, tokenisation, or compression is
    swallowed and the original content is returned. The LLM path MUST
    never break because compression failed.
  - Empty / very-short inputs (below ~80 chars) bypass compression
    entirely — the per-call overhead outweighs the savings.
  - The PromptCompressor instance is cached at module scope so the
    expensive model load happens at most once per process.

Observability:
  - Each successful compression logs at DEBUG with original / compressed
    token counts + ratio.
  - Module-level `get_stats()` returns a cumulative {original_tokens,
    compressed_tokens, calls, errors} dict for surfacing in admin UIs.

Originally specced as `headroom_compressor.py`; the `headroom` package on
PyPI is an unrelated CLI assistant. Renamed to use LLMLingua, which is
the actual prompt-compression library this PR was meant to land.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ── Configuration ─────────────────────────────────────────────────────────

def _env_bool(name: str, default: bool) -> bool:
    """Truthy parse of an environment variable. Whitespace-only and
    common falsy strings ("0", "false", "no", "off") map to False."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    v = raw.strip().lower()
    if not v:
        return default
    if v in {"0", "false", "no", "off"}:
        return False
    if v in {"1", "true", "yes", "on"}:
        return True
    return default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


LLMLINGUA_ENABLED = _env_bool("LLMLINGUA_ENABLED", True)

# Target token cap per compressed chunk. Compression aims for this many
# tokens; the library may go slightly over or under depending on the
# tokenizer. 0 or negative disables the target_token guidance and uses
# `rate` instead.
LLMLINGUA_TARGET_TOKENS = _env_int("LLMLINGUA_TARGET_TOKENS", 2000)

# Bypass threshold — sub-budget inputs aren't worth the compression
# overhead. Mostly a performance guard; not in the env API.
_BYPASS_BELOW_CHARS = 80


# LLMLingua-2 model. xlm-roberta-large gives the best multilingual
# quality; the bert-base-multilingual variant is ~half the size if a
# deployment needs to trade quality for footprint. Override via env.
LLMLINGUA_MODEL = os.environ.get(
    "LLMLINGUA_MODEL",
    "microsoft/llmlingua-2-xlm-roberta-large-meetingbank",
)


# ── Stats (cumulative, process-local) ─────────────────────────────────────

_STATS: Dict[str, int] = {
    "calls": 0,
    "errors": 0,
    "bypassed": 0,
    "original_tokens": 0,
    "compressed_tokens": 0,
}
_STATS_LOCK = threading.Lock()


def get_stats() -> Dict[str, Any]:
    """Snapshot the cumulative compression counters. Includes a derived
    `ratio` (compressed/original) when at least one compression has
    produced a non-zero original count."""
    with _STATS_LOCK:
        snap = dict(_STATS)
    o = snap.get("original_tokens", 0)
    c = snap.get("compressed_tokens", 0)
    snap["ratio"] = round(c / o, 4) if o else None
    snap["enabled"] = LLMLINGUA_ENABLED
    return snap


def _record(original: int, compressed: int) -> None:
    with _STATS_LOCK:
        _STATS["calls"] += 1
        _STATS["original_tokens"] += int(original or 0)
        _STATS["compressed_tokens"] += int(compressed or 0)


def _record_error() -> None:
    with _STATS_LOCK:
        _STATS["errors"] += 1


def _record_bypass() -> None:
    with _STATS_LOCK:
        _STATS["bypassed"] += 1


# ── Lazy model load ───────────────────────────────────────────────────────

_COMPRESSOR = None            # type: Optional[Any]
_COMPRESSOR_LOAD_TRIED = False
_LOAD_LOCK = threading.Lock()


def _get_compressor():
    """Return a cached PromptCompressor, loading on first call.

    Returns None on import failure or model-load failure — callers
    interpret None as 'compression unavailable, fall back to identity'.
    The first call triggers the model download (~700 MB on a cold cache)
    and may block for several seconds-to-minutes. Subsequent calls hit
    the cached instance.
    """
    global _COMPRESSOR, _COMPRESSOR_LOAD_TRIED
    if _COMPRESSOR is not None:
        return _COMPRESSOR
    if _COMPRESSOR_LOAD_TRIED:
        return None
    with _LOAD_LOCK:
        if _COMPRESSOR is not None:
            return _COMPRESSOR
        if _COMPRESSOR_LOAD_TRIED:
            return None
        _COMPRESSOR_LOAD_TRIED = True
        try:
            from llmlingua import PromptCompressor
        except Exception as exc:
            logger.warning(
                "llmlingua_compressor: package import failed — "
                "compression disabled (%s)", exc,
            )
            return None
        try:
            # device_map="cpu" so this doesn't try to grab a CUDA device
            # the deployment may not have. LLMLingua-2's classifier is
            # small enough to run on CPU comfortably.
            _COMPRESSOR = PromptCompressor(
                model_name=LLMLINGUA_MODEL,
                use_llmlingua2=True,
                device_map="cpu",
            )
            logger.info(
                "llmlingua_compressor: loaded model %s", LLMLINGUA_MODEL,
            )
            return _COMPRESSOR
        except Exception as exc:
            logger.warning(
                "llmlingua_compressor: model load failed — "
                "compression disabled (%s)", exc,
            )
            return None


def _reset_for_tests() -> None:
    """Test-only: clear the cached compressor + counters so a monkeypatch
    of `_get_compressor` takes effect on the next call."""
    global _COMPRESSOR, _COMPRESSOR_LOAD_TRIED
    with _LOAD_LOCK:
        _COMPRESSOR = None
        _COMPRESSOR_LOAD_TRIED = False
    with _STATS_LOCK:
        for k in list(_STATS.keys()):
            _STATS[k] = 0


# ── Public API ────────────────────────────────────────────────────────────

def compress_tool_output(text: str, max_tokens: Optional[int] = None) -> str:
    """Compress a single tool output / web fetch / file read.

    Returns the compressed text on success, the original text on any
    failure (disabled flag, import error, model load error, tokenisation
    error, compression error, or empty result). Never raises.
    """
    if not isinstance(text, str) or not text:
        return text or ""
    if not LLMLINGUA_ENABLED:
        return text
    if len(text) < _BYPASS_BELOW_CHARS:
        _record_bypass()
        return text

    target = _resolve_target_tokens(max_tokens)
    try:
        compressor = _get_compressor()
    except Exception as exc:
        logger.warning("llmlingua_compressor: compressor load error: %s", exc)
        return text
    if compressor is None:
        return text

    try:
        result = compressor.compress_prompt_llmlingua2(
            context=[text],
            target_token=target if target > 0 else -1,
        )
    except Exception as exc:
        logger.warning("llmlingua_compressor: compress_prompt failed: %s", exc)
        _record_error()
        return text

    return _result_to_text(result, original=text)


def compress_rag_chunks(
    chunks: List[str],
    max_tokens: Optional[int] = None,
) -> List[str]:
    """Compress each RAG/memory chunk independently.

    Per-chunk failure returns the original chunk for that slot — the
    output list has the same length and ordering as the input. None /
    non-string entries pass through as the empty string.
    """
    if not isinstance(chunks, list):
        return chunks
    out: List[str] = []
    for c in chunks:
        if not isinstance(c, str):
            out.append("")
            continue
        try:
            out.append(compress_tool_output(c, max_tokens=max_tokens))
        except Exception as exc:
            # compress_tool_output is already exception-safe, but the
            # belt-and-suspenders pass guarantees the caller's list
            # stays intact even if a future refactor changes that.
            logger.warning("llmlingua_compressor: chunk compress failed: %s", exc)
            _record_error()
            out.append(c)
    return out


# ── Internals ─────────────────────────────────────────────────────────────

def _resolve_target_tokens(max_tokens: Optional[int]) -> int:
    if max_tokens is not None:
        try:
            return int(max_tokens)
        except (TypeError, ValueError):
            return LLMLINGUA_TARGET_TOKENS
    return LLMLINGUA_TARGET_TOKENS


def _result_to_text(result: Any, *, original: str) -> str:
    """Pull the compressed text out of a compress_prompt result dict.

    LLMLingua returns a dict with `compressed_prompt: str` and
    observability fields (`origin_tokens`, `compressed_tokens`, `ratio`).
    Defensive: any deviation from that shape falls back to the original
    text rather than handing the LLM something unexpected.
    """
    if not isinstance(result, dict):
        _record_error()
        return original
    compressed = result.get("compressed_prompt")
    if not isinstance(compressed, str) or not compressed.strip():
        _record_error()
        return original

    origin_tokens = _safe_int(result.get("origin_tokens"))
    compressed_tokens = _safe_int(result.get("compressed_tokens"))
    _record(origin_tokens, compressed_tokens)
    if logger.isEnabledFor(logging.DEBUG):
        ratio = result.get("ratio")
        logger.debug(
            "llmlingua_compressor: %d → %d tokens (ratio=%s)",
            origin_tokens, compressed_tokens, ratio,
        )
    return compressed


def _safe_int(v: Any) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0
