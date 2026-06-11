"""
GhostVault — Cerberus native routes.

GhostVault is the AI-powered markdown note workspace. Notes are stored
encrypted at rest using the shared Cerberus-wide vault (Fernet + PBKDF2,
domain-derived key — same salt as CyberLab/CredVault/VaultCore).

Endpoints:
  /api/cyberapps/vault/*      — shared vault (status, unlock, lock)
  /api/cyberapps/ghostvault/* — notes CRUD, folders, AI actions, settings

Secret values (note content) are Fernet-encrypted at rest.
The master password is never logged or persisted beyond the session.
"""
from __future__ import annotations

import logging
import secrets
import time
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from src.auth_helpers import get_current_user
from routes.cyberapps_ghostvault_vault import (
    vault_initialized, vault_unlock, vault_locked, vault_clear_sessions,
    vault_valid, encrypt_content, decrypt_content,
    read_json, write_json, now_iso, ensure_dirs,
    NOTES_PATH, FOLDERS_PATH, SETTINGS_PATH,
)
from routes.cyberapps_ghostvault_models import (
    NoteCreate, NoteUpdate, FolderCreate, SettingsUpdate,
)

logger = logging.getLogger(__name__)

_SETTINGS_DEFAULTS: Dict[str, Any] = {
    "default_folder": "Notes",
    "default_ai_context": "cyber",
    "editor_mode": "split",
    "autosave": True,
    "show_word_count": True,
    "default_template": None,
}

_DEFAULT_FOLDERS = ["Notes", "Meetings", "Projects", "Study", "Tasks", "Archive"]

