"""Tests for the operator-profile + onboarding API."""

import io
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

for _mod in [
    "sqlalchemy", "sqlalchemy.orm", "sqlalchemy.ext", "sqlalchemy.ext.declarative",
    "sqlalchemy.ext.hybrid", "sqlalchemy.sql", "sqlalchemy.sql.expression",
    "src.auth_helpers",
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

import routes.profile_routes as pr
from routes.profile_routes import (
    AVATAR_MAX_BYTES, ProfilePatch, setup_profile_routes,
)

# Snapshot the real `_sync_profile_memory` so the test that exercises it
# directly (test_memory_sync_replaces_prior_entry) can side-step the autouse
# stub. Captured here because the stub is applied per-test.
_REAL_SYNC = pr._sync_profile_memory


# ─── Helpers ────────────────────────────────────────────────────────────────

def _endpoint(method: str, path: str):
    router = setup_profile_routes()
    for route in router.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set()):
            return route.endpoint
    raise RuntimeError(f"{method} {path} not found")


def _request(owner: str = "alice"):
    return SimpleNamespace(state=SimpleNamespace(current_user=owner))


@pytest.fixture(autouse=True)
def _in_memory_prefs(monkeypatch):
    """Replace the per-user prefs store with an in-memory dict so tests don't
    write to data/user_prefs.json or step on each other."""
    store: dict[str | None, dict] = {}

    def _load_for_user(user):
        return dict(store.get(user, {}))

    def _save_for_user(user, prefs):
        store[user] = dict(prefs)

    fake_prefs = MagicMock()
    fake_prefs._load_for_user = _load_for_user
    fake_prefs._save_for_user = _save_for_user
    monkeypatch.setitem(sys.modules, "routes.prefs_routes", fake_prefs)
    # Memory sync is exercised separately; default to a no-op so most cases
    # don't have to stub it.
    monkeypatch.setattr(pr, "_sync_profile_memory", lambda *_a, **_kw: None)
    return store


def _upload(content: bytes, content_type: str, filename: str = "avatar.png"):
    class _F:
        def __init__(self, data, ct):
            self._data = data
            self.content_type = ct
            self.filename = filename
        async def read(self):
            return self._data
    return _F(content, content_type)


# ─── 1. GET /api/profile returns all keys with defaults ─────────────────────

def test_get_profile_returns_all_keys_with_defaults():
    fn = _endpoint("GET", "/api/profile")
    with patch("routes.profile_routes.require_user", return_value="alice"):
        resp = fn(_request("alice"))
    expected = {"display_name", "role", "bio", "location", "interests",
                "avatar_url", "onboarded"}
    assert set(resp.keys()) == expected
    assert resp["onboarded"] is False
    assert resp["interests"] == []
    assert resp["display_name"] == ""


# ─── 2. PATCH updates display_name ──────────────────────────────────────────

def test_patch_updates_display_name():
    fn = _endpoint("PATCH", "/api/profile")
    body = ProfilePatch(display_name="Eliias")
    with patch("routes.profile_routes.require_user", return_value="alice"):
        resp = fn(_request("alice"), body)
    assert resp["display_name"] == "Eliias"
    # Re-read should round-trip the change.
    with patch("routes.profile_routes.require_user", return_value="alice"):
        again = _endpoint("GET", "/api/profile")(_request("alice"))
    assert again["display_name"] == "Eliias"


# ─── 3. bio > 280 chars returns 400 ─────────────────────────────────────────

def test_patch_bio_over_280_chars_returns_400():
    fn = _endpoint("PATCH", "/api/profile")
    body = ProfilePatch(bio="x" * 281)
    with patch("routes.profile_routes.require_user", return_value="alice"):
        with pytest.raises(HTTPException) as exc:
            fn(_request("alice"), body)
    assert exc.value.status_code == 400
    assert "bio" in exc.value.detail.lower()


# ─── 4. interests > 20 returns 400 ──────────────────────────────────────────

def test_patch_interests_over_20_returns_400():
    fn = _endpoint("PATCH", "/api/profile")
    body = ProfilePatch(interests=[f"tag-{i}" for i in range(21)])
    with patch("routes.profile_routes.require_user", return_value="alice"):
        with pytest.raises(HTTPException) as exc:
            fn(_request("alice"), body)
    assert exc.value.status_code == 400
    assert "interests" in exc.value.detail.lower()


def test_patch_interest_over_50_chars_returns_400():
    fn = _endpoint("PATCH", "/api/profile")
    body = ProfilePatch(interests=["x" * 51])
    with patch("routes.profile_routes.require_user", return_value="alice"):
        with pytest.raises(HTTPException) as exc:
            fn(_request("alice"), body)
    assert exc.value.status_code == 400


# ─── 5. Avatar > 2 MiB rejected ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_avatar_oversize_returns_400(tmp_path, monkeypatch):
    monkeypatch.setattr(pr, "AVATARS_DIR", str(tmp_path))
    fn = _endpoint("POST", "/api/profile/avatar")
    big = b"\x89PNG\r\n\x1a\n" + b"x" * AVATAR_MAX_BYTES  # > 2 MiB
    with patch("routes.profile_routes.require_user", return_value="alice"):
        with pytest.raises(HTTPException) as exc:
            await fn(_request("alice"), file=_upload(big, "image/png"))
    assert exc.value.status_code == 400
    assert "2" in exc.value.detail  # mentions the size in the message


# ─── 6. Avatar non-image mime rejected ─────────────────────────────────────

