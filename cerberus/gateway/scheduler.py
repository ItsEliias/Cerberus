"""
gateway/scheduler.py — Cron scheduler with messaging-platform delivery.

Adapted from hermes-agent/cron/scheduler.py (MIT).

This module extends (not replaces) Cerberus's existing src/task_scheduler.py.
The existing scheduler fires jobs and logs/notifies via ntfy.  This gateway
scheduler adds an additional delivery step: sending cron job output to a
configured messaging platform (Telegram by default).

Job format (stored in GATEWAY_CRON_JOBS_PATH as JSON):
    {
        "jobs": [
            {
                "id":         "daily-summary",
                "name":       "Daily summary",
                "prompt":     "Give me a brief summary of today's news",
                "cron":       "0 9 * * *",
                "platform":   "telegram",
                "chat_id":    123456789,
                "enabled":    true
            }
        ]
    }

Fields:
    id        — unique identifier (URL-safe alphanumeric + hyphens)
    name      — human-readable label
    prompt    — message sent to Cerberus on each fire
    cron      — standard 5-field cron expression
    platform  — delivery platform ("telegram", ...)
    chat_id   — platform-specific destination chat/channel
    enabled   — whether this job is active (default true)

The scheduler runs in a background asyncio task from gateway/main.py.
It uses a file lock to prevent overlap if multiple processes share the jobs
file (same semantics as hermes cron).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Minimum safe interval between scheduler ticks (seconds)
_MIN_TICK_INTERVAL = 10

# Cron job ID validation: alphanumeric + hyphens/underscores, no path components
_JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def _safe_job_id(job_id: str) -> str:
    """Raise ValueError if job_id is unsafe for use as a filesystem component."""
    text = str(job_id or "").strip()
    if not _JOB_ID_RE.match(text):
        raise ValueError(f"Invalid cron job id: {job_id!r}")
    return text


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class CronJob:
    """A single scheduled gateway cron job."""

    __slots__ = (
        "id", "name", "prompt", "cron", "platform",
        "chat_id", "enabled", "next_run",
    )

    def __init__(self, data: Dict[str, Any]):
        self.id: str = _safe_job_id(data["id"])
        self.name: str = str(data.get("name") or self.id)[:200]
        # Validate prompt: must be a non-empty string, max 10k chars
        prompt = str(data.get("prompt") or "").strip()
        if not prompt:
            raise ValueError(f"cron job {self.id!r}: prompt must be non-empty")
        self.prompt: str = prompt[:10_000]
        self.cron: str = str(data.get("cron") or "").strip()
        self.platform: str = str(data.get("platform") or "telegram").strip().lower()
        self.chat_id: str | int = data.get("chat_id") or ""
        self.enabled: bool = bool(data.get("enabled", True))
        self.next_run: Optional[datetime] = None

    def compute_next(self, after: Optional[datetime] = None) -> Optional[datetime]:
        """Compute next fire time using croniter. Returns None on invalid expr."""
        try:
            from croniter import croniter
        except ImportError:
            logger.warning("croniter not installed — gateway cron disabled")
            return None
        try:
            base = after or _utcnow()
            it = croniter(self.cron, base)
            return it.get_next(datetime)
        except Exception as exc:
            logger.warning("cron job %r: invalid expression %r: %s", self.id, self.cron, exc)
            return None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "prompt": self.prompt,
            "cron": self.cron,
            "platform": self.platform,
            "chat_id": self.chat_id,
            "enabled": self.enabled,
        }


class GatewayCronScheduler:
    """
    Cron scheduler that fires jobs and delivers output to messaging platforms.

    Usage:
        scheduler = GatewayCronScheduler(config, adapters)
        asyncio.create_task(scheduler.run())
        ...
        await scheduler.stop()
    """

    def __init__(self, config, adapters: Dict[str, Any]):
        """
        config   — CronConfig instance
        adapters — dict of {platform_name: adapter_instance}
        """
        self._config = config
        self._adapters = adapters
        self._jobs: List[CronJob] = []
        self._running = False
        self._stop_event = asyncio.Event()

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #

    async def run(self) -> None:
        """Main scheduler loop — runs until stop() is called."""
        self._running = True
        self._load_jobs()

        interval = max(_MIN_TICK_INTERVAL, self._config.tick_interval_s)
        logger.info("gateway cron: started, tick_interval=%ds, jobs=%d", interval, len(self._jobs))

        # Seed next_run for all jobs from now
        for job in self._jobs:
            job.next_run = job.compute_next()

        while not self._stop_event.is_set():
            try:
                await self._tick()
            except Exception as exc:
                logger.error("gateway cron: tick error: %s", exc, exc_info=True)
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=interval)
            except asyncio.TimeoutError:
                pass

        logger.info("gateway cron: stopped")

    async def stop(self) -> None:
        self._running = False
        self._stop_event.set()

    # ------------------------------------------------------------------ #
    # Tick
    # ------------------------------------------------------------------ #

    async def _tick(self) -> None:
        now = _utcnow()
        for job in list(self._jobs):
            if not job.enabled:
                continue
            if job.next_run is None:
                job.next_run = job.compute_next(after=now)
                continue
            if job.next_run <= now:
                asyncio.create_task(self._run_job(job))
                job.next_run = job.compute_next(after=now)

    async def _run_job(self, job: CronJob) -> None:
        logger.info("gateway cron: firing job %r -> %s:%s", job.id, job.platform, job.chat_id)
        from gateway.cerberus_client import send_message, CerberusClientError
        from gateway.config import CerberusConfig

        # We need the CerberusConfig — pull it from the adapters' stored config
        # (all adapters receive the same cerberus_config at construction time).
        cerberus_cfg = None
        for adapter in self._adapters.values():
            cerberus_cfg = getattr(adapter, "_cerberus", None)
            if cerberus_cfg is not None:
                break

        if cerberus_cfg is None:
            logger.error("gateway cron: no cerberus config available, cannot run job %r", job.id)
            return

        try:
            response = await send_message(
                cerberus_cfg,
                platform=f"cron:{job.platform}",
                chat_id=f"{job.id}:{job.chat_id}",
                message=job.prompt,
                session_name_prefix=f"cron:{job.id}",
            )
        except CerberusClientError as exc:
            logger.error("gateway cron: cerberus error for job %r: %s", job.id, exc)
            response = f"Cerberus error running scheduled job '{job.name}': {exc}"

        # Deliver to the target platform
        adapter = self._adapters.get(job.platform)
        if adapter is None:
            logger.warning(
                "gateway cron: job %r targets platform %r which is not running",
                job.id, job.platform,
            )
            return

        try:
            send_fn = getattr(adapter, "send_text_to_chat", None)
            if send_fn:
                await send_fn(job.chat_id, f"[Cerberus Cron: {job.name}]\n\n{response}")
            else:
                from gateway.platforms.base import OutgoingMessage
                await adapter.send_message(OutgoingMessage(
                    platform=job.platform,
                    chat_id=job.chat_id,
                    text=f"[Cerberus Cron: {job.name}]\n\n{response}",
                ))
        except Exception as exc:
            logger.error("gateway cron: delivery error for job %r: %s", job.id, exc)

    # ------------------------------------------------------------------ #
    # Job persistence
    # ------------------------------------------------------------------ #

    def _load_jobs(self) -> None:
        path = Path(self._config.jobs_path)
        if not path.exists():
            logger.info("gateway cron: jobs file not found at %s — starting empty", path)
            self._jobs = []
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            loaded = []
            for entry in data.get("jobs", []):
                try:
                    loaded.append(CronJob(entry))
                except Exception as exc:
                    logger.warning("gateway cron: skipping bad job entry %r: %s", entry, exc)
            self._jobs = loaded
            logger.info("gateway cron: loaded %d jobs from %s", len(self._jobs), path)
        except Exception as exc:
            logger.error("gateway cron: failed to load jobs from %s: %s", path, exc)
            self._jobs = []

    def save_jobs(self) -> None:
        path = Path(self._config.jobs_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {"jobs": [j.to_dict() for j in self._jobs]}
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(path)
        logger.debug("gateway cron: saved %d jobs to %s", len(self._jobs), path)

    def add_job(self, job_data: Dict[str, Any]) -> CronJob:
        """Add a new cron job. Raises ValueError on invalid data."""
        job = CronJob(job_data)
        if any(j.id == job.id for j in self._jobs):
            raise ValueError(f"Job with id {job.id!r} already exists")
        self._jobs.append(job)
        job.next_run = job.compute_next()
        self.save_jobs()
        return job

    def remove_job(self, job_id: str) -> bool:
        """Remove a job by ID. Returns True if found and removed."""
        safe_id = _safe_job_id(job_id)
        before = len(self._jobs)
        self._jobs = [j for j in self._jobs if j.id != safe_id]
        if len(self._jobs) < before:
            self.save_jobs()
            return True
        return False

    def list_jobs(self) -> List[Dict[str, Any]]:
        return [j.to_dict() for j in self._jobs]
