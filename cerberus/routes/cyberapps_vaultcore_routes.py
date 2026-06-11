"""
VaultCore — Cerberus native routes.

Endpoints:
  /api/cyberapps/vault/*      — shared vault (status, setup, unlock, lock)
  /api/cyberapps/vaultcore/*  — sources, scrape jobs, logs, health, settings
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from src.auth_helpers import get_current_user
from routes.cyberapps_vaultcore_vault import (
    vault_initialized, vault_unlock,
    vault_locked, vault_clear_sessions,
    read_json, write_json, now_iso,
    SOURCES_PATH, JOBS_PATH, LOGS_PATH, SETTINGS_PATH,
    ensure_dirs,
)
from routes.cyberapps_vaultcore_models import (
    SourceCreate, SourceUpdate,
    ScrapeJobCreate, SettingsSave,
)

logger = logging.getLogger(__name__)

_SETTINGS_DEFAULTS: Dict[str, Any] = {
    "vault_path": "",
    "default_conflict_strategy": "skip",
    "default_depth": 3,
    "default_max_pages": 50,
    "default_delay": 1,
    "auto_wikilinks": True,
    "auto_tag": True,
    "notifications": True,
}

_VALID_SOURCE_TYPES = {
    "obsidian-publish", "website", "github", "youtube",
    "pdf", "reddit", "twitter", "notion", "medium", "cve", "rss",
}

_VALID_CONFLICT_STRATEGIES = {"skip", "overwrite", "keepBoth", "ask"}
_VALID_UPDATE_MODES = {"all", "updates"}


# ---------------------------------------------------------------------------
# Setup function
# ---------------------------------------------------------------------------

def setup_cyberapps_vaultcore_routes() -> APIRouter:
    router = APIRouter(tags=["cyberapps-vaultcore"])
    ensure_dirs()

    # -- Vault -----------------------------------------------------------------

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

    # -- Sources ---------------------------------------------------------------

    @router.get("/api/cyberapps/vaultcore/sources")
    def list_sources(request: Request, q: str = ""):
        get_current_user(request)
        sources = read_json(SOURCES_PATH, [])
        if q:
            ql = q.lower()
            sources = [
                s for s in sources
                if ql in s.get("name", "").lower()
                or ql in s.get("url", "").lower()
                or ql in s.get("type", "").lower()
            ]
        return JSONResponse(sources)

    @router.post("/api/cyberapps/vaultcore/sources")
    def create_source(body: SourceCreate, request: Request):
        get_current_user(request)
        if not body.name.strip():
            raise HTTPException(400, "name is required")
        if body.type not in _VALID_SOURCE_TYPES:
            raise HTTPException(400, f"type must be one of: {sorted(_VALID_SOURCE_TYPES)}")
        sources = read_json(SOURCES_PATH, [])
        source = {
            "id": str(uuid.uuid4()),
            "name": body.name.strip(),
            "type": body.type,
            "url": body.url.strip(),
            "config": body.config,
            "schedule": {
                "enabled": body.schedule_enabled,
                "cronExpression": body.schedule_cron,
                "conflictStrategy": body.conflict_strategy,
            },
            "lastScraped": None,
            "noteCount": 0,
            "health": {
                "status": "unknown",
                "consecutiveFailures": 0,
            },
            "created_at": now_iso(),
        }
        sources.append(source)
        write_json(SOURCES_PATH, sources)
        return JSONResponse(source, status_code=201)

    @router.patch("/api/cyberapps/vaultcore/sources/{source_id}")
    def update_source(source_id: str, body: SourceUpdate, request: Request):
        get_current_user(request)
        sources = read_json(SOURCES_PATH, [])
        updated = body.model_dump(exclude_none=True)
        found = False
        for s in sources:
            if s.get("id") == source_id:
                if "name" in updated:
                    s["name"] = updated["name"].strip()
                if "type" in updated:
                    if updated["type"] not in _VALID_SOURCE_TYPES:
                        raise HTTPException(400, "invalid type")
                    s["type"] = updated["type"]
                if "url" in updated:
                    s["url"] = updated["url"].strip()
                if "config" in updated:
                    s["config"] = updated["config"]
                if "schedule_enabled" in updated or "schedule_cron" in updated or "conflict_strategy" in updated:
                    sch = s.setdefault("schedule", {})
                    if "schedule_enabled" in updated:
                        sch["enabled"] = updated["schedule_enabled"]
                    if "schedule_cron" in updated:
                        sch["cronExpression"] = updated["schedule_cron"]
                    if "conflict_strategy" in updated:
                        sch["conflictStrategy"] = updated["conflict_strategy"]
                found = True
                break
        if not found:
            raise HTTPException(404, "Source not found")
        write_json(SOURCES_PATH, sources)
        return JSONResponse({"ok": True})

    @router.delete("/api/cyberapps/vaultcore/sources/{source_id}")
    def delete_source(source_id: str, request: Request):
        get_current_user(request)
        sources = read_json(SOURCES_PATH, [])
        write_json(SOURCES_PATH, [s for s in sources if s.get("id") != source_id])
        return JSONResponse({"ok": True})

    # -- Scrape Jobs -----------------------------------------------------------

    @router.get("/api/cyberapps/vaultcore/jobs")
    def list_jobs(request: Request, limit: int = 50):
        get_current_user(request)
        jobs = read_json(JOBS_PATH, [])
        return JSONResponse(jobs[-limit:])

    @router.post("/api/cyberapps/vaultcore/jobs")
    def create_job(body: ScrapeJobCreate, request: Request):
        get_current_user(request)
        if body.source_type not in _VALID_SOURCE_TYPES:
            raise HTTPException(400, f"source_type must be one of: {sorted(_VALID_SOURCE_TYPES)}")
        if body.conflict_strategy not in _VALID_CONFLICT_STRATEGIES:
            raise HTTPException(400, "invalid conflict_strategy")
        if body.update_mode not in _VALID_UPDATE_MODES:
            raise HTTPException(400, "update_mode must be 'all' or 'updates'")
        jobs = read_json(JOBS_PATH, [])
        job = {
            "id": str(uuid.uuid4()),
            "source_id": body.source_id,
            "source_type": body.source_type,
            "url": body.url.strip(),
            "source_name": body.source_name.strip() or body.url.strip(),
            "output_subfolder": body.output_subfolder.strip(),
            "conflict_strategy": body.conflict_strategy,
            "update_mode": body.update_mode,
            "options": {
                "depth": body.depth,
                "max_pages": body.max_pages,
                "delay": body.delay,
            },
            "status": "queued",
            "progress": {"percent": 0, "message": "Queued"},
            "result": None,
            "created_at": now_iso(),
            "started_at": None,
            "completed_at": None,
        }
        jobs.append(job)
        write_json(JOBS_PATH, jobs)
        _append_log(source_id=body.source_id, source_name=job["source_name"],
                    status="queued", message=f"Job queued: {job['url']}")
        return JSONResponse(job, status_code=201)

    @router.get("/api/cyberapps/vaultcore/jobs/{job_id}")
    def get_job(job_id: str, request: Request):
        get_current_user(request)
        jobs = read_json(JOBS_PATH, [])
        for j in jobs:
            if j.get("id") == job_id:
                return JSONResponse(j)
        raise HTTPException(404, "Job not found")

    @router.delete("/api/cyberapps/vaultcore/jobs/{job_id}")
    def delete_job(job_id: str, request: Request):
        get_current_user(request)
        jobs = read_json(JOBS_PATH, [])
        write_json(JOBS_PATH, [j for j in jobs if j.get("id") != job_id])
        return JSONResponse({"ok": True})

    # -- Logs ------------------------------------------------------------------

    @router.get("/api/cyberapps/vaultcore/logs")
    def list_logs(request: Request, limit: int = 200, source_id: str = "", status: str = ""):
        get_current_user(request)
        logs = read_json(LOGS_PATH, [])
        if source_id:
            logs = [entry for entry in logs if entry.get("source_id") == source_id]
        if status:
            logs = [entry for entry in logs if entry.get("status") == status]
        return JSONResponse(logs[-limit:])

    @router.delete("/api/cyberapps/vaultcore/logs")
    def clear_logs(request: Request):
        get_current_user(request)
        write_json(LOGS_PATH, [])
        return JSONResponse({"ok": True})

    # -- Vault Health ----------------------------------------------------------

    @router.get("/api/cyberapps/vaultcore/health")
    def vault_health(request: Request):
        get_current_user(request)
        sources = read_json(SOURCES_PATH, [])
        jobs = read_json(JOBS_PATH, [])
        logs = read_json(LOGS_PATH, [])

        completed = [j for j in jobs if j.get("status") == "completed"]
        failed = [j for j in jobs if j.get("status") == "failed"]
        queued = [j for j in jobs if j.get("status") == "queued"]
        running = [j for j in jobs if j.get("status") == "running"]

        total_notes = sum(s.get("noteCount", 0) for s in sources)
        healthy = sum(1 for s in sources if s.get("health", {}).get("status") == "healthy")
        errored = sum(1 for s in sources if s.get("health", {}).get("status") == "error")
        unknown = sum(1 for s in sources if s.get("health", {}).get("status", "unknown") == "unknown")

        type_breakdown: Dict[str, int] = {}
        for s in sources:
            t = s.get("type", "unknown")
            type_breakdown[t] = type_breakdown.get(t, 0) + 1

        return JSONResponse({
            "sources": {
                "total": len(sources),
                "healthy": healthy,
                "errored": errored,
                "unknown": unknown,
                "by_type": type_breakdown,
            },
            "jobs": {
                "total": len(jobs),
                "completed": len(completed),
                "failed": len(failed),
                "queued": len(queued),
                "running": len(running),
            },
            "notes": {
                "total": total_notes,
            },
            "logs": {
                "total": len(logs),
                "recent_errors": [
                    entry for entry in reversed(logs)
                    if entry.get("status") == "error"
                ][:5],
            },
        })

    # -- Settings --------------------------------------------------------------

    @router.get("/api/cyberapps/vaultcore/settings")
    def get_settings(request: Request):
        get_current_user(request)
        return JSONResponse({**_SETTINGS_DEFAULTS, **read_json(SETTINGS_PATH, {})})

    @router.post("/api/cyberapps/vaultcore/settings")
    def save_settings(body: SettingsSave, request: Request):
        get_current_user(request)
        stored = read_json(SETTINGS_PATH, {})
        stored.update(body.model_dump(exclude_none=True))
        write_json(SETTINGS_PATH, stored)
        return JSONResponse({"ok": True})

    return router


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _append_log(source_id: str, source_name: str, status: str, message: str) -> None:
    logs = read_json(LOGS_PATH, [])
    logs.append({
        "id": str(uuid.uuid4()),
        "source_id": source_id,
        "source_name": source_name,
        "status": status,
        "message": message,
        "ts": now_iso(),
    })
    # Keep last 1000 log entries
    if len(logs) > 1000:
        logs = logs[-1000:]
    write_json(LOGS_PATH, logs)
