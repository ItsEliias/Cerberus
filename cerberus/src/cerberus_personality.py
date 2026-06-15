"""Cerberus OS — dynamic assistant personality and addressing."""

from __future__ import annotations

import random
from typing import Any, Dict, List, Optional

from src.cerberus_user_settings import load_user_settings

# Reserved for future assistants without backend churn.
ASSISTANT_PROFILES: Dict[str, Dict[str, Any]] = {
    "Cerberus": {"id": "Cerberus", "tone": "professional", "default_gender": "male"},
    "Cerberus": {"id": "Cerberus", "tone": "conversational", "default_gender": "female"},
    "Athena": {"id": "Athena", "tone": "professional", "reserved": True},
    "Oracle": {"id": "Oracle", "tone": "executive", "reserved": True},
    "Sentinel": {"id": "Sentinel", "tone": "minimal", "reserved": True},
    "Nova": {"id": "Nova", "tone": "friendly", "reserved": True},
}

_VALID_ADDRESS = {"sir", "boss", "ma'am", "maam", "none", ""}


def _pick(options: List[str]) -> str:
    return random.choice(options) if options else ""


def _normalize_address(raw: Optional[str]) -> str:
    val = (raw or "sir").strip().lower()
    if val in ("maam", "madam"):
        return "ma'am"
    if val in ("none", ""):
        return ""
    if val in ("sir", "boss", "ma'am"):
        return val
    return "sir"


def get_profile(settings: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    s = settings or load_user_settings()
    identity = s.get("assistant_identity") or "Cerberus"
    base = dict(ASSISTANT_PROFILES.get(identity, ASSISTANT_PROFILES["Cerberus"]))
    base["identity"] = identity
    base["preferred_address"] = _normalize_address(
        s.get("preferred_address") or s.get("address_style")
    )
    base["response_style"] = s.get("response_style") or "professional"
    return base


def get_address(settings: Optional[Dict[str, Any]] = None) -> str:
    return get_profile(settings)["preferred_address"]


def _append_address(text: str, settings: Optional[Dict[str, Any]] = None) -> str:
    addr = get_address(settings)
    if not addr:
        return text if text.endswith((".", "!", "?")) else f"{text}."
    clean = text.rstrip(".!?")
    return f"{clean}, {addr}."


def get_greeting(settings: Optional[Dict[str, Any]] = None) -> str:
    profile = get_profile(settings)
    identity = profile["identity"]
    addr = profile["preferred_address"]
    style = profile["response_style"]

    if identity == "Cerberus":
        options = {
            "professional": ["Online.", "Ready when you are.", "I'm here."],
            "friendly": ["Hey — I'm here.", "Ready when you are.", "Online."],
            "executive": ["Ready.", "Online.", "Standing by."],
            "minimal": ["Ready.", "Online."],
        }
        return _pick(options.get(style, options["professional"]))

    if addr == "boss":
        return _pick(["Online boss.", "Yes boss.", "Standing by boss."])
    if addr == "ma'am":
        return _pick(["Online ma'am.", "Yes ma'am.", "Standing by ma'am."])
    if addr == "sir":
        return _pick(["Online sir.", "Yes sir.", "Standing by sir."])
    return _pick(["Online.", "Ready.", "Standing by."])


def get_standby(settings: Optional[Dict[str, Any]] = None) -> str:
    profile = get_profile(settings)
    if profile["identity"] == "Cerberus":
        return _pick(["Standing by.", "I'll be here.", "On standby."])
    return _append_address("Standing by", settings)


def get_completion(settings: Optional[Dict[str, Any]] = None) -> str:
    profile = get_profile(settings)
    if profile["identity"] == "Cerberus":
        return _pick(["All set.", "Done.", "Finished.", "Everything is ready."])
    return _append_address(_pick(["Done", "Completed", "Research complete"]), settings)


def get_confirmation(action: str, settings: Optional[Dict[str, Any]] = None) -> str:
    text = (action or "").strip().rstrip(".")
    if not text:
        return get_completion(settings)
    profile = get_profile(settings)
    if profile["identity"] == "Cerberus":
        return f"{text}."
    return _append_address(text, settings)


def get_error(message: str, settings: Optional[Dict[str, Any]] = None) -> str:
    msg = (message or "Something went wrong").strip().rstrip(".")
    profile = get_profile(settings)
    if profile["identity"] == "Cerberus":
        return f"Sorry — {msg.lower()}." if not msg.lower().startswith("sorry") else f"{msg}."
    if not get_address(settings):
        return f"Sorry, {msg.lower()}."
    return _append_address(f"Sorry, {msg}", settings)


def get_prompt_address(settings: Optional[Dict[str, Any]] = None) -> str:
    addr = get_address(settings)
    return addr or "the user respectfully"
