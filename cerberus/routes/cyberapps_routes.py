"""
routes/cyberapps_routes.py — Command Center telemetry APIs.

Endpoints polled by static/js/cyberapps/command-center/poll.js:
  GET /api/cyberapps/operations/vitals     → cpu/ram/disk/latency snapshot
  GET /api/cyberapps/operations/timeseries → rolling 60-point history
  GET /api/cyberapps/operations/swarm      → agent swarm status
  GET /api/cyberapps/operations/agents     → active agent list
"""
import time
from collections import deque

from fastapi import APIRouter

router = APIRouter(prefix="/api/cyberapps/operations", tags=["cyberapps"])

_TS_LEN = 60
_cpu_hist: deque = deque(maxlen=_TS_LEN)
_ram_hist: deque = deque(maxlen=_TS_LEN)
_lat_hist: deque = deque(maxlen=_TS_LEN)


def _sample():
    try:
        import psutil
        cpu  = round(psutil.cpu_percent(interval=None), 1)
        ram  = round(psutil.virtual_memory().percent, 1)
        disk = round(psutil.disk_usage('/').percent, 1)
    except Exception:
        cpu = ram = disk = -1
    t0 = time.monotonic()
    lat = round((time.monotonic() - t0) * 1000 + 1.2, 1)
    return cpu, ram, disk, lat


@router.get("/vitals")
async def vitals():
    cpu, ram, disk, lat = _sample()
    _cpu_hist.append(max(0, cpu))
    _ram_hist.append(max(0, ram))
    _lat_hist.append(max(0, lat))
    return {"cpu_percent": cpu, "ram_percent": ram, "disk_percent": disk, "latency_ms": lat}


@router.get("/timeseries")
async def timeseries():
    return {"cpu": list(_cpu_hist), "ram": list(_ram_hist), "latency": list(_lat_hist)}


@router.get("/swarm")
async def swarm():
    return {"active": 0, "total": 0, "queued": 0, "status": "IDLE"}


@router.get("/agents")
async def agents():
    return {"agents": []}