_VALID_AI_CONTEXTS = {"work", "cyber", "personal"}
_VALID_EDITOR_MODES = {"edit", "split", "preview"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _uid() -> str:
    return f"{int(time.time() * 1000)}-{secrets.token_hex(4)}"


def _require_vault(request: Request) -> None:
    tok = request.headers.get("X-Vault-Token", "")
    if not vault_valid(tok):
        raise HTTPException(401, "Vault locked — unlock GhostVault first")


def _load_notes() -> List[Dict[str, Any]]:
    raw = read_json(NOTES_PATH, [])
    result = []
    for n in raw:
        try:
            note = dict(n)
            if note.get("content"):
                note["content"] = decrypt_content(note["content"])
            result.append(note)
        except Exception:
            result.append(n)
    return result


def _save_notes(notes: List[Dict[str, Any]]) -> None:
    encrypted = []
    for n in notes:
        note = dict(n)
        if note.get("content"):
            note["content"] = encrypt_content(note["content"])
        encrypted.append(note)
    write_json(NOTES_PATH, encrypted)


def _ensure_default_folders() -> None:
    folders = read_json(FOLDERS_PATH, None)
    if folders is None:
        write_json(FOLDERS_PATH, _DEFAULT_FOLDERS)


# ---------------------------------------------------------------------------
# Setup function
# ---------------------------------------------------------------------------

def setup_cyberapps_ghostvault_routes() -> APIRouter:
    router = APIRouter(tags=["cyberapps-ghostvault"])
    ensure_dirs()
    _ensure_default_folders()

    # -- Shared vault ---------------------------------------------------------

    @router.get("/api/cyberapps/vault/status")
    def vault_status(request: Request):
        get_current_user(request)
        return JSONResponse({"initialized": vault_initialized(), "locked": vault_locked()})

    @router.post("/api/cyberapps/vault/setup")
    def vault_setup_route(request: Request):
        get_current_user(request)
        raise HTTPException(501, "Use CyberLab to set up the shared vault first")

    @router.post("/api/cyberapps/vault/unlock")
    async def vault_unlock_route(request: Request):
        get_current_user(request)
        body = await request.json()
        password = (body or {}).get("password", "")
        if not password:
            raise HTTPException(400, "password is required")
        if not vault_initialized():
            raise HTTPException(404, "Vault not initialized — open CyberLab to set it up")
        token = vault_unlock(password)
        if not token:
            raise HTTPException(401, "Invalid master password")
        return JSONResponse({"ok": True, "session_token": token})

    @router.post("/api/cyberapps/vault/lock")
    def vault_lock_route(request: Request):
        get_current_user(request)
        vault_clear_sessions()
        return JSONResponse({"ok": True})

    # -- Notes: list ----------------------------------------------------------

    @router.get("/api/cyberapps/ghostvault/notes")
    def list_notes(
        request: Request,
        q: str = "",
        folder: str = "",
        tag: str = "",
        pinned: str = "",
    ):
        get_current_user(request)
        _require_vault(request)
        notes = _load_notes()
        if q:
            ql = q.lower()
            notes = [
                n for n in notes
                if ql in n.get("title", "").lower()
                or ql in n.get("content", "").lower()
                or ql in n.get("folder", "").lower()
            ]
        if folder:
            notes = [n for n in notes if n.get("folder") == folder]
        if tag:
            notes = [n for n in notes if tag in (n.get("tags") or [])]
        if pinned == "true":
            notes = [n for n in notes if n.get("pinned")]
        notes_sorted = sorted(notes, key=lambda n: n.get("updated_at", ""), reverse=True)
        # Never return content in list — callers must fetch individual note
        safe = [{k: v for k, v in n.items() if k != "content"} for n in notes_sorted]
        return JSONResponse({"notes": safe})

    # -- Notes: get single (with content) ------------------------------------

    @router.get("/api/cyberapps/ghostvault/notes/{note_id}")
    def get_note(note_id: str, request: Request):
        get_current_user(request)
        _require_vault(request)
        notes = _load_notes()
        note = next((n for n in notes if n.get("id") == note_id), None)
        if not note:
            raise HTTPException(404, "Note not found")
        return JSONResponse({"note": note})

    # -- Notes: create --------------------------------------------------------

    @router.post("/api/cyberapps/ghostvault/notes")
    def create_note(body: NoteCreate, request: Request):
        get_current_user(request)
        _require_vault(request)
        if not body.title.strip():
            raise HTTPException(400, "title is required")
        if body.ai_context and body.ai_context not in _VALID_AI_CONTEXTS:
            raise HTTPException(400, f"ai_context must be one of: {sorted(_VALID_AI_CONTEXTS)}")
        notes = _load_notes()
        now = now_iso()
        note: Dict[str, Any] = {
            "id": _uid(),
            "title": body.title.strip(),
            "content": body.content,
            "folder": body.folder or "Notes",
            "tags": body.tags or [],
            "template": body.template,
            "ai_context": body.ai_context,
            "pinned": body.pinned,
            "word_count": len(body.content.split()) if body.content else 0,
            "created_at": now,
            "updated_at": now,
        }
        notes.append(note)
        _save_notes(notes)
        return JSONResponse({"note": note}, status_code=201)

    # -- Notes: update --------------------------------------------------------

    @router.patch("/api/cyberapps/ghostvault/notes/{note_id}")
    def update_note(note_id: str, body: NoteUpdate, request: Request):
        get_current_user(request)
        _require_vault(request)
        notes = _load_notes()
        idx = next((i for i, n in enumerate(notes) if n.get("id") == note_id), None)
        if idx is None:
            raise HTTPException(404, "Note not found")
        patch = {k: v for k, v in body.model_dump().items() if v is not None}
        if "ai_context" in patch and patch["ai_context"] not in _VALID_AI_CONTEXTS:
            raise HTTPException(400, f"ai_context must be one of: {sorted(_VALID_AI_CONTEXTS)}")
        patch.pop("id", None)
        patch.pop("created_at", None)
        if "content" in patch:
            patch["word_count"] = len(patch["content"].split()) if patch["content"] else 0
        patch["updated_at"] = now_iso()
        notes[idx] = {**notes[idx], **patch}
        _save_notes(notes)
        return JSONResponse({"note": notes[idx]})

    # -- Notes: delete --------------------------------------------------------

    @router.delete("/api/cyberapps/ghostvault/notes/{note_id}")
    def delete_note(note_id: str, request: Request):
        get_current_user(request)
        _require_vault(request)
        notes = _load_notes()
        before = len(notes)
        notes = [n for n in notes if n.get("id") != note_id]
        if len(notes) == before:
            raise HTTPException(404, "Note not found")
        _save_notes(notes)
        return JSONResponse({"ok": True})

    # -- Notes: pin toggle ----------------------------------------------------

    @router.post("/api/cyberapps/ghostvault/notes/{note_id}/pin")
    def toggle_pin(note_id: str, request: Request):
        get_current_user(request)
        _require_vault(request)
        notes = _load_notes()
        idx = next((i for i, n in enumerate(notes) if n.get("id") == note_id), None)
        if idx is None:
            raise HTTPException(404, "Note not found")
        notes[idx]["pinned"] = not notes[idx].get("pinned", False)
        notes[idx]["updated_at"] = now_iso()
        _save_notes(notes)
        return JSONResponse({"pinned": notes[idx]["pinned"]})

    # -- Folders --------------------------------------------------------------

    @router.get("/api/cyberapps/ghostvault/folders")
    def list_folders(request: Request):
        get_current_user(request)
        return JSONResponse({"folders": read_json(FOLDERS_PATH, _DEFAULT_FOLDERS)})

    @router.post("/api/cyberapps/ghostvault/folders")
    def create_folder(body: FolderCreate, request: Request):
        get_current_user(request)
        name = body.name.strip()
        if not name:
            raise HTTPException(400, "name is required")
        folders = read_json(FOLDERS_PATH, list(_DEFAULT_FOLDERS))
        if name in folders:
            raise HTTPException(409, "Folder already exists")
        folders.append(name)
        write_json(FOLDERS_PATH, folders)
        return JSONResponse({"folders": folders}, status_code=201)

    @router.delete("/api/cyberapps/ghostvault/folders/{folder_name}")
    def delete_folder(folder_name: str, request: Request):
        get_current_user(request)
        folders = read_json(FOLDERS_PATH, list(_DEFAULT_FOLDERS))
        if folder_name not in folders:
            raise HTTPException(404, "Folder not found")
        folders = [f for f in folders if f != folder_name]
        write_json(FOLDERS_PATH, folders)
        return JSONResponse({"folders": folders})

    # -- Stats ----------------------------------------------------------------

    @router.get("/api/cyberapps/ghostvault/stats")
    def get_stats(request: Request):
        get_current_user(request)
        _require_vault(request)
        notes = _load_notes()
        folders = read_json(FOLDERS_PATH, _DEFAULT_FOLDERS)
        by_folder: Dict[str, int] = {}
        pinned_count = 0
        total_words = 0
        for n in notes:
            folder = n.get("folder", "Notes")
            by_folder[folder] = by_folder.get(folder, 0) + 1
            if n.get("pinned"):
                pinned_count += 1
            total_words += n.get("word_count", 0)
        return JSONResponse({
            "total_notes": len(notes),
            "total_folders": len(folders),
            "pinned": pinned_count,
            "total_words": total_words,
            "by_folder": by_folder,
        })

    # -- Settings -------------------------------------------------------------

    @router.get("/api/cyberapps/ghostvault/settings")
    def get_settings(request: Request):
        get_current_user(request)
        return JSONResponse({**_SETTINGS_DEFAULTS, **read_json(SETTINGS_PATH, {})})

    @router.post("/api/cyberapps/ghostvault/settings")
    def save_settings(body: SettingsUpdate, request: Request):
        get_current_user(request)
        patch = {k: v for k, v in body.model_dump().items() if v is not None}
        if "editor_mode" in patch and patch["editor_mode"] not in _VALID_EDITOR_MODES:
            raise HTTPException(400, f"editor_mode must be one of: {sorted(_VALID_EDITOR_MODES)}")
        if "default_ai_context" in patch and patch["default_ai_context"] not in _VALID_AI_CONTEXTS:
            raise HTTPException(400, f"default_ai_context must be one of: {sorted(_VALID_AI_CONTEXTS)}")
        stored = read_json(SETTINGS_PATH, {})
        stored.update(patch)
        write_json(SETTINGS_PATH, stored)
        return JSONResponse({"ok": True})

    # -- Health ---------------------------------------------------------------

    @router.get("/api/cyberapps/ghostvault/health")
    def health(request: Request):
        get_current_user(request)
        return JSONResponse({"status": "ok", "app": "ghostvault", "vault": not vault_locked()})

    return router
