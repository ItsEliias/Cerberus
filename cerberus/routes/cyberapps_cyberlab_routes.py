"""
CyberLab Companion — Cerberus native routes.

Endpoints:
  /api/cyberapps/vault/*   — shared vault (init, unlock, lock, change-password)
  /api/cyberlab/*          — labs, sessions, chat, reviews, kb, snippets,
                             cheatsheets, settings, credentials
"""
from __future__ import annotations

import logging
import os
import secrets
import uuid
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from src.auth_helpers import get_current_user
from routes.cyberapps_cyberlab_cheatsheets import CHEATSHEETS
from routes.cyberapps_cyberlab_vault import (
    vault_initialized, vault_setup, vault_unlock, vault_valid,
    vault_locked, vault_clear_sessions,
    SENTINEL_PATH, SALT_PATH,
    read_json, write_json, now_iso, safe_chmod,
    LABS_PATH, SESSIONS_PATH, REVIEWS_PATH, KNOWLEDGE_PATH,
    SNIPPETS_PATH, SETTINGS_PATH, ACTIVE_LAB_PATH, CREDENTIALS_PATH,
)
from routes.cyberapps_cyberlab_models import (
    VaultSetupBody, VaultUnlockBody, VaultChangeBody,
    LabCreate, LabUpdate, SessionCreate,
    ReviewCreate, ReviewUpdate,
    KnowledgeCreate, KnowledgeUpdate,
    SnippetCreate, SnippetUpdate,
    ChatMessage, CredentialSave, SettingsSave,
)

logger = logging.getLogger(__name__)

_SETTINGS_DEFAULTS: Dict[str, Any] = {
    "default_model": "claude-sonnet-4-6",
    "max_tokens": 2048,
    "system_prompt_override": "",
    "auto_context_inject": True,
    "kb_auto_surface": True,
}


# ---------------------------------------------------------------------------
# Setup function
# ---------------------------------------------------------------------------