@pytest.mark.asyncio
async def test_avatar_bad_mime_returns_400(tmp_path, monkeypatch):
    monkeypatch.setattr(pr, "AVATARS_DIR", str(tmp_path))
    fn = _endpoint("POST", "/api/profile/avatar")
    with patch("routes.profile_routes.require_user", return_value="alice"):
        with pytest.raises(HTTPException) as exc:
            await fn(_request("alice"), file=_upload(b"abc", "text/plain"))
    assert exc.value.status_code == 400
    assert "image" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_avatar_happy_path_writes_file_and_returns_url(tmp_path, monkeypatch):
    monkeypatch.setattr(pr, "AVATARS_DIR", str(tmp_path))
    fn = _endpoint("POST", "/api/profile/avatar")
    with patch("routes.profile_routes.require_user", return_value="alice"):
        resp = await fn(_request("alice"), file=_upload(b"PNGDATA", "image/png"))
    assert resp["avatar_url"].endswith(".png")
    # File hits disk under the owner slug.
    written = list(tmp_path.iterdir())
    assert len(written) == 1
    assert written[0].name.startswith("alice")
    assert written[0].name.endswith(".png")


# ─── 7. Onboarding-status returns false on a fresh install ─────────────────

def test_onboarding_status_false_by_default():
    fn = _endpoint("GET", "/api/profile/onboarding-status")
    with patch("routes.profile_routes.require_user", return_value="alice"):
        resp = fn(_request("alice"))
    assert resp == {"onboarded": False, "profile": pr._profile_defaults()}


# ─── 8. PATCH onboarded=true flips the flag ────────────────────────────────

def test_patch_marks_onboarded_true():
    fn = _endpoint("PATCH", "/api/profile")
    body = ProfilePatch(onboarded=True)
    with patch("routes.profile_routes.require_user", return_value="alice"):
        resp = fn(_request("alice"), body)
    assert resp["onboarded"] is True
    with patch("routes.profile_routes.require_user", return_value="alice"):
        status = _endpoint("GET", "/api/profile/onboarding-status")(_request("alice"))
    assert status["onboarded"] is True


# ─── 9. Memory entry created after profile save ────────────────────────────

def test_memory_sync_fires_on_substantive_save(monkeypatch):
    fn = _endpoint("PATCH", "/api/profile")
    calls = []
    monkeypatch.setattr(
        pr, "_sync_profile_memory",
        lambda user, profile: calls.append((user, dict(profile))),
    )
    with patch("routes.profile_routes.require_user", return_value="alice"):
        fn(_request("alice"), ProfilePatch(display_name="Eliias", role="Founder"))
    assert len(calls) == 1
    user, profile = calls[0]
    assert user == "alice"
    assert profile["display_name"] == "Eliias"
    assert profile["role"] == "Founder"


def test_memory_sync_skipped_for_onboarded_only(monkeypatch):
    """Flipping onboarded alone is not a profile change → no memory write."""
    fn = _endpoint("PATCH", "/api/profile")
    calls = []
    monkeypatch.setattr(
        pr, "_sync_profile_memory",
        lambda user, profile: calls.append((user, dict(profile))),
    )
    with patch("routes.profile_routes.require_user", return_value="alice"):
        fn(_request("alice"), ProfilePatch(onboarded=True))
    assert calls == []


# ─── 10. Memory entry upserted (not duplicated) on second save ─────────────

def test_memory_sync_replaces_prior_entry(monkeypatch):
    """A second `_sync_profile_memory` call must remove the previous
    operator_profile entry before adding the new one."""

    # Fake MemoryManager that records load/add/save calls.
    state = {"entries": [
        {"id": "old", "owner": "alice",
         "category": pr._PROFILE_MEMORY_CATEGORY, "text": "stale"},
        {"id": "other", "owner": "alice",
         "category": "fact", "text": "unrelated"},
    ]}

    class _MM:
        def __init__(self, _dir): pass
        def load(self, owner=None):
            return [e for e in state["entries"] if e.get("owner") == owner]
        def load_all(self):
            return list(state["entries"])
        def add_entry(self, text, source, category, owner):
            return {"id": "new", "owner": owner, "category": category,
                    "source": source, "text": text}
        def save(self, all_mem):
            state["entries"] = list(all_mem)

    fake_memory_mod = MagicMock()
    fake_memory_mod.MemoryManager = _MM
    monkeypatch.setitem(sys.modules, "src.memory", fake_memory_mod)
    # Autouse fixture stubs _sync_profile_memory — restore the real one for
    # this test which exercises the upsert behavior directly.
    monkeypatch.setattr(pr, "_sync_profile_memory", _REAL_SYNC)

    profile = {**pr._profile_defaults(), "display_name": "Eliias", "role": "Founder"}
    pr._sync_profile_memory("alice", profile)

    cats = [(e.get("owner"), e.get("category")) for e in state["entries"]]
    # The unrelated entry survives; the stale operator_profile is gone.
    assert ("alice", "fact") in cats
    # Exactly one operator_profile entry for this owner.
    assert sum(1 for c in cats if c == ("alice", pr._PROFILE_MEMORY_CATEGORY)) == 1
    # And it's the freshly-added one (text matches the formatted profile).
    fresh = next(
        e for e in state["entries"]
        if e.get("category") == pr._PROFILE_MEMORY_CATEGORY
    )
    assert "Eliias" in fresh["text"]
    assert "Founder" in fresh["text"]
