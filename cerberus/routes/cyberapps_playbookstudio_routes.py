"""
routes/cyberapps_playbookstudio_routes.py
PlaybookStudio — pentesting / engagement playbook builder + runner native Cerberus app.
Stores: playbooks (custom), runs, run-step patches.
All data scoped to the authenticated user.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
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
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Pydantic models
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
    stepType: Optional[str] = None
    mitreTechniqueId: Optional[str] = None
    mitreTechniqueName: Optional[str] = None
    dependsOn: Optional[List[str]] = None
    condition: Optional[StepCondition] = None
    evidence: Optional[List[str]] = None
    noteThread: Optional[List[StepNote]] = None
    # Runtime fields
    status: Optional[str] = None
    completedAt: Optional[str] = None
    startedAt: Optional[str] = None
    operatorNotes: Optional[str] = None


class PlaybookVersion(BaseModel):
    version: str
    savedAt: str
    snapshot: Dict[str, Any]


class PlaybookCreate(BaseModel):
    id: str
    name: str
    description: str = ""
    category: str = "custom"
    tags: List[str] = []
    version: str = "1.0"
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None
    steps: List[PlaybookStepModel] = []
    isBuiltIn: bool = False
    variables: Optional[Dict[str, str]] = None
    versions: Optional[List[PlaybookVersion]] = None


class RunCreate(BaseModel):
    id: str
    playbookId: str
    playbookName: str
    startedAt: str
    targetName: Optional[str] = None
    labName: Optional[str] = None
    steps: List[PlaybookStepModel] = []
    status: str = "running"
    variables: Optional[Dict[str, str]] = None


class RunStepPatch(BaseModel):
    status: Optional[str] = None
    completedAt: Optional[str] = None
    startedAt: Optional[str] = None
    operatorNotes: Optional[str] = None
    evidence: Optional[List[str]] = None
    noteThread: Optional[List[StepNote]] = None


class RunComplete(BaseModel):
    status: str  # completed | abandoned
    completedAt: Optional[str] = None


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------

def setup_cyberapps_playbookstudio_routes() -> APIRouter:
    router = APIRouter(
        prefix="/api/cyberapps/playbookstudio",
        tags=["cyberapps-playbookstudio"],
    )

    def _user(request: Request) -> str:
        return get_current_user(request) or "default"

    # ── Playbooks ─────────────────────────────────────────────────────────────

    @router.get("/playbooks")
    def list_playbooks(request: Request) -> Dict[str, Any]:
        u = _user(request)
        playbooks = _load_json(_user_dir(u) / "playbooks.json", [])
        return {"playbooks": playbooks}

    @router.post("/playbooks")
    def save_playbook(body: PlaybookCreate, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "playbooks.json"
        playbooks: List[Dict] = _load_json(path, [])
        now = _now_iso()

        data = body.model_dump()
        data["updatedAt"] = now
        if not data.get("createdAt"):
            data["createdAt"] = now

        existing_idx = next(
            (i for i, p in enumerate(playbooks) if p["id"] == body.id), None
        )
        if existing_idx is not None:
            # Snapshot current version before overwriting
            old = playbooks[existing_idx]
            old_versions: List[Dict] = old.get("versions") or []
            snap: Dict[str, Any] = {k: v for k, v in old.items() if k != "versions"}
            old_versions.append({
                "version": old.get("version", "1.0"),
                "savedAt": old.get("updatedAt", now),
                "snapshot": snap,
            })
            data["versions"] = old_versions[-50:]  # keep last 50
            playbooks[existing_idx] = data
        else:
            data.setdefault("versions", [])
            playbooks.append(data)

        _save_json(path, playbooks)
        return {"ok": True, "playbook": data}

    @router.delete("/playbooks/{playbook_id}")
    def delete_playbook(playbook_id: str, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "playbooks.json"
        playbooks: List[Dict] = _load_json(path, [])
        orig = len(playbooks)
        playbooks = [p for p in playbooks if p["id"] != playbook_id]
        if len(playbooks) == orig:
            raise HTTPException(status_code=404, detail="Playbook not found")
        _save_json(path, playbooks)
        return {"ok": True}

    @router.post("/playbooks/{playbook_id}/clone")
    def clone_playbook(playbook_id: str, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "playbooks.json"
        playbooks: List[Dict] = _load_json(path, [])
        original = next((p for p in playbooks if p["id"] == playbook_id), None)
        if not original:
            raise HTTPException(status_code=404, detail="Playbook not found")
        now = _now_iso()
        clone = json.loads(json.dumps(original))  # deep copy
        clone["id"] = f"custom-{uuid.uuid4().hex[:12]}"
        clone["name"] = f"{original['name']} (Copy)"
        clone["isBuiltIn"] = False
        clone["createdAt"] = now
        clone["updatedAt"] = now
        clone["versions"] = []
        playbooks.append(clone)
        _save_json(path, playbooks)
        return {"ok": True, "playbook": clone}

    @router.post("/playbooks/{playbook_id}/restore/{version_idx}")
    def restore_version(
        playbook_id: str, version_idx: int, request: Request
    ) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "playbooks.json"
        playbooks: List[Dict] = _load_json(path, [])
        idx = next((i for i, p in enumerate(playbooks) if p["id"] == playbook_id), None)
        if idx is None:
            raise HTTPException(status_code=404, detail="Playbook not found")
        versions = playbooks[idx].get("versions") or []
        if version_idx < 0 or version_idx >= len(versions):
            raise HTTPException(status_code=400, detail="Version index out of range")
        snap = versions[version_idx]["snapshot"]
        snap["id"] = playbook_id
        snap["updatedAt"] = _now_iso()
        snap["versions"] = versions
        playbooks[idx] = snap
        _save_json(path, playbooks)
        return {"ok": True, "playbook": snap}

    # ── Runs ──────────────────────────────────────────────────────────────────

    @router.get("/runs")
    def list_runs(request: Request) -> Dict[str, Any]:
        u = _user(request)
        runs = _load_json(_user_dir(u) / "runs.json", [])
        return {"runs": runs}

    @router.post("/runs")
    def start_run(body: RunCreate, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "runs.json"
        runs: List[Dict] = _load_json(path, [])
        if any(r["id"] == body.id for r in runs):
            raise HTTPException(status_code=409, detail="Run id already exists")
        data = body.model_dump()
        runs.append(data)
        _save_json(path, runs)
        return {"ok": True, "run": data}

    @router.patch("/runs/{run_id}/steps/{step_id}")
    def patch_run_step(
        run_id: str, step_id: str, body: RunStepPatch, request: Request
    ) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "runs.json"
        runs: List[Dict] = _load_json(path, [])
        run_idx = next((i for i, r in enumerate(runs) if r["id"] == run_id), None)
        if run_idx is None:
            raise HTTPException(status_code=404, detail="Run not found")
        run = runs[run_idx]
        step_idx = next(
            (i for i, s in enumerate(run.get("steps", [])) if s["id"] == step_id), None
        )
        if step_idx is None:
            raise HTTPException(status_code=404, detail="Step not found")
        patch = {k: v for k, v in body.model_dump().items() if v is not None}
        run["steps"][step_idx].update(patch)
        runs[run_idx] = run
        _save_json(path, runs)
        return {"ok": True, "run": run}

    @router.patch("/runs/{run_id}/complete")
    def complete_run(run_id: str, body: RunComplete, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "runs.json"
        runs: List[Dict] = _load_json(path, [])
        run_idx = next((i for i, r in enumerate(runs) if r["id"] == run_id), None)
        if run_idx is None:
            raise HTTPException(status_code=404, detail="Run not found")
        runs[run_idx]["status"] = body.status
        runs[run_idx]["completedAt"] = body.completedAt or _now_iso()
        _save_json(path, runs)
        return {"ok": True, "run": runs[run_idx]}

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

    # ── Export ────────────────────────────────────────────────────────────────

    @router.get("/runs/{run_id}/export")
    def export_run(run_id: str, request: Request) -> Dict[str, Any]:
        u = _user(request)
        runs: List[Dict] = _load_json(_user_dir(u) / "runs.json", [])
        run = next((r for r in runs if r["id"] == run_id), None)
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        lines: List[str] = [
            f"# Run Report: {run.get('playbookName', 'Unknown')}",
            f"**Run ID:** {run_id}",
            f"**Started:** {run.get('startedAt', '')}",
            f"**Completed:** {run.get('completedAt', '')}",
            f"**Status:** {run.get('status', '')}",
            "",
        ]
        if run.get("targetName"):
            lines.append(f"**Target:** {run['targetName']}")
        if run.get("labName"):
            lines.append(f"**Lab:** {run['labName']}")
        lines.append("")
        lines.append("## Steps")
        for step in run.get("steps", []):
            status = step.get("status", "todo")
            lines.append(
                f"### {step.get('order', '')}. {step.get('title', '')} [{status}]"
            )
            if step.get("description"):
                lines.append(step["description"])
            if step.get("operatorNotes"):
                lines.append(f"\n**Notes:** {step['operatorNotes']}")
            lines.append("")
        return {"ok": True, "markdown": "\n".join(lines)}

    # ── Health ────────────────────────────────────────────────────────────────

    @router.get("")
    def health(request: Request) -> Dict[str, str]:
        return {"status": "ok", "app": "playbookstudio"}

    return router
