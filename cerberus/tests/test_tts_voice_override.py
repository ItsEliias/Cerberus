"""Tests for Kokoro voice override — synthesize(voice=...) and /api/tts/voices endpoint."""

import sys
import base64
from unittest.mock import MagicMock, patch

for _mod in [
    "sqlalchemy", "sqlalchemy.orm", "sqlalchemy.ext", "sqlalchemy.ext.declarative",
    "sqlalchemy.ext.hybrid", "sqlalchemy.sql", "sqlalchemy.sql.expression",
    "src.auth_helpers", "src.upload_limits",
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_tts_service(provider="local", voice="af_heart"):
    from services.tts.tts_service import TTSService
    svc = TTSService.__new__(TTSService)
    svc._load_settings = lambda: {
        "tts_provider":  provider,
        "tts_enabled":   True,
        "tts_model":     "tts-1",
        "tts_voice":     voice,
        "tts_speed":     "1",
    }
    svc.cache_dir = MagicMock()
    svc.cache_dir.glob.return_value = []
    svc._kokoro = None
    return svc


# ---------------------------------------------------------------------------
# KOKORO_VOICES constant
# ---------------------------------------------------------------------------

def test_kokoro_voices_constant_present():
    from services.tts.tts_service import KOKORO_VOICES
    assert isinstance(KOKORO_VOICES, list)
    assert len(KOKORO_VOICES) >= 11


def test_kokoro_voices_have_required_fields():
    from services.tts.tts_service import KOKORO_VOICES
    for v in KOKORO_VOICES:
        assert "id" in v
        assert "name" in v
        assert "lang" in v
        assert "gender" in v


def test_kokoro_voices_include_af_heart():
    from services.tts.tts_service import KOKORO_VOICES
    ids = [v["id"] for v in KOKORO_VOICES]
    assert "af_heart" in ids


# ---------------------------------------------------------------------------
# list_voices()
# ---------------------------------------------------------------------------

def test_list_voices_returns_kokoro_list():
    svc = _make_tts_service()
    voices = svc.list_voices()
    assert isinstance(voices, list)
    assert len(voices) >= 11
    assert any(v["id"] == "af_heart" for v in voices)


def test_list_voices_returns_copy():
    svc = _make_tts_service()
    v1 = svc.list_voices()
    v2 = svc.list_voices()
    assert v1 is not v2     # new list each call; mutation-safe


# ---------------------------------------------------------------------------
# synthesize() voice override
# ---------------------------------------------------------------------------

def test_synthesize_passes_voice_override_to_kokoro():
    """synthesize(voice='am_adam') must call kokoro.synthesize_raw with voice='am_adam'."""
    svc = _make_tts_service(provider="local", voice="af_heart")
    mock_kokoro = MagicMock()
    mock_kokoro.available = True
    mock_kokoro.synthesize_raw.return_value = b"RIFF\x24\x00\x00\x00WAVEfmt "
    svc._kokoro = mock_kokoro
    # Disable cache so we hit kokoro on every call
    svc._get_cached = lambda key: None
    svc._put_cache  = lambda key, data: None

    svc.synthesize("hello", use_cache=False, voice="am_adam")

    mock_kokoro.synthesize_raw.assert_called_once_with("hello", "am_adam")


def test_synthesize_falls_back_to_settings_voice_when_no_override():
    svc = _make_tts_service(provider="local", voice="af_bella")
    mock_kokoro = MagicMock()
    mock_kokoro.available = True
    mock_kokoro.synthesize_raw.return_value = b"RIFF\x24\x00\x00\x00WAVEfmt "
    svc._kokoro = mock_kokoro
    svc._get_cached = lambda key: None
    svc._put_cache  = lambda key, data: None

    svc.synthesize("hi", use_cache=False)

    mock_kokoro.synthesize_raw.assert_called_once_with("hi", "af_bella")


def test_synthesize_voice_override_empty_string_uses_settings():
    """Empty string voice should not override — fall back to settings voice."""
    svc = _make_tts_service(provider="local", voice="af_sarah")
    mock_kokoro = MagicMock()
    mock_kokoro.available = True
    mock_kokoro.synthesize_raw.return_value = b"RIFF\x24\x00\x00\x00WAVEfmt "
    svc._kokoro = mock_kokoro
    svc._get_cached = lambda key: None
    svc._put_cache  = lambda key, data: None

    svc.synthesize("test", use_cache=False, voice="")

    mock_kokoro.synthesize_raw.assert_called_once_with("test", "af_sarah")


# ---------------------------------------------------------------------------
# synthesize_to_base64() voice override
# ---------------------------------------------------------------------------

def test_synthesize_to_base64_passes_voice_override():
    svc = _make_tts_service(provider="local", voice="af_heart")
    raw = b"RIFF\x24\x00\x00\x00WAVEfmt "
    mock_kokoro = MagicMock()
    mock_kokoro.available = True
    mock_kokoro.synthesize_raw.return_value = raw
    svc._kokoro = mock_kokoro
    svc._get_cached = lambda key: None
    svc._put_cache  = lambda key, data: None

    result = svc.synthesize_to_base64("hey", voice="bm_george")

    mock_kokoro.synthesize_raw.assert_called_once_with("hey", "bm_george")
    assert result == base64.b64encode(raw).decode()


# ---------------------------------------------------------------------------
# /api/tts/voices route
# ---------------------------------------------------------------------------

def test_voices_route_registered():
    from routes.tts_routes import setup_tts_routes
    router = setup_tts_routes(MagicMock())
    paths = [r.path for r in router.routes]
    assert "/api/tts/voices" in paths


def test_voices_route_method_is_get():
    from routes.tts_routes import setup_tts_routes
    router = setup_tts_routes(MagicMock())
    methods = {r.path: list(getattr(r, "methods", [])) for r in router.routes}
    assert "GET" in methods.get("/api/tts/voices", [])


# ---------------------------------------------------------------------------
# TTSRequest accepts optional voice field
# ---------------------------------------------------------------------------

def test_tts_request_accepts_voice():
    from routes.tts_routes import TTSRequest
    req = TTSRequest(text="hello", format="base64", voice="af_nicole")
    assert req.voice == "af_nicole"


def test_tts_request_voice_defaults_none():
    from routes.tts_routes import TTSRequest
    req = TTSRequest(text="hello")
    assert req.voice is None


# ---------------------------------------------------------------------------
# _KokoroPipeline CPU fallback
# ---------------------------------------------------------------------------

def test_kokoro_pipeline_skips_cuda_context_on_cpu():
    """_KokoroPipeline._use_cuda must be False when initialized on CPU."""
    try:
        import torch
        import numpy as np
        from services.tts.tts_service import _KokoroPipeline
    except ImportError:
        return  # deps absent in test env — skip

    with patch("torch.cuda.is_available", return_value=False), \
         patch("kokoro.KPipeline") as mock_pipe:
        mock_model = MagicMock()
        mock_pipe.return_value.model = mock_model
        pipeline = _KokoroPipeline()
        if pipeline.available:
            assert pipeline._use_cuda is False
            assert pipeline.device == torch.device("cpu")