def setup_cyberapps_cyberlab_routes() -> APIRouter:
    router = APIRouter(tags=["cyberapps-cyberlab"])

    # -- Vault -----------------------------------------------------------------

    @router.get("/api/cyberapps/vault/status")
    def vault_status(request: Request):
        get_current_user(request)
        return JSONResponse({"initialized": vault_initialized(), "locked": vault_locked()})

    @router.post("/api/cyberapps/vault/setup")
    def vault_setup_route(body: VaultSetupBody, request: Request):
        get_current_user(request)
        if len(body.password) < 8:
            raise HTTPException(400, "Password must be at least 8 characters")
        if vault_initialized():
            raise HTTPException(409, "Vault already initialized — POST /api/cyberapps/vault/unlock")
        return JSONResponse({"ok": True, "session_token": vault_setup(body.password)})

    @router.post("/api/cyberapps/vault/unlock")
    def vault_unlock_route(body: VaultUnlockBody, request: Request):
        get_current_user(request)
        if not body.password:
            raise HTTPException(400, "password is required")
        if not vault_initialized():
            raise HTTPException(404, "Vault not initialized — POST /api/cyberapps/vault/setup")
        token = vault_unlock(body.password)
        if not token:
            raise HTTPException(401, "Invalid master password")
        return JSONResponse({"ok": True, "session_token": token})

    @router.post("/api/cyberapps/vault/lock")
    def vault_lock_route(request: Request):
        get_current_user(request)
        vault_clear_sessions()
        return JSONResponse({"ok": True})

    @router.post("/api/cyberapps/vault/change-password")
    def vault_change_password(body: VaultChangeBody, request: Request):
        get_current_user(request)
        if not vault_unlock(body.old_password):
            raise HTTPException(401, "Current password is incorrect")
        if len(body.new_password) < 8:
            raise HTTPException(400, "New password must be at least 8 characters")
        SENTINEL_PATH.unlink(missing_ok=True)
        vault_clear_sessions()
        new_salt = secrets.token_bytes(32)
        SALT_PATH.write_text(new_salt.hex())
        safe_chmod(SALT_PATH)
        return JSONResponse({"ok": True, "session_token": vault_setup(body.new_password)})

    # -- Credentials -----------------------------------------------------------

    @router.get("/api/cyberlab/credentials")
    def list_credentials(request: Request):
        get_current_user(request)
        tok = request.headers.get("X-Vault-Token")
        if not vault_valid(tok):
            raise HTTPException(401, "Vault locked")
        creds = read_json(CREDENTIALS_PATH, {})
        return JSONResponse({k: {"platform": k, "connected": True, "label": v.get("label",""), "saved_at": v.get("saved_at")} for k, v in creds.items()})

    @router.post("/api/cyberlab/credentials/{platform}")
    def save_credential(platform: str, body: CredentialSave, request: Request):
        get_current_user(request)
        tok = request.headers.get("X-Vault-Token")
        if not vault_valid(tok):
            raise HTTPException(401, "Vault locked")
        if not body.token.strip():
            raise HTTPException(400, "token is required")
        creds = read_json(CREDENTIALS_PATH, {})
        creds[platform] = {"token": body.token.strip(), "label": body.label, "saved_at": now_iso()}
        write_json(CREDENTIALS_PATH, creds)
        safe_chmod(CREDENTIALS_PATH)
        return JSONResponse({"ok": True, "platform": platform})

    @router.delete("/api/cyberlab/credentials/{platform}")
    def delete_credential(platform: str, request: Request):
        get_current_user(request)
        tok = request.headers.get("X-Vault-Token")
        if not vault_valid(tok):
            raise HTTPException(401, "Vault locked")
        creds = read_json(CREDENTIALS_PATH, {})
        creds.pop(platform, None)
        write_json(CREDENTIALS_PATH, creds)
        return JSONResponse({"ok": True})

    # -- Labs ------------------------------------------------------------------

    @router.get("/api/cyberlab/labs")
    def list_labs(request: Request):
        get_current_user(request)
        return JSONResponse(read_json(LABS_PATH, []))

    @router.post("/api/cyberlab/labs")
    def create_lab(body: LabCreate, request: Request):
        get_current_user(request)
        if not body.name.strip():
            raise HTTPException(400, "name is required")
        labs = read_json(LABS_PATH, [])
        lab = {"id": str(uuid.uuid4()), "name": body.name.strip(), "platform": body.platform,
               "os": body.os, "difficulty": body.difficulty, "status": body.status,
               "ip": body.ip, "notes": body.notes, "url": body.url, "tags": body.tags,
               "created_at": now_iso(), "completed_at": body.completed_at}
        labs.append(lab)
        write_json(LABS_PATH, labs)
        return JSONResponse(lab, status_code=201)

    @router.patch("/api/cyberlab/labs/{lab_id}")
    def update_lab(lab_id: str, body: LabUpdate, request: Request):
        get_current_user(request)
        labs = read_json(LABS_PATH, [])
        updated = body.model_dump(exclude_none=True)
        for lab in labs:
            if lab.get("id") == lab_id:
                lab.update(updated)
                break
        write_json(LABS_PATH, labs)
        return JSONResponse({"ok": True})

    @router.delete("/api/cyberlab/labs/{lab_id}")
    def delete_lab(lab_id: str, request: Request):
        get_current_user(request)
        labs = read_json(LABS_PATH, [])
        write_json(LABS_PATH, [l for l in labs if l.get("id") != lab_id])
        return JSONResponse({"ok": True})

    @router.get("/api/cyberlab/active-lab")
    def get_active_lab(request: Request):
        get_current_user(request)
        return JSONResponse(read_json(ACTIVE_LAB_PATH, {}))

    @router.post("/api/cyberlab/active-lab")
    async def set_active_lab(request: Request):
        get_current_user(request)
        write_json(ACTIVE_LAB_PATH, await request.json())
        return JSONResponse({"ok": True})

    # -- Sessions --------------------------------------------------------------

    @router.get("/api/cyberlab/sessions")
    def list_sessions(request: Request):
        get_current_user(request)
        return JSONResponse(read_json(SESSIONS_PATH, []))

    @router.post("/api/cyberlab/sessions")
    def create_session(body: SessionCreate, request: Request):
        get_current_user(request)
        sessions = read_json(SESSIONS_PATH, [])
        session = {"id": str(uuid.uuid4()), "name": body.name, "platform": body.platform,
                   "machine": body.machine, "ip": body.ip, "notes": body.notes,
                   "lab_id": body.lab_id, "created_at": now_iso(), "start_at": now_iso(),
                   "paused_at": None, "total_seconds": 0, "messages": []}
        sessions.append(session)
        write_json(SESSIONS_PATH, sessions)
        return JSONResponse(session, status_code=201)

    @router.patch("/api/cyberlab/sessions/{session_id}")
    async def update_session(session_id: str, request: Request):
        get_current_user(request)
        body = await request.json()
        sessions = read_json(SESSIONS_PATH, [])
        allowed = {"name", "paused_at", "total_seconds", "start_at", "notes"}
        for s in sessions:
            if s.get("id") == session_id:
                for k, v in body.items():
                    if k in allowed:
                        s[k] = v
                break
        write_json(SESSIONS_PATH, sessions)
        return JSONResponse({"ok": True})

    @router.delete("/api/cyberlab/sessions/{session_id}")
    def delete_session(session_id: str, request: Request):
        get_current_user(request)
        sessions = read_json(SESSIONS_PATH, [])
        write_json(SESSIONS_PATH, [s for s in sessions if s.get("id") != session_id])
        return JSONResponse({"ok": True})

    # -- Chat ------------------------------------------------------------------

    @router.post("/api/cyberlab/chat")
    def cyberlab_chat(body: ChatMessage, request: Request):
        get_current_user(request)
        api_key = os.getenv("CLAUDE_API_KEY") or os.getenv("ANTHROPIC_API_KEY", "")
        if not api_key:
            raise HTTPException(503, "CLAUDE_API_KEY not configured")
        if not body.message.strip():
            raise HTTPException(400, "message is required")
        settings = read_json(SETTINGS_PATH, {})
        model = settings.get("default_model", "claude-sonnet-4-6")
        max_tokens = int(settings.get("max_tokens", 2048))
        system_prompt = settings.get("system_prompt_override") or _build_system_prompt(body.active_lab, body.kb_entries)
        msgs = [{"role": m["role"], "content": m["content"]} for m in body.history]
        msgs.append({"role": "user", "content": body.message.strip()})
        try:
            import anthropic
            resp = anthropic.Anthropic(api_key=api_key).messages.create(
                model=model, max_tokens=max_tokens, system=system_prompt, messages=msgs)
            reply = resp.content[0].text
        except Exception as exc:
            raise HTTPException(500, str(exc)) from exc
        if body.session_id:
            _persist_chat(body.session_id, body.message.strip(), reply)
        return JSONResponse({"reply": reply, "model": model, "usage": {"input_tokens": resp.usage.input_tokens, "output_tokens": resp.usage.output_tokens}})

    # -- Reviews ---------------------------------------------------------------

    @router.get("/api/cyberlab/reviews")
    def list_reviews(request: Request):
        get_current_user(request)
        return JSONResponse(read_json(REVIEWS_PATH, []))

    @router.post("/api/cyberlab/reviews")
    def create_review(body: ReviewCreate, request: Request):
        get_current_user(request)
        if not body.machine_name.strip():
            raise HTTPException(400, "machine_name is required")
        if not 1 <= body.rating <= 5:
            raise HTTPException(400, "rating must be 1-5")
        reviews = read_json(REVIEWS_PATH, [])
        review = {"id": str(uuid.uuid4()), "machine_name": body.machine_name.strip(),
                  "platform": body.platform, "rating": body.rating, "notes": body.notes,
                  "tags": body.tags, "lab_id": body.lab_id, "created_at": now_iso()}
        reviews.append(review)
        write_json(REVIEWS_PATH, reviews)
        return JSONResponse(review, status_code=201)

    @router.patch("/api/cyberlab/reviews/{review_id}")
    def update_review(review_id: str, body: ReviewUpdate, request: Request):
        get_current_user(request)
        reviews = read_json(REVIEWS_PATH, [])
        updated = body.model_dump(exclude_none=True)
        for r in reviews:
            if r.get("id") == review_id:
                r.update(updated)
                break
        write_json(REVIEWS_PATH, reviews)
        return JSONResponse({"ok": True})

    @router.delete("/api/cyberlab/reviews/{review_id}")
    def delete_review(review_id: str, request: Request):
        get_current_user(request)
        reviews = read_json(REVIEWS_PATH, [])
        write_json(REVIEWS_PATH, [r for r in reviews if r.get("id") != review_id])
        return JSONResponse({"ok": True})

    # -- Knowledge Base --------------------------------------------------------

    @router.get("/api/cyberlab/knowledge")
    def list_knowledge(request: Request, q: str = ""):
        get_current_user(request)
        entries = read_json(KNOWLEDGE_PATH, [])
        if q:
            ql = q.lower()
            entries = [e for e in entries if ql in e.get("title","").lower() or ql in e.get("content","").lower() or any(ql in t.lower() for t in e.get("tags",[]))]
        return JSONResponse(entries)

    @router.post("/api/cyberlab/knowledge")
    def create_knowledge(body: KnowledgeCreate, request: Request):
        get_current_user(request)
        if not body.title.strip():
            raise HTTPException(400, "title is required")
        entries = read_json(KNOWLEDGE_PATH, [])
        entry = {"id": str(uuid.uuid4()), "title": body.title.strip(), "content": body.content,
                 "tags": body.tags, "linked_lab_id": body.linked_lab_id,
                 "created_at": now_iso(), "updated_at": now_iso()}
        entries.append(entry)
        write_json(KNOWLEDGE_PATH, entries)
        return JSONResponse(entry, status_code=201)

    @router.patch("/api/cyberlab/knowledge/{entry_id}")
    def update_knowledge(entry_id: str, body: KnowledgeUpdate, request: Request):
        get_current_user(request)
        entries = read_json(KNOWLEDGE_PATH, [])
        updated = body.model_dump(exclude_none=True)
        for e in entries:
            if e.get("id") == entry_id:
                e.update(updated)
                e["updated_at"] = now_iso()
                break
        write_json(KNOWLEDGE_PATH, entries)
        return JSONResponse({"ok": True})

    @router.delete("/api/cyberlab/knowledge/{entry_id}")
    def delete_knowledge(entry_id: str, request: Request):
        get_current_user(request)
        entries = read_json(KNOWLEDGE_PATH, [])
        write_json(KNOWLEDGE_PATH, [e for e in entries if e.get("id") != entry_id])
        return JSONResponse({"ok": True})

    # -- Snippets --------------------------------------------------------------

    @router.get("/api/cyberlab/snippets")
    def list_snippets(request: Request, q: str = ""):
        get_current_user(request)
        snippets = read_json(SNIPPETS_PATH, [])
        if q:
            ql = q.lower()
            snippets = [s for s in snippets if ql in s.get("title","").lower() or ql in s.get("command","").lower() or any(ql in t.lower() for t in s.get("tags",[]))]
        return JSONResponse(snippets)

    @router.post("/api/cyberlab/snippets")
    def create_snippet(body: SnippetCreate, request: Request):
        get_current_user(request)
        if not body.title.strip():
            raise HTTPException(400, "title is required")
        snippets = read_json(SNIPPETS_PATH, [])
        snippet = {"id": str(uuid.uuid4()), "title": body.title.strip(), "command": body.command,
                   "language": body.language, "tags": body.tags, "created_at": now_iso()}
        snippets.append(snippet)
        write_json(SNIPPETS_PATH, snippets)
        return JSONResponse(snippet, status_code=201)

    @router.patch("/api/cyberlab/snippets/{snippet_id}")
    def update_snippet(snippet_id: str, body: SnippetUpdate, request: Request):
        get_current_user(request)
        snippets = read_json(SNIPPETS_PATH, [])
        updated = body.model_dump(exclude_none=True)
        for s in snippets:
            if s.get("id") == snippet_id:
                s.update(updated)
                break
        write_json(SNIPPETS_PATH, snippets)
        return JSONResponse({"ok": True})

    @router.delete("/api/cyberlab/snippets/{snippet_id}")
    def delete_snippet(snippet_id: str, request: Request):
        get_current_user(request)
        snippets = read_json(SNIPPETS_PATH, [])
        write_json(SNIPPETS_PATH, [s for s in snippets if s.get("id") != snippet_id])
        return JSONResponse({"ok": True})

    # -- Cheatsheets -----------------------------------------------------------

    @router.get("/api/cyberlab/cheatsheets")
    def list_cheatsheets(request: Request):
        get_current_user(request)
        return JSONResponse([{"key": k, "title": v.get("title", k)} for k, v in CHEATSHEETS.items()])

    @router.get("/api/cyberlab/cheatsheets/{key}")
    def get_cheatsheet(key: str, request: Request):
        get_current_user(request)
        sheet = CHEATSHEETS.get(key)
        if not sheet:
            raise HTTPException(404, "Cheatsheet not found")
        return JSONResponse(sheet)

    # -- Settings --------------------------------------------------------------

    @router.get("/api/cyberlab/settings")
    def get_settings(request: Request):
        get_current_user(request)
        return JSONResponse({**_SETTINGS_DEFAULTS, **read_json(SETTINGS_PATH, {})})

    @router.post("/api/cyberlab/settings")
    def save_settings(body: SettingsSave, request: Request):
        get_current_user(request)
        stored = read_json(SETTINGS_PATH, {})
        stored.update(body.model_dump(exclude_none=True))
        write_json(SETTINGS_PATH, stored)
        return JSONResponse({"ok": True})

    return router


