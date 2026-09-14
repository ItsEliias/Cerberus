"""Desktop settings — runtime toggle for Docker-backed features.

The packaged desktop app (see desktop.py) reads
``<DATA_DIR>/desktop_settings.json`` at launch and exports the relevant keys to
the environment *before* the sandbox module imports them. These endpoints let an
admin view and edit that file from inside the app so Docker-backed features
(OpenSandbox code execution, chromadb vectors, searxng search) can be pointed at
a local Docker stack now or a remote Docker server later — no file editing.

Because the sandbox module reads its endpoint config at import time, changes take
effect on the **next launch**; every write returns ``restart_required: true``.

Endpoints (all admin-only):
  GET  /api/desktop/settings          → current settings (api key masked)
  POST /api/desktop/settings          → validate + persist; restart to apply
  GET  /api/desktop/settings/status   → is the configured sandbox reachable?

Security note: this only edits configuration. It never enables host execution —
when the sandbox is disabled or unreachable the tool layer still fails closed.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Dict
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request

from core.middleware import require_admin
from src.constants import DATA_DIR

logger = logging.getLogger(__name__)

_SETTINGS_FILENAME = "desktop_settings.json"

# Boolean-style key handled separately from the plain string keys below.
_BOOL_KEYS = ("CERBERUS_SANDBOX_ENABLED",)
_STR_KEYS = (
    "SANDBOX_URL",
    "SANDBOX_API_KEY",
    "SANDBOX_IMAGE",
    "SANDBOX_TIMEOUT",
    "SANDBOX_EGRESS_ALLOWLIST",
    "SEARCH_SEARXNG_INSTANCE",
    "CHROMA_URL",
)
_SECRET_KEYS = ("SANDBOX_API_KEY",)


def _settings_path() -> Path:
    return Path(DATA_DIR) / _SETTINGS_FILENAME


def _read_settings() -> Dict[str, Any]:
    try:
        raw = _settings_path().read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return {}
    except OSError as exc:
        logger.warning("could not read %s: %s", _settings_path(), exc)
        return {}
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError:
        logger.warning("malformed %s — treating as empty", _settings_path())
        return {}
    return data if isinstance(data, dict) else {}


def _atomic_write(data: Dict[str, Any]) -> None:
    path = _settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, sort_keys=True)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


def _mask(value: str) -> str:
    """Mask a secret for display: keep the last 4 chars."""
    if not value:
        return ""
    if len(value) <= 4:
        return "****"
    return "****" + value[-4:]


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in ("", "0", "false", "no", "off")


def _validate_url(value: str, field: str) -> str:
    value = value.strip()
    if not value:
        return value
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise HTTPException(
            status_code=400,
            detail=f"{field} must be an http(s) URL with a host, got {value!r}",
        )
    return value


def setup_desktop_settings_routes() -> APIRouter:
    router = APIRouter(prefix="/api/desktop")

    @router.get("/settings")
    async def get_settings(request: Request):
        require_admin(request)
        stored = _read_settings()

        def _effective(key: str, default: str = "") -> str:
            # Persisted file value if present, else the live process env, else default.
            if key in stored and stored[key] is not None:
                return str(stored[key])
            return os.environ.get(key, default)

        enabled = _coerce_bool(_effective("CERBERUS_SANDBOX_ENABLED", "false"))
        out: Dict[str, Any] = {"CERBERUS_SANDBOX_ENABLED": enabled}
        for key in _STR_KEYS:
            val = _effective(key)
            out[key] = _mask(val) if key in _SECRET_KEYS else val
        out["_meta"] = {
            "settings_path": str(_settings_path()),
            "restart_required_to_apply": True,
            "docker_features": ["sandbox_execution", "vectors", "search"],
        }
        return out

    @router.post("/settings")
    async def update_settings(request: Request):
        require_admin(request)
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="body must be JSON")
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="body must be a JSON object")

        current = _read_settings()
        updated = dict(current)

        # Booleans
        for key in _BOOL_KEYS:
            if key in body:
                updated[key] = "true" if _coerce_bool(body[key]) else "false"

        # Strings (with per-field validation)
        for key in _STR_KEYS:
            if key not in body:
                continue
            raw = body[key]
            if raw is None:
                updated.pop(key, None)
                continue
            value = str(raw).strip()
            # A masked secret coming back unchanged from the UI means "keep it".
            if key in _SECRET_KEYS and value.startswith("****"):
                continue
            if key in ("SANDBOX_URL", "SEARCH_SEARXNG_INSTANCE", "CHROMA_URL"):
                value = _validate_url(value, key)
            if key == "SANDBOX_TIMEOUT" and value:
                if not value.isdigit():
                    raise HTTPException(status_code=400, detail="SANDBOX_TIMEOUT must be an integer")
            if value == "":
                updated.pop(key, None)
            else:
                updated[key] = value

        _atomic_write(updated)
        logger.info("desktop settings updated by admin (%d keys)", len(updated))
        return {"ok": True, "restart_required": True, "settings_path": str(_settings_path())}

    @router.get("/settings/status")
    async def sandbox_status(request: Request):
        require_admin(request)
        # Report the effective sandbox config the *running* process is using, plus
        # a best-effort reachability probe of that endpoint.
        try:
            from src.agent_tools import sandbox_backend as sb
            url = getattr(sb, "SANDBOX_URL", os.environ.get("SANDBOX_URL", ""))
            url_safe = getattr(sb, "_SANDBOX_URL_SAFE", None)
        except Exception:
            url = os.environ.get("SANDBOX_URL", "")
            url_safe = None

        enabled = os.environ.get("CERBERUS_SANDBOX_ENABLED", "true").lower() != "false"
        reachable = False
        detail = ""
        if url:
            try:
                import urllib.request
                probe = url.rstrip("/") + "/health"
                with urllib.request.urlopen(probe, timeout=2.0) as resp:
                    reachable = resp.status < 500
            except Exception as exc:  # noqa: BLE001 — status probe is best-effort
                detail = str(exc)[:200]

        return {
            "enabled": enabled,
            "sandbox_url": url,
            "url_safe": url_safe,
            "reachable": reachable,
            "detail": detail,
        }

    return router
