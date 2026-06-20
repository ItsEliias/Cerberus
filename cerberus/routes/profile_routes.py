"""User profile + onboarding API.

Per-user operator profile and onboarding state. Storage uses the existing
per-user prefs store (data/user_prefs.json via routes.prefs_routes) rather
than the global settings.json because the profile data is per-owner — name,
role, avatar, etc. all vary per user.

Endpoints (all auth-gated via require_user):
  GET    /api/profile                    — flat dict of user_profile.* values
  PATCH  /api/profile                    — partial update, validates fields
  POST   /api/profile/avatar             — multipart image upload, max 2 MiB
  GET    /api/profile/onboarding-status  — {onboarded, profile}

After every successful profile save (PATCH + onboarding completion), an
`operator_profile` memory entry is upserted so any agent reading memory
knows who they're talking to.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from src.auth_helpers import require_user
from src.constants import DATA_DIR

logger = logging.getLogger(__name__)


# ── Constants ────────────────────────────────────────────────────────────────

_PROFILE_PREFIX = "user_profile."
_PROFILE_KEYS = (
    "display_name",
    "role",
    "bio",
    "location",
    "interests",
    "avatar_url",
    "onboarded",
)

_BIO_MAX = 280
_INTERESTS_MAX_ITEMS = 20
_INTEREST_MAX_LEN = 50

AVATAR_MAX_BYTES = 2 * 1024 * 1024  # 2 MiB
_AVATAR_MIME_TO_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
}
AVATARS_DIR = os.path.join(DATA_DIR, "avatars")


def _profile_defaults() -> Dict[str, Any]:
    return {
        "display_name": "",
        "role": "",
        "bio": "",
        "location": "",
        "interests": [],
        "avatar_url": "",
        "onboarded": False,
    }


# ── Storage (per-user prefs) ────────────────────────────────────────────────

def _load_profile(user: Optional[str]) -> Dict[str, Any]:
    """Return the user's profile merged over defaults — never missing a key."""
    from routes.prefs_routes import _load_for_user
    prefs = _load_for_user(user) or {}
    profile = _profile_defaults()
    for key in _PROFILE_KEYS:
        ns_key = _PROFILE_PREFIX + key
        if ns_key in prefs:
            profile[key] = prefs[ns_key]
    # `interests` may legitimately be persisted as JSON-encoded string
    # (defensive — older builds did so). Always surface as a list.
    if isinstance(profile["interests"], str):
        try:
            parsed = json.loads(profile["interests"])
            profile["interests"] = parsed if isinstance(parsed, list) else []
        except (json.JSONDecodeError, TypeError):
            profile["interests"] = []
    return profile


def _save_profile_keys(user: Optional[str], updates: Dict[str, Any]) -> None:
    """Merge namespaced updates into the per-user prefs store."""
    from routes.prefs_routes import _load_for_user, _save_for_user
    prefs = _load_for_user(user) or {}
    for key, value in updates.items():
        prefs[_PROFILE_PREFIX + key] = value
    _save_for_user(user, prefs)


# ── Validation ───────────────────────────────────────────────────────────────

class ProfilePatch(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=128)
    role:         Optional[str] = Field(default=None, max_length=128)
    bio:          Optional[str] = Field(default=None)
    location:     Optional[str] = Field(default=None, max_length=128)
    interests:    Optional[List[str]] = None
    avatar_url:   Optional[str] = Field(default=None, max_length=512)
    onboarded:    Optional[bool] = None


def _validate_patch(body: ProfilePatch) -> Dict[str, Any]:
    """Coerce body → dict of fields the caller actually sent. Raises 400."""
    updates: Dict[str, Any] = {}
    raw = body.model_dump(exclude_unset=True)

    if "bio" in raw:
        bio = (raw["bio"] or "").strip()
        if len(bio) > _BIO_MAX:
            raise HTTPException(400, f"bio exceeds {_BIO_MAX}-character limit")
        updates["bio"] = bio

    if "interests" in raw:
        interests = raw["interests"] or []
        if not isinstance(interests, list):
            raise HTTPException(400, "interests must be an array of strings")
        if len(interests) > _INTERESTS_MAX_ITEMS:
            raise HTTPException(
                400,
                f"interests exceeds {_INTERESTS_MAX_ITEMS}-item limit",
            )
        cleaned: List[str] = []
        for item in interests:
            if not isinstance(item, str):
                raise HTTPException(400, "interests entries must be strings")
            trimmed = item.strip()
            if not trimmed:
                continue
            if len(trimmed) > _INTEREST_MAX_LEN:
                raise HTTPException(
                    400,
                    f"interest '{trimmed[:20]}…' exceeds "
                    f"{_INTEREST_MAX_LEN}-character limit",
                )
            cleaned.append(trimmed)
        updates["interests"] = cleaned

    for key in ("display_name", "role", "location", "avatar_url"):
        if key in raw:
            value = raw[key]
            updates[key] = (value or "").strip() if isinstance(value, str) else value

    if "onboarded" in raw:
        updates["onboarded"] = bool(raw["onboarded"])

    return updates


# ── Profile → memory sync ────────────────────────────────────────────────────

