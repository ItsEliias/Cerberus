"""
routes/cyberapps_playbookstudio_routes.py
PlaybookStudio — VAPT playbook builder and runner (CyberOS native app).
Stores: playbooks (custom + versioned), runs, run-steps.
All data is scoped to the authenticated user.
"""

import json
import logging
import uuid
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
    d = Path(DATA_DIR) / "cyberapps" / "playbookstudio" / (user or "default")
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load_json(path: Path, default: Any) -> Any:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("cyberapps_playbookstudio: failed to read %s", path)
    return default


def _save_json(path: Path, data: Any) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class StepCondition(BaseModel):
    variableKey: str
    operator: str  # equals | not_equals | contains
    value: str
    skipStepIds: List[str] = []


class StepNote(BaseModel):
    id: str
    text: str
    createdAt: str


class PlaybookStepModel(BaseModel):
    id: str
    order: int
    title: str
    description: str
    category: str
    commands: List[str] = []
    notes: str = ""
    required: bool = True
    dependsOn: Optional[List[str]] = None
    condition: Optional[StepCondition] = None
    mitreTechniqueId: Optional[str] = None
    mitreTechniqueName: Optional[str] = None
    stepType: Optional[str] = "action"
    status: Optional[str] = None
    completedAt: Optional[str] = None
    startedAt: Optional[str] = None
    operatorNotes: Optional[str] = None
    evidence: Optional[List[str]] = None
    noteThread: Optional[List[StepNote]] = None


class PlaybookVersion(BaseModel):
    version: str
    savedAt: str
    snapshot: Dict[str, Any]


class PlaybookCreate(BaseModel):
    id: str
    name: str
    description: str
    category: str
    tags: List[str] = []
    version: str = "1.0"
    createdAt: str
    updatedAt: str
    isBuiltIn: bool = False
    variables: Optional[Dict[str, str]] = None
    steps: List[PlaybookStepModel] = []
    versions: Optional[List[Dict[str, Any]]] = None


class RunCreate(BaseModel):
    id: str
    playbookId: str
    playbookName: str
    startedAt: str
    status: str = "running"
    variables: Optional[Dict[str, str]] = None
    steps: List[PlaybookStepModel] = []
    completedAt: Optional[str] = None
    targetName: Optional[str] = None
    labName: Optional[str] = None


class RunStepPatch(BaseModel):
    status: Optional[str] = None
    operatorNotes: Optional[str] = None
    startedAt: Optional[str] = None
    completedAt: Optional[str] = None
    evidence: Optional[List[str]] = None
    noteThread: Optional[List[Dict[str, Any]]] = None


class RunComplete(BaseModel):
    status: str  # completed | abandoned
    completedAt: str


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------

