"""
routes/cyberapps_netlab_routes.py
NetLab — packet/protocol playground native Cerberus app.
Stores: labs (custom), progress, snippets, topologies.
All data is scoped to the authenticated user.
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from src.auth_helpers import get_current_user
from src.constants import DATA_DIR

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------

def _user_dir(user: str) -> Path:
    d = Path(DATA_DIR) / "cyberapps" / "netlab" / (user or "default")
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load_json(path: Path, default: Any) -> Any:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("cyberapps_netlab: failed to read %s", path)
    return default


def _save_json(path: Path, data: Any) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class LabCreate(BaseModel):
    id: str
    title: str
    category: str
    vendor: str
    difficulty: int
    description: str
    topology: Optional[str] = None
    steps: List[Dict[str, Any]] = []
    tags: List[str] = []
    createdAt: str
    isBuiltin: bool = False


class ProgressUpdate(BaseModel):
    labId: str
    startedAt: str
    completedAt: Optional[str] = None
    stepResults: Dict[str, Any] = {}
    notes: str = ""
    rating: Optional[int] = None
    bestTimeMs: Optional[int] = None


class SnippetCreate(BaseModel):
    id: str
    title: str
    command: str
    category: str
    description: Optional[str] = None
    variables: Optional[List[str]] = None


class TopologyData(BaseModel):
    topologies: List[Dict[str, Any]]


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------

def setup_cyberapps_netlab_routes() -> APIRouter:
    router = APIRouter(prefix="/api/cyberapps/netlab", tags=["cyberapps-netlab"])

    def _user(request: Request) -> str:
        return get_current_user(request) or "default"

    # --- Labs ----------------------------------------------------------------

    @router.get("/labs")
    def list_labs(request: Request) -> Dict[str, Any]:
        u = _user(request)
        labs = _load_json(_user_dir(u) / "labs.json", [])
        return {"labs": labs}

    @router.post("/labs")
    def create_lab(body: LabCreate, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "labs.json"
        labs: List[Dict] = _load_json(path, [])
        if any(lab["id"] == body.id for lab in labs):
            raise HTTPException(status_code=409, detail="Lab id already exists")
        labs.append(body.model_dump())
        _save_json(path, labs)
        return {"ok": True, "lab": body.model_dump()}

    @router.delete("/labs/{lab_id}")
    def delete_lab(lab_id: str, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "labs.json"
        labs: List[Dict] = _load_json(path, [])
        orig = len(labs)
        labs = [lab for lab in labs if lab["id"] != lab_id]
        if len(labs) == orig:
            raise HTTPException(status_code=404, detail="Lab not found")
        _save_json(path, labs)
        return {"ok": True}

    # --- Progress ------------------------------------------------------------

    @router.get("/progress")
    def get_progress(request: Request) -> Dict[str, Any]:
        u = _user(request)
        prog = _load_json(_user_dir(u) / "progress.json", {})
        return {"progress": prog}

    @router.put("/progress/{lab_id}")
    def update_progress(lab_id: str, body: ProgressUpdate, request: Request) -> Dict[str, Any]:
        u = _user(request)
        if body.labId != lab_id:
            raise HTTPException(status_code=400, detail="labId mismatch")
        path = _user_dir(u) / "progress.json"
        prog: Dict = _load_json(path, {})
        prog[lab_id] = body.model_dump()
        _save_json(path, prog)
        return {"ok": True}

    @router.delete("/progress")
    def reset_progress(request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "progress.json"
        _save_json(path, {})
        return {"ok": True}

    # --- Snippets ------------------------------------------------------------

    @router.get("/snippets")
    def get_snippets(request: Request) -> Dict[str, Any]:
        u = _user(request)
        snippets = _load_json(_user_dir(u) / "snippets.json", [])
        return {"snippets": snippets}

    @router.post("/snippets")
    def save_snippets(request: Request, snippets: List[SnippetCreate]) -> Dict[str, Any]:
        u = _user(request)
        _save_json(_user_dir(u) / "snippets.json", [s.model_dump() for s in snippets])
        return {"ok": True}

    # --- Topologies ----------------------------------------------------------

    @router.get("/topologies")
    def get_topologies(request: Request) -> Dict[str, Any]:
        u = _user(request)
        topos = _load_json(_user_dir(u) / "topologies.json", [])
        return {"topologies": topos}

    @router.put("/topologies")
    def save_topologies(body: TopologyData, request: Request) -> Dict[str, Any]:
        u = _user(request)
        _save_json(_user_dir(u) / "topologies.json", body.topologies)
        return {"ok": True}

    # --- Health --------------------------------------------------------------

    @router.get("")
    def health(request: Request) -> Dict[str, str]:
        return {"status": "ok", "app": "netlab"}

    return router