_PROFILE_MEMORY_CATEGORY = "operator_profile"


def _format_memory_text(profile: Dict[str, Any]) -> str:
    """Render the profile as a single line for agent memory."""
    name = (profile.get("display_name") or "").strip() or "Operator"
    parts = [f"Operator: {name}."]
    role = (profile.get("role") or "").strip()
    if role:
        parts.append(f"Role: {role}.")
    location = (profile.get("location") or "").strip()
    if location:
        parts.append(f"Location: {location}.")
    interests = profile.get("interests") or []
    if interests:
        parts.append(f"Interests: {', '.join(interests)}.")
    bio = (profile.get("bio") or "").strip()
    if bio:
        parts.append(f"Bio: {bio}")
    return " ".join(parts).strip()


def _sync_profile_memory(user: Optional[str], profile: Dict[str, Any]) -> None:
    """Upsert the `operator_profile` memory entry for this user.

    Best-effort: a failure here MUST NOT block the profile save itself —
    every exception is logged at WARNING and swallowed. The memory is purely
    a convenience so agents can read who they're working with."""
    text = _format_memory_text(profile)
    if not text or text == "Operator:.":
        return
    try:
        from src.memory import MemoryManager
        mm = MemoryManager(DATA_DIR)
        existing = mm.load(owner=user) or []
        # Delete prior operator_profile entries (if any) before writing the
        # new one so a single owner never accumulates duplicates.
        all_mem = mm.load_all()
        kept = [
            m for m in all_mem
            if not (
                m.get("owner") == user
                and (
                    m.get("category") == _PROFILE_MEMORY_CATEGORY
                    or _PROFILE_MEMORY_CATEGORY in (m.get("categories") or [])
                )
            )
        ]
        entry = mm.add_entry(
            text, source="profile", category=_PROFILE_MEMORY_CATEGORY, owner=user,
        )
        kept.append(entry)
        mm.save(kept)
        _ = existing  # kept reference to keep linter quiet; loaded for parity
    except Exception as exc:
        logger.warning("operator_profile memory upsert failed: %s", exc)


# ── Avatar helpers ───────────────────────────────────────────────────────────

def _owner_slug(user: Optional[str]) -> str:
    """Filesystem-safe slug for the avatar filename. `_default` if no owner."""
    import re
    slug = re.sub(r"[^a-z0-9_-]+", "-", (user or "_default").lower()).strip("-")
    return slug or "_default"


def _purge_old_avatar(slug: str) -> None:
    """Remove any prior avatar file for this owner so each user keeps at most
    one avatar on disk (the spec stores `{owner}.{ext}`, so a JPG → PNG swap
    would otherwise leave the JPG orphaned)."""
    if not os.path.isdir(AVATARS_DIR):
        return
    try:
        for fname in os.listdir(AVATARS_DIR):
            base, _, _ = fname.rpartition(".")
            if base == slug:
                try:
                    os.remove(os.path.join(AVATARS_DIR, fname))
                except OSError:
                    pass
    except OSError:
        pass


# ── Router ───────────────────────────────────────────────────────────────────

def setup_profile_routes() -> APIRouter:
    router = APIRouter(prefix="/api/profile", tags=["profile"])

    @router.get("")
    def get_profile(request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        return _load_profile(owner)

    @router.patch("")
    def patch_profile(request: Request, body: ProfilePatch) -> Dict[str, Any]:
        owner = require_user(request)
        updates = _validate_patch(body)
        if updates:
            _save_profile_keys(owner, updates)
        profile = _load_profile(owner)
        # Sync to memory ONLY for substantive profile edits — flipping the
        # onboarded flag alone shouldn't trigger a fresh memory write.
        if any(k != "onboarded" for k in updates):
            _sync_profile_memory(owner, profile)
        return profile

    @router.post("/avatar")
    async def upload_avatar(
        request: Request, file: UploadFile = File(...),
    ) -> Dict[str, Any]:
        owner = require_user(request)
        mime = (file.content_type or "").lower()
        ext = _AVATAR_MIME_TO_EXT.get(mime)
        if not ext:
            raise HTTPException(
                400,
                "Unsupported image type — use PNG, JPEG, GIF, or WebP",
            )

        data = await file.read()
        if len(data) > AVATAR_MAX_BYTES:
            raise HTTPException(400, "Avatar exceeds 2 MiB limit")
        if not data:
            raise HTTPException(400, "Avatar file is empty")

        os.makedirs(AVATARS_DIR, exist_ok=True)
        slug = _owner_slug(owner)
        _purge_old_avatar(slug)
        path = os.path.join(AVATARS_DIR, f"{slug}.{ext}")
        with open(path, "wb") as f:
            f.write(data)

        avatar_url = f"/static/avatars/{slug}.{ext}"
        _save_profile_keys(owner, {"avatar_url": avatar_url})
        return {"avatar_url": avatar_url}

    @router.get("/onboarding-status")
    def onboarding_status(request: Request) -> Dict[str, Any]:
        owner = require_user(request)
        profile = _load_profile(owner)
        return {"onboarded": bool(profile.get("onboarded")), "profile": profile}

    return router