def setup_cyberapps_playbookstudio_routes() -> APIRouter:
    router = APIRouter(prefix="/api/cyberapps/playbookstudio", tags=["cyberapps-playbookstudio"])

    def _user(request: Request) -> str:
        return get_current_user(request) or "default"

    # --- Playbooks -----------------------------------------------------------

    @router.get("/playbooks")
    def list_playbooks(request: Request) -> Dict[str, Any]:
        u = _user(request)
        pbs = _load_json(_user_dir(u) / "playbooks.json", [])
        return {"playbooks": pbs}

    @router.post("/playbooks")
    def upsert_playbook(body: PlaybookCreate, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "playbooks.json"
        pbs: List[Dict] = _load_json(path, [])
        existing_idx = next((i for i, p in enumerate(pbs) if p["id"] == body.id), None)
        pb_dict = body.model_dump()
        if existing_idx is not None:
            old = pbs[existing_idx]
            versions = old.get("versions") or []
            if len(versions) >= 50:
                versions = versions[-49:]
            snap = {k: v for k, v in old.items() if k != "versions"}
            versions.append({"version": old.get("version", "1.0"), "savedAt": old.get("updatedAt", ""), "snapshot": snap})
            pb_dict["versions"] = versions
            pbs[existing_idx] = pb_dict
        else:
            pb_dict.setdefault("versions", [])
            pbs.append(pb_dict)
        _save_json(path, pbs)
        return {"ok": True, "playbook": pb_dict}

    @router.delete("/playbooks/{playbook_id}")
    def delete_playbook(playbook_id: str, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "playbooks.json"
        pbs: List[Dict] = _load_json(path, [])
        orig = len(pbs)
        pbs = [p for p in pbs if p["id"] != playbook_id]
        if len(pbs) == orig:
            raise HTTPException(status_code=404, detail="Playbook not found")
        _save_json(path, pbs)
        return {"ok": True}

    @router.post("/playbooks/{playbook_id}/clone")
    def clone_playbook(playbook_id: str, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "playbooks.json"
        pbs: List[Dict] = _load_json(path, [])
        src = next((p for p in pbs if p["id"] == playbook_id), None)
        if not src:
            raise HTTPException(status_code=404, detail="Playbook not found")
        cloned = {**src, "id": f"{playbook_id}-copy-{uuid.uuid4().hex[:8]}",
                  "name": f"{src['name']} (Copy)", "isBuiltIn": False, "versions": []}
        pbs.append(cloned)
        _save_json(path, pbs)
        return {"ok": True, "playbook": cloned}

    @router.post("/playbooks/{playbook_id}/restore/{version_idx}")
    def restore_version(playbook_id: str, version_idx: int, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "playbooks.json"
        pbs: List[Dict] = _load_json(path, [])
        idx = next((i for i, p in enumerate(pbs) if p["id"] == playbook_id), None)
        if idx is None:
            raise HTTPException(status_code=404, detail="Playbook not found")
        versions = pbs[idx].get("versions", [])
        if version_idx < 0 or version_idx >= len(versions):
            raise HTTPException(status_code=400, detail="Invalid version index")
        snapshot = versions[version_idx]["snapshot"]
        pbs[idx] = {**snapshot, "id": playbook_id, "versions": versions}
        _save_json(path, pbs)
        return {"ok": True, "playbook": pbs[idx]}

    # --- Runs ----------------------------------------------------------------

    @router.get("/runs")
    def list_runs(request: Request) -> Dict[str, Any]:
        u = _user(request)
        runs = _load_json(_user_dir(u) / "runs.json", [])
        return {"runs": runs}

    @router.post("/runs")
    def create_run(body: RunCreate, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "runs.json"
        runs: List[Dict] = _load_json(path, [])
        if any(r["id"] == body.id for r in runs):
            raise HTTPException(status_code=409, detail="Run id already exists")
        run_dict = body.model_dump()
        runs.append(run_dict)
        _save_json(path, runs)
        return {"ok": True, "run": run_dict}

    @router.patch("/runs/{run_id}/steps/{step_id}")
    def patch_run_step(run_id: str, step_id: str, body: RunStepPatch, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "runs.json"
        runs: List[Dict] = _load_json(path, [])
        run = next((r for r in runs if r["id"] == run_id), None)
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        step = next((s for s in run.get("steps", []) if s["id"] == step_id), None)
        if not step:
            raise HTTPException(status_code=404, detail="Step not found")
        patch = {k: v for k, v in body.model_dump().items() if v is not None}
        step.update(patch)
        _save_json(path, runs)
        return {"ok": True}

    @router.patch("/runs/{run_id}/complete")
    def complete_run(run_id: str, body: RunComplete, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "runs.json"
        runs: List[Dict] = _load_json(path, [])
        run = next((r for r in runs if r["id"] == run_id), None)
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        run["status"] = body.status
        run["completedAt"] = body.completedAt
        _save_json(path, runs)
        return {"ok": True}

    @router.delete("/runs/{run_id}")
    def delete_run(run_id: str, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "runs.json"
        runs: List[Dict] = _load_json(path, [])
        orig = len(runs)
        runs = [r for r in runs if r["id"] != run_id]
        if len(runs) == orig:
            raise HTTPException(status_code=404, detail="Run not found")
        _save_json(path, runs)
        return {"ok": True}

    @router.get("/runs/{run_id}/export")
    def export_run(run_id: str, request: Request) -> Dict[str, Any]:
        u = _user(request)
        runs: List[Dict] = _load_json(_user_dir(u) / "runs.json", [])
        run = next((r for r in runs if r["id"] == run_id), None)
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        md = _build_markdown(run)
        return {"ok": True, "markdown": md}

    # --- Health --------------------------------------------------------------

    @router.get("")
    def health(request: Request) -> Dict[str, str]:
        return {"status": "ok", "app": "playbookstudio"}

    return router


def _build_markdown(run: Dict) -> str:
    done = sum(1 for s in run.get("steps", []) if s.get("status") == "done")
    skipped = sum(1 for s in run.get("steps", []) if s.get("status") == "skipped")
    total = len(run.get("steps", []))
    lines = [
        f"# {run.get('playbookName', 'Run')} — Run Report",
        "",
        f"**Status:** {run.get('status', '')}  ",
        f"**Started:** {run.get('startedAt', '')}  ",
        f"**Completed:** {run.get('completedAt', 'N/A')}  ",
        f"**Steps:** {done} done, {skipped} skipped, {total} total",
        "",
    ]
    if run.get("variables"):
        lines += ["## Variables", ""]
        for k, v in run["variables"].items():
            lines.append(f"- **{k}**: {v}")
        lines.append("")
    lines += ["## Steps", ""]
    for i, s in enumerate(run.get("steps", []), 1):
        lines.append(f"### {i}. {s.get('title', '')} [{s.get('status', 'todo')}]")
        lines.append("")
        if s.get("description"):
            lines.append(s["description"])
            lines.append("")
        if s.get("commands"):
            lines.append("```")
            lines.extend(s["commands"])
            lines.append("```")
            lines.append("")
        if s.get("operatorNotes"):
            lines.append(f"**Notes:** {s['operatorNotes']}")
            lines.append("")
    return "\n".join(lines)