# ---------------------------------------------------------------------------
# Private module-level helpers
# ---------------------------------------------------------------------------

def _build_system_prompt(active_lab: Dict[str, Any], kb_entries: List[Dict[str, Any]]) -> str:
    base = (
        "You are a cybersecurity AI assistant embedded in CyberLab Companion inside Cerberus. "
        "You help with HackTheBox (HTB) and TryHackMe (THM) machines, CTF challenges, "
        "recon, exploitation, privilege escalation, and post-exploitation. "
        "Be concise, practical, and command-line oriented. Use code blocks for commands. "
        "Guide — do not give full solutions immediately."
    )
    if active_lab and active_lab.get("name"):
        ctx = f"\n\nActive lab: {active_lab['name']}"
        for f, label in (("platform","Platform"),("os","OS"),("difficulty","Difficulty"),("ip","Target IP"),("status","Status")):
            if active_lab.get(f):
                ctx += f" | {label}: {active_lab[f].upper() if f == 'platform' else active_lab[f]}"
        base += ctx
    if kb_entries:
        base += "\n\nRelevant KB entries:\n" + "".join(f"- {e.get('title','')}: {str(e.get('content',''))[:200]}\n" for e in kb_entries[:3])
    return base


def _persist_chat(session_id: str, user_msg: str, reply: str) -> None:
    sessions = read_json(SESSIONS_PATH, [])
    ts = now_iso()
    for s in sessions:
        if s.get("id") == session_id:
            s.setdefault("messages", [])
            s["messages"].append({"role": "user", "content": user_msg, "ts": ts})
            s["messages"].append({"role": "assistant", "content": reply, "ts": ts})
            break
    write_json(SESSIONS_PATH, sessions)
