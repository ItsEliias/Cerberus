"""Cerberus OS user profile + theme settings."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

from src.cerberus_config import data_dir

_DEFAULTS: Dict[str, Any] = {
    "assistant_identity": "Cerberus",
    "voice_gender": "male",
    "preferred_voice": "Google UK English Male",
    "preferred_address": "sir",
    "address_style": "sir",
    "theme": "default-blue",
    "speech_rate": 1.0,
    "response_style": "professional",
}

_VALID_THEMES = {"default-blue", "matrix-green", "purple", "red-gold", "pink"}
_VALID_ADDRESS = {"sir", "boss", "ma'am", "maam", "none", ""}
_VALID_RESPONSE = {"professional", "friendly", "executive", "minimal"}


def _path() -> Path:
    return data_dir() / "user_settings.json"


def _normalize(data: Dict[str, Any]) -> Dict[str, Any]:
    out = {**_DEFAULTS, **(data or {})}
    addr = (out.get("preferred_address") or out.get("address_style") or "sir").strip().lower()
    if addr in ("maam", "madam"):
        addr = "ma'am"
    if addr not in ("sir", "boss", "ma'am", "none", ""):
        addr = "sir"
    if addr == "none":
        addr = ""
    out["preferred_address"] = addr
    out["address_style"] = addr or "sir"
    if out.get("theme") not in _VALID_THEMES:
        out["theme"] = "default-blue"
    if out.get("response_style") not in _VALID_RESPONSE:
        out["response_style"] = "professional"
    try:
        rate = float(out.get("speech_rate", 1.0))
        out["speech_rate"] = max(0.5, min(2.0, rate))
    except (TypeError, ValueError):
        out["speech_rate"] = 1.0
    return out


def load_user_settings() -> Dict[str, Any]:
    path = _path()
    if not path.exists():
        return save_user_settings(dict(_DEFAULTS))
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return _normalize(data)
    except (json.JSONDecodeError, OSError):
        pass
    return dict(_DEFAULTS)


def save_user_settings(data: Dict[str, Any]) -> Dict[str, Any]:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    out = _normalize(data)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    return out


def patch_user_settings(updates: Dict[str, Any]) -> Dict[str, Any]:
    data = load_user_settings()
    for key, val in (updates or {}).items():
        if val is None:
            continue
        if key in _DEFAULTS or key in ("preferred_address", "address_style"):
            data[key] = val
    if "preferred_address" in updates and updates["preferred_address"] is not None:
        data["address_style"] = data.get("preferred_address") or "sir"
    if "address_style" in updates and updates["address_style"] is not None:
        data["preferred_address"] = updates["address_style"]
    identity = data.get("assistant_identity")
    if identity == "Cerberus":
        if updates.get("voice_gender") is None and data.get("preferred_voice") == _DEFAULTS["preferred_voice"]:
            data["voice_gender"] = "female"
            data["preferred_voice"] = "Google UK English Female"
    elif identity == "Cerberus":
        if updates.get("assistant_identity") == "Cerberus" or updates.get("voice_gender") == "male":
            if "preferred_voice" not in updates and data.get("voice_gender") == "male":
                if data.get("preferred_voice") == "Google UK English Female":
                    data["preferred_voice"] = "Google UK English Male"
    return save_user_settings(data)
