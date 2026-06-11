# routes/cyberapps_networkmap_routes.py
"""NetworkMap — graph persistence routes for the Cerberus native app.

Stores graphs as JSON files under data/cyberapps/networkmap/<user>/.
Each graph is a single <graph_id>.json file matching the NetworkGraph shape
from the original Electron app's shared/types.ts.
"""

import json
import logging
import os
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from src.auth_helpers import get_current_user
from src.constants import DATA_DIR

logger = logging.getLogger(__name__)

_STORE_ROOT = os.path.join(DATA_DIR, "cyberapps", "networkmap")


# ---------------------------------------------------------------------------
# Pydantic models (mirror NetworkGraph / GraphSummary from shared/types.ts)
# ---------------------------------------------------------------------------

class NetworkPort(BaseModel):
    port: int
    protocol: str
    state: str
    service: Optional[str] = None
    product: Optional[str] = None
    version: Optional[str] = None


class VulnEntry(BaseModel):
    ip: str
    cves: List[str]
    severity: str
    description: Optional[str] = None


class NodeSchedule(BaseModel):
    scheduledAt: str
    status: str
    nmapArgs: Optional[str] = None


class NetworkNode(BaseModel):
    id: str
    ip: str
    hostname: Optional[str] = None
    os: Optional[str] = None
    osAccuracy: Optional[int] = None
    macAddress: Optional[str] = None
    status: str
    ports: List[NetworkPort]
    openPortCount: int
    x: float = 0
    y: float = 0
    fx: Optional[float] = None
    fy: Optional[float] = None
    annotation: Optional[str] = None
    vulns: Optional[List[VulnEntry]] = None
    schedule: Optional[NodeSchedule] = None


class NetworkEdge(BaseModel):
    id: str
    source: str
    target: str
    type: str
    label: Optional[str] = None
    service: Optional[str] = None
    protocol: Optional[str] = None
    layer: Optional[int] = None


class GraphMetadata(BaseModel):
    scanDate: Optional[str] = None
    subnet: Optional[str] = None
    importSource: str = "nmap-xml"
    filePath: Optional[str] = None


class NetworkGraph(BaseModel):
    id: str
    name: str
    createdAt: str
    updatedAt: str
    nodes: List[NetworkNode]
    edges: List[NetworkEdge]
    metadata: Optional[GraphMetadata] = None


class GraphSummary(BaseModel):
    id: str
    name: str
    createdAt: str
    nodeCount: int
    edgeCount: int
    importSource: Optional[str] = None


# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------

def _user_dir(user: Optional[str]) -> str:
    """Return (and create) the per-user graph store directory."""
    safe = user or "default"
    # Sanitise: allow only alphanumeric, hyphen, underscore
    safe = "".join(c for c in safe if c.isalnum() or c in "-_")
    if not safe:
        safe = "default"
    path = os.path.join(_STORE_ROOT, safe)
    os.makedirs(path, mode=0o700, exist_ok=True)
    return path


def _graph_path(user: Optional[str], graph_id: str) -> str:
    safe_id = "".join(c for c in graph_id if c.isalnum() or c in "-_")
    if not safe_id:
        raise ValueError("Invalid graph id")
    return os.path.join(_user_dir(user), f"{safe_id}.json")


def _load_graph(user: Optional[str], graph_id: str) -> dict:
    path = _graph_path(user, graph_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Graph not found")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _save_graph(user: Optional[str], data: dict) -> None:
    path = _graph_path(user, data["id"])
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    # 0o600 — owner read/write only
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass  # Windows — best effort


def _list_graphs(user: Optional[str]) -> List[dict]:
    d = _user_dir(user)
    summaries = []
    for fname in os.listdir(d):
        if not fname.endswith(".json"):
            continue
        try:
            with open(os.path.join(d, fname), encoding="utf-8") as f:
                g = json.load(f)
            summaries.append({
                "id":          g.get("id", fname[:-5]),
                "name":        g.get("name", "Untitled"),
                "createdAt":   g.get("createdAt", ""),
                "nodeCount":   len(g.get("nodes", [])),
                "edgeCount":   len(g.get("edges", [])),
                "importSource": (g.get("metadata") or {}).get("importSource"),
            })
        except Exception:
            continue
    summaries.sort(key=lambda s: s["createdAt"], reverse=True)
    return summaries


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------

def setup_networkmap_routes() -> APIRouter:
    router = APIRouter(prefix="/api/cyberapps/networkmap", tags=["cyberapps-networkmap"])

    def _owner(request: Request) -> Optional[str]:
        return get_current_user(request)

    @router.get("/graphs", response_model=List[GraphSummary])
    def list_graphs(request: Request):
        """Return summaries for all saved graphs owned by the current user."""
        user = _owner(request)
        return _list_graphs(user)

    @router.get("/graphs/{graph_id}", response_model=NetworkGraph)
    def get_graph(graph_id: str, request: Request):
        """Return the full graph by id."""
        user = _owner(request)
        data = _load_graph(user, graph_id)
        return data

    @router.post("/graphs", response_model=GraphSummary)
    def save_graph(graph: NetworkGraph, request: Request):
        """Create or overwrite a graph."""
        user = _owner(request)
        data = graph.model_dump()
        data["updatedAt"] = datetime.utcnow().isoformat()
        _save_graph(user, data)
        return {
            "id":          data["id"],
            "name":        data["name"],
            "createdAt":   data["createdAt"],
            "nodeCount":   len(data["nodes"]),
            "edgeCount":   len(data["edges"]),
            "importSource": (data.get("metadata") or {}).get("importSource"),
        }

    @router.delete("/graphs/{graph_id}")
    def delete_graph(graph_id: str, request: Request):
        """Delete a graph by id."""
        user = _owner(request)
        path = _graph_path(user, graph_id)
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Graph not found")
        os.remove(path)
        return {"ok": True}

    return router
