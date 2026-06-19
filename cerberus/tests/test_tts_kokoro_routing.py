"""Tests for Kokoro TTS routing fixes. Mocks _KokoroPipeline — no real inference.

All tests run in the fast lane (no 'slow' marker needed; unmarked = fast).
"""

import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch, call

# ---------------------------------------------------------------------------
# Stub heavy optional deps before loading tts_service
# ---------------------------------------------------------------------------

for _mod in ["torch", "kokoro", "soundfile", "httpx"]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

# src.settings is imported lazily inside _load_settings; stub it module-level
# so we can control load_settings() return value in each test.
if "src.settings" not in sys.modules:
    sys.modules["src.settings"] = MagicMock()

from services.tts.tts_service import TTSService, KOKORO_VOICES, get_tts_service
import services.tts.tts_service as _tts_mod


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_service(kokoro_available: bool = True):
    """Return a TTSService with a pre-initialized mock Kokoro pipeline."""
    svc = TTSService.__new__(TTSService)
    svc.cache_dir = Path(tempfile.mkdtemp())
    mock_kokoro = MagicMock()
    mock_kokoro.available = kokoro_available
    mock_kokoro._use_cuda = False
    mock_kokoro.synthesize_raw = MagicMock(return_value=b"\x00\x01FAKEAUDIO")
    svc._kokoro = mock_kokoro
    return svc, mock_kokoro


def _patch_load_settings(settings_dict: dict):
    """Patch src.settings.load_settings to return settings_dict."""
    return patch.object(sys.modules["src.settings"], "load_settings", return_value=settings_dict)


# ---------------------------------------------------------------------------
# Bug 1: default provider auto-detection
# ---------------------------------------------------------------------------

def test_default_provider_is_local_when_kokoro_available():
    """If tts_provider absent from settings and Kokoro is available, default to 'local'."""
    svc, _ = _make_service(kokoro_available=True)
    with _patch_load_settings({}):
        settings = svc._load_settings()
    assert settings["tts_provider"] == "local"


def test_default_provider_is_disabled_when_kokoro_unavailable():
    """If tts_provider absent from settings and Kokoro is unavailable, default to 'disabled'."""
    svc, _ = _make_service(kokoro_available=False)
    with _patch_load_settings({}):
        settings = svc._load_settings()
    assert settings["tts_provider"] == "disabled"


def test_explicit_provider_in_settings_wins_over_autodetect():
    """Explicit tts_provider in settings.json always wins — autodetect is only the fallback."""
    svc, _ = _make_service(kokoro_available=True)
    for explicit in ("browser", "disabled", "endpoint:abc"):
        with _patch_load_settings({"tts_provider": explicit}):
            settings = svc._load_settings()
        assert settings["tts_provider"] == explicit, (
            f"Expected {explicit!r}, got {settings['tts_provider']!r}"
        )


# ---------------------------------------------------------------------------
# Bug 1: synthesize routes to Kokoro when provider = 'local'
# ---------------------------------------------------------------------------

def test_synthesize_routes_to_kokoro_for_local_provider():
    svc, mock_kokoro = _make_service(kokoro_available=True)
    with patch.object(svc, "_load_settings", return_value={
        "tts_enabled": True,
        "tts_provider": "local",
        "tts_model": "tts-1",
        "tts_voice": "af_bella",
        "tts_speed": "1",
    }):
        result = svc.synthesize("hello world", use_cache=False)
    mock_kokoro.synthesize_raw.assert_called_once_with("hello world", "af_bella")
    assert result == b"\x00\x01FAKEAUDIO"


def test_synthesize_returns_none_when_provider_disabled():
    svc, _ = _make_service()
    with patch.object(svc, "_load_settings", return_value={
        "tts_enabled": True, "tts_provider": "disabled",
        "tts_model": "tts-1", "tts_voice": "af_bella", "tts_speed": "1",
    }):
        assert svc.synthesize("hello", use_cache=False) is None


def test_synthesize_returns_none_when_tts_globally_disabled():
    """tts_enabled=False short-circuits regardless of provider."""
    svc, _ = _make_service()
    with patch.object(svc, "_load_settings", return_value={
        "tts_enabled": False, "tts_provider": "local",
        "tts_model": "tts-1", "tts_voice": "af_bella", "tts_speed": "1",
    }):
        assert svc.synthesize("hello", use_cache=False) is None


# ---------------------------------------------------------------------------
# Bug 1: startup log
# ---------------------------------------------------------------------------

def test_startup_log_shows_ready_when_kokoro_available():
    """get_tts_service logs 'Kokoro TTS ready' on first initialisation."""
    saved = _tts_mod._tts_service
    _tts_mod._tts_service = None
    try:
        mock_kokoro = MagicMock(available=True, _use_cuda=False)
        with patch.object(TTSService, "_get_kokoro", return_value=mock_kokoro), \
             patch.object(TTSService, "_load_settings", return_value={
                 "tts_enabled": True, "tts_provider": "local",
                 "tts_model": "tts-1", "tts_voice": "af_heart", "tts_speed": "1",
             }), \
             patch("services.tts.tts_service.logger") as mock_log:
            get_tts_service()
        messages = " ".join(str(c) for c in mock_log.info.call_args_list)
        assert "Kokoro TTS ready" in messages
    finally:
        _tts_mod._tts_service = saved


def test_startup_log_shows_unavailable_when_kokoro_missing():
    """get_tts_service logs 'not available' when Kokoro package is absent."""
    saved = _tts_mod._tts_service
    _tts_mod._tts_service = None
    try:
        mock_kokoro = MagicMock(available=False)
        with patch.object(TTSService, "_get_kokoro", return_value=mock_kokoro), \
             patch.object(TTSService, "_load_settings", return_value={
                 "tts_enabled": True, "tts_provider": "disabled",
                 "tts_model": "tts-1", "tts_voice": "af_heart", "tts_speed": "1",
             }), \
             patch("services.tts.tts_service.logger") as mock_log:
            get_tts_service()
        messages = " ".join(str(c) for c in mock_log.info.call_args_list)
        assert "not available" in messages
    finally:
        _tts_mod._tts_service = saved


# ---------------------------------------------------------------------------
# Bug 2: Kokoro voice prefix detection (via KOKORO_VOICES canonical list)
# ---------------------------------------------------------------------------

def test_all_kokoro_voices_match_known_prefixes():
    """Every voice in KOKORO_VOICES has a known prefix (af_, am_, bf_, bm_)."""
    known_prefixes = ("af_", "am_", "bf_", "bm_")
    for v in KOKORO_VOICES:
        vid = v["id"]
        assert any(vid.startswith(p) for p in known_prefixes), (
            f"Kokoro voice {vid!r} not matched by known prefix list — update _KOKORO_PREFIXES in JS"
        )


def test_non_kokoro_voice_ids_do_not_match_known_prefixes():
    """Browser/OpenAI voice IDs don't accidentally match the Kokoro prefix list."""
    non_kokoro = ["alloy", "nova", "echo", "shimmer", "Google UK English Male", "Alex", "Samantha"]
    known_prefixes = ("af_", "am_", "bf_", "bm_")
    for vid in non_kokoro:
        assert not any(vid.startswith(p) for p in known_prefixes), (
            f"Non-Kokoro voice {vid!r} wrongly matched by prefix list"
        )
