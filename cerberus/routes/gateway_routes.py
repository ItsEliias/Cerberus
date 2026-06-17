"""
routes/gateway_routes.py — Gateway cron job management API.

Cerberus and the gateway service share the /app/data volume, so cron jobs
stored in GATEWAY_CRON_JOBS_PATH are visible to both processes.

Endpoints:
  GET    /api/gateway/cron/jobs          → list all jobs
  POST   /api/gateway/cron/jobs          → create a job
  PUT    /api/gateway/cron/jobs/{id}     → update a job (partial)
  DELETE /api/gateway/cron/jobs/{id}     → delete a job
"""
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

router = APIRouter(prefix="/api/gateway", tags=["gateway"])

_JOBS_PATH = Path(os.environ.get(
    "GATEWAY_CRON_JOBS_PATH",
    "/app/data/gateway/cron_jobs.json",
))

# Valid job ID: alphanumeric + hyphens/underscores, 1-64 chars
_JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")

_VALID_PLATFORMS = {"telegram", "discord", "slack"}


def _load_jobs() -> List[Dict[str, Any]]:
    if not _JOBS_PATH.exists():
        return []
    try:
        data = json.loads(_JOBS_PATH.read_text(encoding="utf-8"))
        return data.get("jobs", [])
    except (json.JSONDecodeError, OSError):
        return []


def _save_jobs(jobs: List[Dict[str, Any]]) -> None:
    _JOBS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _JOBS_PATH.write_text(
        json.dumps({"jobs": jobs}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _find_job(jobs: List[Dict[str, Any]], job_id: str) -> Optional[int]:
    for i, j in enumerate(jobs):
        if j.get("id") == job_id:
            return i
    return None


class CronJobCreate(BaseModel):
    id: Optional[str] = None
    name: str
    prompt: str
    cron: str
    platform: str = "telegram"
    chat_id: Any = ""
    enabled: bool = True

    @field_validator("id")
    @classmethod
    def _validate_id(cls, v):
        if v is None:
            return v
        if not _JOB_ID_RE.match(str(v)):
            raise ValueError(f"Invalid job id: {v!r}")
        return str(v)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v):
        v = str(v).strip()
        if not v:
            raise ValueError("name must not be empty")
        return v[:200]

    @field_validator("prompt")
    @classmethod
    def _validate_prompt(cls, v):
        v = str(v).strip()
        if not v:
            raise ValueError("prompt must not be empty")
        return v[:10_000]

    @field_validator("platform")
    @classmethod
    def _validate_platform(cls, v):
        v = str(v).strip().lower()
        if v not in _VALID_PLATFORMS:
            raise ValueError(f"platform must be one of {sorted(_VALID_PLATFORMS)}")
        return v

    @field_validator("cron")
    @classmethod
    def _validate_cron(cls, v):
        v = str(v).strip()
        if not v:
            raise ValueError("cron must not be empty")
        return v


class CronJobUpdate(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    cron: Optional[str] = None
    platform: Optional[str] = None
    chat_id: Optional[Any] = None
    enabled: Optional[bool] = None


@router.get("/cron/jobs")
async def list_cron_jobs():
    return {"jobs": _load_jobs()}


@router.post("/cron/jobs", status_code=201)
async def create_cron_job(body: CronJobCreate):
    jobs = _load_jobs()

    job_id = body.id or str(uuid.uuid4())[:8]
    if not _JOB_ID_RE.match(job_id):
        job_id = str(uuid.uuid4())[:8]

    if _find_job(jobs, job_id) is not None:
        raise HTTPException(status_code=409, detail=f"Job id {job_id!r} already exists")

    job: Dict[str, Any] = {
        "id": job_id,
        "name": body.name,
        "prompt": body.prompt,
        "cron": body.cron,
        "platform": body.platform,
        "chat_id": body.chat_id,
        "enabled": body.enabled,
    }
    jobs.append(job)
    _save_jobs(jobs)
    return job


@router.put("/cron/jobs/{job_id}")
async def update_cron_job(job_id: str, body: CronJobUpdate):
    if not _JOB_ID_RE.match(job_id):
        raise HTTPException(status_code=400, detail="Invalid job id")

    jobs = _load_jobs()
    idx = _find_job(jobs, job_id)
    if idx is None:
        raise HTTPException(status_code=404, detail="Job not found")

    job = dict(jobs[idx])
    if body.name is not None:
        name = str(body.name).strip()
        if not name:
            raise HTTPException(status_code=400, detail="name must not be empty")
        job["name"] = name[:200]
    if body.prompt is not None:
        prompt = str(body.prompt).strip()
        if not prompt:
            raise HTTPException(status_code=400, detail="prompt must not be empty")
        job["prompt"] = prompt[:10_000]
    if body.cron is not None:
        cron = str(body.cron).strip()
        if not cron:
            raise HTTPException(status_code=400, detail="cron must not be empty")
        job["cron"] = cron
    if body.platform is not None:
        platform = str(body.platform).strip().lower()
        if platform not in _VALID_PLATFORMS:
            raise HTTPException(status_code=400, detail=f"Invalid platform: {platform!r}")
        job["platform"] = platform
    if body.chat_id is not None:
        job["chat_id"] = body.chat_id
    if body.enabled is not None:
        job["enabled"] = body.enabled

    jobs[idx] = job
    _save_jobs(jobs)
    return job


@router.delete("/cron/jobs/{job_id}", status_code=204)
async def delete_cron_job(job_id: str):
    if not _JOB_ID_RE.match(job_id):
        raise HTTPException(status_code=400, detail="Invalid job id")

    jobs = _load_jobs()
    idx = _find_job(jobs, job_id)
    if idx is None:
        raise HTTPException(status_code=404, detail="Job not found")

    jobs.pop(idx)
    _save_jobs(jobs)
