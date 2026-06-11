"""
routes/cyberapps_operations_routes.py

Operations — real-time JARVIS-aesthetic overview of Cerberus + CyberOS.

Endpoints under /api/cyberapps/operations/:
  GET /health        — liveness probe
  GET /vitals        — CPU%, RAM%, disk%, latency_ms, ts
  GET /timeseries    — 60-point rolling buffers: cpu, ram, latency
  GET /swarm         — active/total/queued task counts + status
  GET /agents        — active task list as pseudo-agent rows

Data sources:
  - vitals/timeseries: stdlib resource module (fallback) or psutil if available
  - swarm/agents: core.database.ScheduledTask + TaskRun (already in Cerberus)
  - latency: measured by timing an internal DB query

No WebSockets. Clients poll at 5s (vitals) / 10s (agents) cadence.
psutil is optional — gracefully falls back to stdlib if unavailable.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from src.auth_helpers import get_current_user

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory rolling buffers (60 data points each, ~5-min window at 5s cadence)
# ---------------------------------------------------------------------------
_BUF_SIZE = 60
_cpu_buf: deque = deque(maxlen=_BUF_SIZE)
_ram_buf: deque = deque(maxlen=_BUF_SIZE)
_lat_buf: deque = deque(maxlen=_BUF_SIZE)

# ---------------------------------------------------------------------------
# psutil — optional; falls back to resource/platform stdlib if missing
# ---------------------------------------------------------------------------
try:
    import psutil as _psutil
    _HAS_PSUTIL = True
except ImportError:
    _psutil = None  # type: ignore
    _HAS_PSUTIL = False


def _cpu_percent() -> float:
    """Return CPU usage 0-100. Uses psutil if available, else resource."""
    if _HAS_PSUTIL:
        return float(_psutil.cpu_percent(interval=None))
    try:
        import resource
        usage = resource.getrusage(resource.RUSAGE_SELF)
        # Approximate: user+sys seconds / wall seconds since epoch (rough)
        return min(100.0, (usage.ru_utime + usage.ru_stime) % 100)
    except Exception:
        return -1.0


def _ram_stats() -> Dict[str, float]:
    """Return {percent, used_mb, total_mb}. -1 when unavailable."""
    if _HAS_PSUTIL:
        vm = _psutil.virtual_memory()
        return {
            "percent": round(vm.percent, 1),
            "used_mb": round(vm.used / 1_048_576, 1),
            "total_mb": round(vm.total / 1_048_576, 1),
        }
    return {"percent": -1.0, "used_mb": -1.0, "total_mb": -1.0}


def _disk_percent() -> float:
    """Return disk usage % for root partition. -1 when unavailable."""
    if _HAS_PSUTIL:
        try:
            return round(_psutil.disk_usage("/").percent, 1)
        except Exception:
            return -1.0
    return -1.0


def _measure_latency_ms() -> float:
    """Measure DB round-trip latency in milliseconds."""
    try:
        from core.database import SessionLocal, ScheduledTask
        t0 = time.perf_counter()
        db = SessionLocal()
        try:
            db.query(ScheduledTask).limit(1).all()
        finally:
            db.close()
        return round((time.perf_counter() - t0) * 1000, 1)
    except Exception:
        return -1.0


def _collect_vitals() -> Dict[str, Any]:
    """Gather a single vitals snapshot and push it to ring buffers."""
    cpu = _cpu_percent()
    ram = _ram_stats()
    disk = _disk_percent()
    lat = _measure_latency_ms()
    ts = datetime.now(timezone.utc).isoformat()

    _cpu_buf.append(round(cpu, 1))
    _ram_buf.append(round(ram["percent"], 1))
    _lat_buf.append(round(lat, 1))

    return {
        "cpu_percent": round(cpu, 1),
        "ram_percent": ram["percent"],
        "ram_used_mb": ram["used_mb"],
        "ram_total_mb": ram["total_mb"],
        "disk_percent": disk,
        "latency_ms": lat,
        "ts": ts,
        "psutil_available": _HAS_PSUTIL,
    }


def _swarm_data(user: str | None) -> Dict[str, Any]:
    """Count tasks by status from DB, scoped to user."""
    try:
        from core.database import SessionLocal, ScheduledTask, TaskRun
        db = SessionLocal()
        try:
            q = db.query(ScheduledTask)
            if user:
                q = q.filter(ScheduledTask.owner == user)
            all_tasks = q.all()
            total = len(all_tasks)
            active = sum(1 for t in all_tasks if t.status == "active")
            paused = sum(1 for t in all_tasks if t.status == "paused")

            # Running = tasks with a queued/running TaskRun
            rq = db.query(TaskRun).filter(
                TaskRun.status.in_(("running", "queued"))
            )
            if user:
                rq = rq.join(ScheduledTask, TaskRun.task_id == ScheduledTask.id).filter(
                    ScheduledTask.owner == user
                )
            running_runs = rq.count()

            status = "ACTIVE" if running_runs > 0 else ("IDLE" if active > 0 else "OFFLINE")
            return {
                "active": active,
                "total": total,
                "queued": running_runs,
                "paused": paused,
                "status": status,
            }
        finally:
            db.close()
    except Exception as e:
        logger.warning("operations swarm_data failed: %s", e)
        return {"active": 0, "total": 0, "queued": 0, "paused": 0, "status": "DEGRADED"}


def _agents_data(user: str | None) -> List[Dict[str, Any]]:
    """Return active-ish task rows as pseudo-agent entries."""
    try:
        from core.database import SessionLocal, ScheduledTask, TaskRun
        db = SessionLocal()
        try:
            # Grab tasks that are active or have a recent run
            q = db.query(ScheduledTask).filter(
                ScheduledTask.status.in_(("active", "paused"))
            )
            if user:
                q = q.filter(ScheduledTask.owner == user)
            tasks = q.order_by(ScheduledTask.updated_at.desc()).limit(20).all()

            # Get running/queued run statuses
            running_ids: set = set()
            run_q = db.query(TaskRun).filter(TaskRun.status.in_(("running", "queued")))
            for run in run_q.all():
                running_ids.add(run.task_id)

            result = []
            for t in tasks:
                is_running = t.id in running_ids
                row = {
                    "id": t.id,
                    "type": t.task_type or "llm",
                    "name": t.name or "Unnamed Task",
                    "status": "running" if is_running else ("active" if t.status == "active" else "standby"),
                    "current_action": _action_label(t, is_running),
                    "score": _score(t),
                    "action": t.action,
                }
                result.append(row)
            return result
        finally:
            db.close()
    except Exception as e:
        logger.warning("operations agents_data failed: %s", e)
        return []


def _action_label(task: Any, is_running: bool) -> str:
    """Human-readable action label for a task."""
    if is_running:
        return f"executing {task.task_type or 'task'}"
    if task.action:
        return task.action.replace("_", " ")
    if task.schedule:
        return f"scheduled {task.schedule}"
    return "standby"


def _score(task: Any) -> int:
    """Synthetic health score 0-100 based on run_count and status."""
    base = 70 if task.status == "active" else 40
    runs = getattr(task, "run_count", 0) or 0
    return min(100, base + min(30, runs * 2))


# ---------------------------------------------------------------------------
# Router setup
# ---------------------------------------------------------------------------

def _council_data(user: str | None) -> Dict[str, Any]:
    """Return CrewMember list as council agents."""
    try:
        from core.database import SessionLocal as _SL, CrewMember
        db = _SL()
        try:
            q = db.query(CrewMember)
            if user:
                q = q.filter(CrewMember.owner == user)
            members = q.order_by(CrewMember.sort_order, CrewMember.name).all()
            return {
                "members": [
                    {
                        "id": m.id,
                        "name": m.name,
                        "model": m.model or "—",
                        "is_active": bool(m.is_active),
                        "is_default_assistant": bool(m.is_default_assistant),
                        "status": "active" if m.is_active else "standby",
                    }
                    for m in members
                ],
                "toggle_supported": True,
            }
        finally:
            db.close()
    except Exception as e:
        logger.warning("operations council_data failed: %s", e)
        return {"members": [], "toggle_supported": False}


def setup_cyberapps_operations_routes() -> APIRouter:
    router = APIRouter(tags=["cyberapps-operations"])

    @router.get("/api/cyberapps/operations/health")
    def operations_health(request: Request):
        get_current_user(request)
        return JSONResponse({"ok": True, "ts": datetime.now(timezone.utc).isoformat()})

    @router.get("/api/cyberapps/operations/vitals")
    def operations_vitals(request: Request):
        get_current_user(request)
        return JSONResponse(_collect_vitals())

    @router.get("/api/cyberapps/operations/timeseries")
    def operations_timeseries(request: Request):
        get_current_user(request)
        return JSONResponse({
            "cpu": list(_cpu_buf),
            "ram": list(_ram_buf),
            "latency": list(_lat_buf),
            "size": _BUF_SIZE,
        })

    @router.get("/api/cyberapps/operations/swarm")
    def operations_swarm(request: Request):
        user = get_current_user(request)
        return JSONResponse(_swarm_data(user))

    @router.get("/api/cyberapps/operations/agents")
    def operations_agents(request: Request):
        user = get_current_user(request)
        return JSONResponse({"agents": _agents_data(user)})

    @router.get("/api/cyberapps/operations/council")
    def operations_council(request: Request):
        user = get_current_user(request)
        return JSONResponse(_council_data(user))

    @router.patch("/api/cyberapps/operations/council/{member_id}")
    async def operations_council_toggle(member_id: str, request: Request):
        user = get_current_user(request)
        body = await request.json()
        is_active = bool(body.get("is_active", True))
        try:
            from core.database import SessionLocal as _SL, CrewMember
            db = _SL()
            try:
                q = db.query(CrewMember).filter(CrewMember.id == member_id)
                if user:
                    q = q.filter(CrewMember.owner == user)
                member = q.first()
                if not member:
                    from fastapi import HTTPException
                    raise HTTPException(404, "Crew member not found")
                member.is_active = is_active
                db.commit()
                return JSONResponse({"ok": True, "is_active": is_active})
            finally:
                db.close()
        except Exception as e:
            logger.warning("council toggle failed: %s", e)
            from fastapi import HTTPException
            raise HTTPException(500, str(e))

    return router
