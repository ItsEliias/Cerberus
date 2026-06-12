"""
System vitals endpoints — live psutil snapshot + rolling 60-point timeseries.

Consumed by the Command Center hero globe / dials / sparklines (poll.js) and the
Phase D home dashboard (dashboard.js) to render real CPU/RAM/Disk numbers
instead of placeholder dashes.

No auth bypass: every endpoint requires a logged-in user — vitals are operator-
sensitive (reveal host load patterns).
"""

from __future__ import annotations

import time
from collections import deque
from typing import Any, Deque, Dict

import psutil
from fastapi import APIRouter, Request

from src.auth_helpers import get_current_user

# Rolling ring buffers, 60 points each (~5 minutes at 5-second cadence).
# Process-local in-memory; resets on container restart by design.
_RING_LEN = 60
_ts_cpu: Deque[float]     = deque(maxlen=_RING_LEN)
_ts_ram: Deque[float]     = deque(maxlen=_RING_LEN)
_ts_disk: Deque[float]    = deque(maxlen=_RING_LEN)
_ts_latency: Deque[float] = deque(maxlen=_RING_LEN)
_ts_t: Deque[float]       = deque(maxlen=_RING_LEN)

# Pre-warm one cpu_percent reading so subsequent calls return a real delta
# rather than the lifetime average (psutil quirk).
psutil.cpu_percent(interval=None)


def _snapshot() -> Dict[str, Any]:
    """Read current vitals + append to ring buffers. Returns the new sample."""
    t0 = time.perf_counter()
    cpu = psutil.cpu_percent(interval=None)
    vm = psutil.virtual_memory()
    du = psutil.disk_usage("/")
    latency_ms = (time.perf_counter() - t0) * 1000  # rough self-measurement
    ts = time.time()

    _ts_cpu.append(cpu)
    _ts_ram.append(vm.percent)
    _ts_disk.append(du.percent)
    _ts_latency.append(latency_ms)
    _ts_t.append(ts)

    return {
        "ts": ts,
        "cpu_percent": cpu,
        "ram_percent": vm.percent,
        "ram_used_mb": vm.used // (1024 * 1024),
        "ram_total_mb": vm.total // (1024 * 1024),
        "disk_percent": du.percent,
        "disk_used_gb": du.used // (1024 ** 3),
        "disk_total_gb": du.total // (1024 ** 3),
        "latency_ms": round(latency_ms, 2),
    }


def setup_system_vitals_routes() -> APIRouter:
    router = APIRouter()

    @router.get("/api/system/vitals")
    async def vitals(request: Request) -> Dict[str, Any]:
        get_current_user(request)  # 401 if unauthenticated
        return _snapshot()

    @router.get("/api/system/timeseries")
    async def timeseries(request: Request) -> Dict[str, Any]:
        get_current_user(request)
        # Snapshot once so the buffer is never empty on first call
        if not _ts_t:
            _snapshot()
        return {
            "ts": list(_ts_t),
            "cpu": list(_ts_cpu),
            "ram": list(_ts_ram),
            "disk": list(_ts_disk),
            "latency": list(_ts_latency),
            "length": len(_ts_t),
            "max_length": _RING_LEN,
        }

    return router
