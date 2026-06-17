"""Cerberus OS configuration API — identity, profile, projects, agents, briefing, reports."""

from typing import Any, Dict, List, Optional
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, Form, Query, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from src.cerberus_agents import (
    apply_report_action,
    normalize_action,
    reports_for_queue,
    run_agent_action,
    run_agent_message,
    run_council_review,
)
from src.cerberus_briefing_v2 import generate_briefing_v2, load_briefing_settings, save_briefing_settings
from src.cerberus_council import load_council, save_council
from src.cerberus_project_index_v2 import index_all_projects_v2, index_project_v2
from src.cerberus_config import (
    data_dir,
    generate_briefing,
    load_agents,
    load_finance,
    load_pipeline,
    load_profile_bundle,
    load_projects,
    load_reports,
    save_finance,
    save_pipeline,
    save_projects,
)
from src.cerberus_pipeline import apply_action as pipeline_apply_action
from src.cerberus_pipeline import attach_report, create_item
from src.cerberus_project_index import index_all_projects, index_project, load_index, load_summary
from src.cerberus_command_centre import build_command_centre, make_active_project
from src.cerberus_desktop import desktop_apps, desktop_status, queue_desktop_command
from src.cerberus_desktop_intent import classify_confirmation_reply, parse_desktop_intent
from src.cerberus_mount_workspace import bootstrap_workspace_folders, get_workspace_status
from src.cerberus_voice import get_whisper_config, transcribe_audio, whisper_available
from src.cerberus_reasoning_audit import run_reasoning_audit
from src.cerberus_workspace import load_workspace, relink_project, save_workspace, scan_workspace
from src.auth_helpers import get_current_user
from src.upload_limits import read_upload_limited

logger = logging.getLogger(__name__)

CERBERUS_VOICE_MAX_BYTES = 25 * 1024 * 1024
CERBERUS_VOICE_ALLOWED_TYPES = {
    "audio/webm",
    "audio/ogg",
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp4",
    "video/webm",
    "application/ogg",
}
CERBERUS_VOICE_ALLOWED_EXT = {".webm", ".ogg", ".wav", ".m4a", ".mp3", ".mpeg", ".mpga"}


class AgentRunRequest(BaseModel):
    agent_id: str = Field(..., min_length=1, max_length=64)
    action: str = Field(..., min_length=1, max_length=128)
    project_id: Optional[str] = Field(None, max_length=64)


class AgentMessageRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    project_id: Optional[str] = Field(None, max_length=64)
    report_type: Optional[str] = Field(None, max_length=64)


class WorkspaceSaveRequest(BaseModel):
    workspace_root: str = ""
    auto_discover: bool = True
    auto_index_on_scan: bool = False
    workspace_mode: Optional[str] = None


class CeWorkspaceSettingsRequest(BaseModel):
    workspacePath: Optional[str] = None
    workspaceMode: Optional[str] = None
    defaultProjectStorage: Optional[str] = None


class CeSetupCompleteRequest(BaseModel):
    userName: str = Field(..., min_length=1, max_length=128)
    officeName: str = Field(..., min_length=1, max_length=128)
    buildingType: str = "personal"
    aiProvider: str = "local"
    aiModel: str = "gemma"
    workspacePath: Optional[str] = None
    storagePath: Optional[str] = None
    createFirstEmployee: bool = False
    createEmployee: bool = False


class CeOfficeCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""


class CeDepartmentCreateRequest(BaseModel):
    officeId: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""


class CeAgentCreateRequest(BaseModel):
    officeId: str = Field(..., min_length=1, max_length=64)
    departmentId: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=128)


class CeProjectCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    officeId: str = Field(..., min_length=1, max_length=64)
    departmentId: Optional[str] = None
    storageMode: str = "managed"
    linkedPath: Optional[str] = None


class CeMigrateRequest(BaseModel):
    officeName: str = Field(..., min_length=1, max_length=128)
    mode: str = "copy"


class ReportActionRequest(BaseModel):
    action: str = Field(..., min_length=1, max_length=32)


class ProjectIndexRequest(BaseModel):
    project_id: str = Field(..., min_length=1, max_length=64)


class ProjectSaveRequest(BaseModel):
    id: Optional[str] = None
    name: str = Field(..., min_length=1, max_length=128)
    path: str = ""
    description: str = ""
    type: str = "SaaS"
    status: str = "active"
    priority: str = "medium"
    notes: str = ""
    agents_allowed: bool = True
    suggested_next_action: str = ""


class FinanceEntryUpdate(BaseModel):
    id: str
    expected_revenue: Optional[float] = None
    actual_revenue: Optional[float] = None
    costs: Optional[float] = None
    monetisation_strategy: Optional[str] = None
    notes: Optional[str] = None


class GoalPatchRequest(BaseModel):
    title: Optional[str] = None
    type: Optional[str] = None
    current: Optional[float] = None
    target: Optional[float] = None
    currency: Optional[str] = None


class UserSettingsPatchRequest(BaseModel):
    assistant_identity: Optional[str] = None
    voice_gender: Optional[str] = None
    preferred_voice: Optional[str] = None
    preferred_address: Optional[str] = None
    address_style: Optional[str] = None
    theme: Optional[str] = None
    speech_rate: Optional[float] = None
    response_style: Optional[str] = None


class PipelineCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=256)
    source_agent: str = "research"
    source_report_id: Optional[str] = None


class PipelineActionRequest(BaseModel):
    action: str = Field(..., min_length=1, max_length=64)


class DesktopCommandRequest(BaseModel):
    command: str = Field(..., min_length=1, max_length=128)
    args: Dict[str, Any] = Field(default_factory=dict)


class DesktopParseRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=512)
    active_project_id: Optional[str] = Field(None, max_length=64)


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def setup_cerberus_routes() -> APIRouter:
    router = APIRouter(prefix="/api/cerberus", tags=["cerberus-os"])

    @router.get("/profile")
    async def get_cerberus_profile(request: Request):
        get_current_user(request)
        try:
            return load_profile_bundle()
        except Exception as exc:
            logger.exception("[atlas] profile failed: %s", exc)
            return {"identity": {}, "profile": {}}

    @router.get("/workspace")
    async def get_cerberus_workspace(request: Request):
        get_current_user(request)
        ws = load_workspace(data_dir())
        return {
            "ok": True,
            "workspace": ws,
            "status": get_workspace_status(ws),
            "projects": load_projects(),
        }

    @router.post("/workspace")
    async def save_cerberus_workspace(request: Request, body: WorkspaceSaveRequest):
        get_current_user(request)
        ws = load_workspace(data_dir())
        # Docker mount mode: workspace_root stays at /workspace/Projects
        if (ws.get("workspace_mode") or "docker_mount") != "docker_mount":
            ws["workspace_root"] = body.workspace_root.strip()
        ws["auto_discover"] = body.auto_discover
        ws["auto_index_on_scan"] = body.auto_index_on_scan
        saved = save_workspace(data_dir(), ws)
        return {"ok": True, "workspace": saved, "status": get_workspace_status(saved)}

    @router.post("/workspace/bootstrap")
    async def bootstrap_cerberus_workspace(request: Request):
        get_current_user(request)
        from src.cerberus_ce_workspace import ensure_workspace_bootstrap
        result = ensure_workspace_bootstrap()
        ws = load_workspace(data_dir())
        if not ws.get("workspace_host_root_hint"):
            ws["workspace_host_root_hint"] = result.get("root", "")
            ws["workspace_mode"] = "managed"
            save_workspace(data_dir(), ws)
        result["workspace"] = ws
        result["status"] = get_workspace_status(ws)
        return result

    @router.get("/workspace/ce/settings")
    async def get_ce_workspace_settings(request: Request):
        get_current_user(request)
        from src.cerberus_ce_workspace import load_system_settings, get_ce_workspace_status
        return {
            "ok": True,
            "settings": load_system_settings(),
            "status": get_ce_workspace_status(),
        }

    @router.get("/setup/status")
    async def get_cerberus_setup_status(request: Request):
        get_current_user(request)
        try:
            from src.cerberus_ce_workspace import get_ce_setup_status
            return get_ce_setup_status()
        except Exception as exc:
            logger.exception("[atlas] setup status failed")
            return {
                "ok": False,
                "setupComplete": False,
                "workspaceExists": False,
                "settingsExists": False,
                "officeCount": 0,
                "shouldShowWizard": True,
                "workspacePath": "./AtlasWorkspace",
                "needsSetup": True,
                "message": str(exc),
            }

    @router.post("/setup/complete")
    async def complete_cerberus_setup(request: Request, body: CeSetupCompleteRequest):
        get_current_user(request)
        from src.cerberus_ce_workspace import complete_ce_setup
        try:
            return complete_ce_setup(
                user_name=body.userName,
                office_name=body.officeName,
                building_type=body.buildingType,
                ai_provider=body.aiProvider,
                ai_model=body.aiModel,
                workspace_path=body.workspacePath or body.storagePath,
                storage_path=body.storagePath,
                create_first_employee=body.createFirstEmployee or body.createEmployee,
                create_employee=body.createEmployee,
            )
        except Exception as exc:
            logger.exception("[atlas] setup failed")
            return JSONResponse({"ok": False, "message": str(exc)}, status_code=400)

    @router.post("/setup/reset")
    async def reset_cerberus_setup(request: Request):
        get_current_user(request)
        from src.cerberus_ce_workspace import is_cerberus_dev_mode, reset_ce_setup
        if not is_cerberus_dev_mode():
            return JSONResponse(
                {"ok": False, "message": "Setup reset is only available when CERBERUS_DEV_MODE=true"},
                status_code=403,
            )
        return reset_ce_setup()

    @router.post("/storage/backup")
    async def backup_cerberus_storage(request: Request):
        get_current_user(request)
        from src.cerberus_ce_workspace import ensure_workspace_bootstrap, resolve_workspace_root
        root = resolve_workspace_root()
        ensure_workspace_bootstrap(root)
        backup_dir = root / "System" / "Backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        manifest = backup_dir / f"backup-{stamp}.json"
        from src.cerberus_ce_workspace import export_storage_manifest
        import json
        manifest.write_text(json.dumps(export_storage_manifest(root), indent=2), encoding="utf-8")
        return {"ok": True, "message": f"Backup saved to {manifest.name}", "path": str(manifest)}

    @router.get("/storage/export")
    async def export_cerberus_storage(request: Request):
        get_current_user(request)
        from src.cerberus_ce_workspace import export_storage_manifest
        import json
        from fastapi.responses import Response
        payload = export_storage_manifest()
        return Response(
            content=json.dumps(payload, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="atlas-storage-export.json"'},
        )

    @router.post("/storage/import")
    async def import_cerberus_storage(request: Request):
        get_current_user(request)
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"ok": False, "message": "Invalid JSON"}, status_code=400)
        from src.cerberus_ce_workspace import save_system_settings
        settings = body.get("settings") if isinstance(body, dict) else None
        if not isinstance(settings, dict):
            return JSONResponse({"ok": False, "message": "No settings object in import file"}, status_code=400)
        save_system_settings(settings)
        return {"ok": True, "message": "Storage settings imported"}

    @router.put("/workspace/ce/settings")
    async def put_ce_workspace_settings(request: Request, body: CeWorkspaceSettingsRequest):
        get_current_user(request)
        from src.cerberus_ce_workspace import save_system_settings, ensure_workspace_bootstrap, resolve_workspace_root
        patch = body.model_dump(exclude_none=True)
        settings = save_system_settings(patch)
        if patch.get("workspacePath"):
            ensure_workspace_bootstrap(resolve_workspace_root(patch["workspacePath"]))
        ws = load_workspace(data_dir())
        if body.workspaceMode:
            ws["workspace_mode"] = body.workspaceMode
            save_workspace(data_dir(), ws)
        return {"ok": True, "settings": settings, "status": get_workspace_status(ws)}

    @router.post("/workspace/ce/migrate")
    async def migrate_ce_workspace(request: Request, body: CeMigrateRequest):
        get_current_user(request)
        return JSONResponse(
            {"ok": False, "message": "Legacy migration is not available in Community Edition"},
            status_code=410,
        )

    @router.get("/workspace/offices")
    async def list_workspace_offices(request: Request):
        get_current_user(request)
        try:
            from src.cerberus_ce_workspace import load_offices
            return {"ok": True, "offices": load_offices()}
        except Exception as exc:
            logging.getLogger(__name__).exception("list_workspace_offices failed")
            return {"ok": True, "offices": [], "warning": str(exc)}

    @router.post("/workspace/offices")
    async def create_workspace_office(request: Request, body: CeOfficeCreateRequest):
        get_current_user(request)
        from src.cerberus_ce_workspace import create_office
        try:
            office = create_office(body.name, body.description)
            return {"ok": True, "office": office}
        except ValueError as exc:
            return JSONResponse({"ok": False, "message": str(exc)}, status_code=400)

    @router.post("/workspace/departments")
    async def create_workspace_department(request: Request, body: CeDepartmentCreateRequest):
        get_current_user(request)
        from src.cerberus_ce_workspace import create_department
        try:
            dept = create_department(body.officeId, body.name, body.description)
            return {"ok": True, "department": dept}
        except ValueError as exc:
            return JSONResponse({"ok": False, "message": str(exc)}, status_code=400)

    @router.delete("/workspace/offices/{office_id}")
    async def delete_workspace_office(request: Request, office_id: str):
        get_current_user(request)
        from src.cerberus_ce_workspace import delete_office
        result = delete_office(office_id)
        if not result.get("ok"):
            return JSONResponse(result, status_code=404)
        return result

    @router.delete("/workspace/departments/{department_id}")
    async def delete_workspace_department(
        request: Request,
        department_id: str,
        officeId: str = Query(..., min_length=1, max_length=64),
    ):
        get_current_user(request)
        from src.cerberus_ce_workspace import delete_department
        result = delete_department(officeId, department_id)
        if not result.get("ok"):
            return JSONResponse(result, status_code=404)
        return result

    @router.post("/workspace/agents")
    async def create_workspace_agent(request: Request, body: CeAgentCreateRequest):
        get_current_user(request)
        from src.cerberus_ce_workspace import create_agent
        try:
            agent = create_agent(body.officeId, body.departmentId, body.name)
            return {"ok": True, "agent": agent}
        except ValueError as exc:
            return JSONResponse({"ok": False, "message": str(exc)}, status_code=400)

    @router.post("/workspace/projects/create")
    async def create_workspace_project(request: Request, body: CeProjectCreateRequest):
        get_current_user(request)
        from src.cerberus_ce_workspace import create_project
        from src.cerberus_config import load_projects, save_projects
        from src.cerberus_mount_workspace import enrich_project
        try:
            project = create_project(
                body.name,
                body.officeId,
                description=body.description,
                department_id=body.departmentId,
                storage_mode=body.storageMode or "managed",
                linked_path=body.linkedPath,
            )
            ws = load_workspace(data_dir())
            projects = load_projects()
            entry = enrich_project({
                "id": project["id"],
                "name": project["name"],
                "path": project.get("path") or project.get("linkedPath") or "",
                "description": project.get("description", ""),
                "officeId": project.get("officeId"),
                "departmentId": project.get("departmentId"),
                "officeName": project.get("officeName"),
                "storageMode": project.get("storageMode", "managed"),
                "workspacePath": project.get("workspacePath"),
                "linkedPath": project.get("linkedPath"),
                "source": "manual",
                "status": "active",
                "priority": "medium",
                "agents_allowed": True,
                "created_at": project.get("createdAt"),
            }, ws)
            projects.append(entry)
            save_projects(projects)
            return {"ok": True, "project": entry, "projects": projects}
        except ValueError as exc:
            return JSONResponse({"ok": False, "message": str(exc)}, status_code=400)

    @router.post("/workspace/scan")
    async def scan_cerberus_workspace(request: Request):
        get_current_user(request)
        return scan_workspace(data_dir())

    @router.post("/projects/{project_id}/relink")
    async def relink_cerberus_project(project_id: str, request: Request):
        get_current_user(request)
        return relink_project(data_dir(), project_id)

    @router.get("/projects")
    async def get_cerberus_projects(request: Request):
        get_current_user(request)
        return {"projects": load_projects()}

    @router.get("/projects/recent")
    async def get_recent_projects(request: Request):
        get_current_user(request)
        from src.cerberus_projects import get_recent_projects
        projects = get_recent_projects()
        return {"ok": True, "projects": projects}

    @router.get("/projects/{project_id}/context")
    async def get_project_context(project_id: str, request: Request):
        get_current_user(request)
        from src.cerberus_projects import build_project_context
        return build_project_context(project_id)

    @router.post("/projects/{project_id}/pin")
    async def pin_project(project_id: str, request: Request):
        get_current_user(request)
        from src.cerberus_projects import toggle_pin
        return toggle_pin(project_id)

    @router.post("/projects/{project_id}/activity")
    async def project_activity(project_id: str, request: Request):
        get_current_user(request)
        from src.cerberus_projects import record_activity
        try:
            body = await request.json()
        except Exception:
            body = {}
        activity_type = (body.get("type") or "view") if isinstance(body, dict) else "view"
        return record_activity(project_id, activity_type)

    @router.post("/projects")
    async def save_cerberus_project(request: Request, body: ProjectSaveRequest):
        get_current_user(request)
        from src.cerberus_mount_workspace import enrich_project, validate_project_path

        ws = load_workspace(data_dir())
        path = body.path.strip()
        if path and (ws.get("workspace_mode") or "docker_mount") == "docker_mount":
            _, perr = validate_project_path(path, ws)
            if perr:
                return {"ok": False, "message": perr}
        projects = load_projects()
        pid = (body.id or "").strip() or str(uuid.uuid4())[:8]
        entry = {
            "id": pid,
            "name": body.name.strip(),
            "path": path,
            "description": body.description.strip(),
            "type": body.type.strip() or "SaaS",
            "status": body.status.strip() or "active",
            "priority": body.priority.strip() or "medium",
            "notes": body.notes.strip(),
            "agents_allowed": body.agents_allowed,
            "suggested_next_action": body.suggested_next_action.strip(),
            "created_at": _now_iso(),
            "last_indexed_at": None,
            "file_count": 0,
            "recent_changes": {},
            "source": "manual",
            "detected_type": body.type.strip() or "SaaS",
            "detected_stack": [],
            "last_seen_at": None,
            "indexed": False,
        }
        existing = next((i for i, p in enumerate(projects) if p.get("id") == pid), None)
        if existing is not None:
            old = projects[existing]
            entry["created_at"] = old.get("created_at") or entry["created_at"]
            entry["last_indexed_at"] = old.get("last_indexed_at")
            entry["file_count"] = old.get("file_count", 0)
            entry["recent_changes"] = old.get("recent_changes") or {}
            entry["source"] = old.get("source") or "manual"
            entry["detected_type"] = old.get("detected_type")
            entry["detected_stack"] = old.get("detected_stack") or []
            entry["last_seen_at"] = old.get("last_seen_at")
            entry["indexed"] = old.get("indexed", bool(old.get("last_indexed_at")))
            entry = enrich_project(entry, ws)
            projects[existing] = entry
        else:
            entry = enrich_project(entry, ws)
            projects.append(entry)
        save_projects(projects)
        return {"ok": True, "project": entry, "projects": projects}

    @router.post("/projects/index")
    async def index_cerberus_project(request: Request, body: ProjectIndexRequest):
        """Read-only directory scan — metadata only."""
        get_current_user(request)
        projects = load_projects()
        project = next((p for p in projects if p.get("id") == body.project_id), None)
        if not project:
            return {"ok": False, "message": "Project not found"}
        if not project.get("agents_allowed", True):
            return {"ok": False, "message": "Agent indexing disabled for this project"}
        result = index_project(data_dir(), project)
        if not result.get("ok"):
            return result
        for i, p in enumerate(projects):
            if p.get("id") == body.project_id:
                projects[i] = result["project"]
                break
        save_projects(projects)
        return result

    @router.post("/projects/index-all")
    async def index_all_cerberus_projects(request: Request):
        """Read-only batch index for all projects with valid paths."""
        get_current_user(request)
        return index_all_projects(data_dir())

    @router.post("/projects/{project_id}/index-v2")
    async def index_cerberus_project_v2(project_id: str, request: Request):
        """Deep read-only index with safe key-file extracts and V2 summary."""
        owner = get_current_user(request)
        projects = load_projects()
        project = next((p for p in projects if p.get("id") == project_id), None)
        if not project:
            return {"ok": False, "message": "Project not found"}
        if not project.get("agents_allowed", True):
            return {"ok": False, "message": "Agent indexing disabled for this project"}
        result = await index_project_v2(data_dir(), project, owner=owner)
        if not result.get("ok"):
            return result
        for i, p in enumerate(projects):
            if p.get("id") == project_id:
                projects[i] = result["project"]
                break
        save_projects(projects)
        return result

    @router.post("/projects/index-all-v2")
    async def index_all_cerberus_projects_v2(request: Request):
        owner = get_current_user(request)
        return await index_all_projects_v2(data_dir(), owner=owner)

    @router.get("/projects/{project_id}/index")
    async def get_project_index(project_id: str, request: Request):
        get_current_user(request)
        idx = load_index(data_dir(), project_id)
        if not idx:
            return {"ok": False, "message": "No index for this project"}
        return {"ok": True, "index": idx}

    @router.get("/projects/{project_id}/summary")
    async def get_project_summary(project_id: str, request: Request):
        get_current_user(request)
        summary = load_summary(data_dir(), project_id)
        if not summary:
            return {"ok": False, "message": "No summary for this project — index it first"}
        return {"ok": True, "summary": summary}

    @router.get("/finance")
    async def get_cerberus_finance(request: Request):
        get_current_user(request)
        return load_finance()

    @router.get("/finance/personal")
    async def get_personal_finance(request: Request):
        get_current_user(request)
        from src.cerberus_personal_finance import load_personal_finance
        return {"ok": True, "personal": load_personal_finance()}

    @router.get("/finance/overview")
    async def get_finance_overview(request: Request):
        get_current_user(request)
        from src.cerberus_personal_finance import compute_overview, load_personal_finance
        return {
            "ok": True,
            "project_finance": load_finance(),
            "personal": load_personal_finance(),
            "overview": compute_overview(),
        }

    @router.post("/finance/bills")
    async def add_finance_bill(request: Request):
        get_current_user(request)
        from src.cerberus_personal_finance import add_bill
        body = await request.json()
        return add_bill(body if isinstance(body, dict) else {})

    @router.post("/finance/work-log")
    async def add_finance_work_log(request: Request):
        get_current_user(request)
        from src.cerberus_personal_finance import add_work_log
        body = await request.json()
        return add_work_log(body if isinstance(body, dict) else {})

    @router.post("/finance/deductions")
    async def add_finance_deduction(request: Request):
        get_current_user(request)
        from src.cerberus_personal_finance import add_deduction
        body = await request.json()
        return add_deduction(body if isinstance(body, dict) else {})

    @router.get("/goals")
    async def get_cerberus_goals(request: Request):
        get_current_user(request)
        from src.cerberus_goals import load_goals
        data = load_goals()
        return {"ok": True, "goals": data.get("goals") or []}

    @router.post("/goals")
    async def save_cerberus_goals(request: Request):
        get_current_user(request)
        from src.cerberus_goals import load_goals, save_goals
        body = await request.json()
        data = body if isinstance(body, dict) else {}
        if "goals" not in data:
            data = load_goals()
        saved = save_goals(data)
        return {"ok": True, "goals": saved.get("goals") or []}

    @router.patch("/goals/{goal_id}")
    async def patch_cerberus_goal(goal_id: str, request: Request, body: GoalPatchRequest):
        get_current_user(request)
        from src.cerberus_goals import patch_goal
        goal = patch_goal(goal_id, body.model_dump(exclude_unset=True))
        if not goal:
            return JSONResponse({"ok": False, "message": "Goal not found"}, status_code=404)
        return {"ok": True, "goal": goal}

    @router.get("/user-settings")
    async def get_user_settings(request: Request):
        get_current_user(request)
        from src.cerberus_user_settings import load_user_settings
        return {"ok": True, "settings": load_user_settings()}

    @router.patch("/user-settings")
    async def patch_user_settings(request: Request, body: UserSettingsPatchRequest):
        get_current_user(request)
        from src.cerberus_user_settings import patch_user_settings
        settings = patch_user_settings(body.model_dump(exclude_unset=True))
        return {"ok": True, "settings": settings}

    @router.put("/finance")
    async def update_cerberus_finance(request: Request, body: FinanceEntryUpdate):
        get_current_user(request)
        data = load_finance()
        entries = data.get("entries") or []
        found = False
        for e in entries:
            if e.get("id") == body.id:
                if body.expected_revenue is not None:
                    e["expected_revenue"] = body.expected_revenue
                if body.actual_revenue is not None:
                    e["actual_revenue"] = body.actual_revenue
                if body.costs is not None:
                    e["costs"] = body.costs
                if body.monetisation_strategy is not None:
                    e["monetisation_strategy"] = body.monetisation_strategy
                if body.notes is not None:
                    e["notes"] = body.notes
                e["profit_estimate"] = (e.get("actual_revenue") or 0) - (e.get("costs") or 0)
                e["last_updated"] = _now_iso()
                found = True
                break
        if not found:
            return {"ok": False, "message": "Finance entry not found"}
        data["entries"] = entries
        save_finance(data)
        return {"ok": True, "finance": data}

    @router.get("/pipeline")
    async def get_cerberus_pipeline(request: Request):
        get_current_user(request)
        return {"items": load_pipeline()}

    @router.post("/pipeline")
    async def create_pipeline_item(request: Request, body: PipelineCreateRequest):
        get_current_user(request)
        items = load_pipeline()
        item = create_item(
            body.title.strip(),
            source_agent=body.source_agent,
            source_report_id=body.source_report_id,
        )
        items.insert(0, item)
        save_pipeline(items)
        return {"ok": True, "item": item, "items": items}

    @router.post("/pipeline/{item_id}/action")
    async def pipeline_item_action(item_id: str, request: Request, body: PipelineActionRequest):
        owner = get_current_user(request)
        items = load_pipeline()
        item = next((i for i in items if i.get("id") == item_id), None)
        if not item:
            return {"ok": False, "message": "Pipeline item not found"}
        result = pipeline_apply_action(item, body.action)
        if not result.get("ok"):
            return result
        updated = result["item"]
        for i, it in enumerate(items):
            if it.get("id") == item_id:
                items[i] = updated
                break
        save_pipeline(items)
        run_result = None
        if result.get("run_agent_id") and result.get("run_action"):
            run_result = await run_agent_action(
                result["run_agent_id"],
                result["run_action"],
                owner=owner,
            )
            if run_result.get("ok") and run_result.get("report"):
                attach_report(updated, run_result["report"]["id"])
                for i, it in enumerate(items):
                    if it.get("id") == item_id:
                        items[i] = updated
                        break
                save_pipeline(items)
        return {
            **result,
            "items": items,
            "run_result": run_result,
        }

    @router.get("/agents")
    async def get_cerberus_agents(request: Request):
        get_current_user(request)
        return {"agents": load_agents()}

    @router.get("/reports")
    async def get_cerberus_reports(request: Request):
        get_current_user(request)
        queue = reports_for_queue()
        return {
            "reports": queue["all"],
            "queue": {
                "pending": queue["pending"],
                "waiting_for_approval": queue["waiting_for_approval"],
                "completed_today": queue["completed_today"],
            },
        }

    @router.get("/reports/{report_id}")
    async def get_cerberus_report(report_id: str, request: Request):
        get_current_user(request)
        report = next((r for r in load_reports() if r.get("id") == report_id), None)
        if not report:
            return {"ok": False, "message": "Report not found"}
        return {"ok": True, "report": report}

    @router.get("/briefing")
    async def get_cerberus_briefing(request: Request):
        get_current_user(request)
        try:
            return generate_briefing()
        except Exception as exc:
            logger.exception("[atlas] briefing failed: %s", exc)
            return {
                "ok": True,
                "greeting": "Atlas is online.",
                "focus": "",
                "lines": [],
                "spoken": "Atlas is online.",
            }

    @router.get("/briefing/v2")
    async def get_cerberus_briefing_v2(request: Request):
        get_current_user(request)
        try:
            return generate_briefing_v2()
        except Exception as exc:
            logger.exception("[atlas] briefing v2 failed: %s", exc)
            return {
                "ok": True,
                "spoken": "Atlas is online.",
                "visual": {
                    "headline": "Atlas is online",
                    "greeting": "Atlas is online.",
                    "priorities": [],
                    "project_changes": [],
                    "finance": [],
                    "agent_reports": [],
                    "recommendation": "Scan your workspace to get started.",
                    "workspace_mounted": False,
                    "unindexed_count": 0,
                    "indexed_count": 0,
                    "project_count": 0,
                },
                "council_note": "",
            }

    @router.get("/briefing/settings")
    async def get_briefing_settings(request: Request):
        get_current_user(request)
        return {"ok": True, "settings": load_briefing_settings()}

    @router.put("/briefing/settings")
    async def put_briefing_settings(request: Request):
        get_current_user(request)
        body = await request.json()
        patch = body if isinstance(body, dict) else {}
        settings = save_briefing_settings(patch)
        return {"ok": True, "settings": settings}

    @router.get("/council")
    async def get_council(request: Request):
        get_current_user(request)
        return {"ok": True, "council": load_council()}

    @router.post("/council/review/{project_id}")
    async def post_council_review(project_id: str, request: Request):
        owner = get_current_user(request)
        body = {}
        try:
            body = await request.json()
        except Exception:
            pass
        stage = body.get("stage") if isinstance(body, dict) else None
        return await run_council_review(project_id, owner=owner, stage=stage)

    @router.post("/agents/run")
    async def run_cerberus_agent(request: Request, body: AgentRunRequest):
        """Generate an agent report — LLM when available, safe fallback otherwise."""
        owner = get_current_user(request)
        action = normalize_action(body.action)
        result = await run_agent_action(
            body.agent_id,
            action,
            owner=owner,
            project_id=body.project_id,
        )
        return result

    @router.post("/agents/{agent_id}/message")
    async def post_agent_message(agent_id: str, request: Request, body: AgentMessageRequest):
        """Custom user query to an agent — generates a structured report."""
        owner = get_current_user(request)
        result = await run_agent_message(
            agent_id,
            body.message,
            owner=owner,
            project_id=body.project_id,
            report_type=body.report_type,
        )
        return result

    @router.post("/reports/{report_id}/action")
    async def cerberus_report_action(report_id: str, request: Request, body: ReportActionRequest):
        get_current_user(request)
        result = apply_report_action(report_id, body.action)
        if result.get("ok") and body.action == "approve":
            report = result.get("report") or {}
            if report.get("agent_id") == "research":
                items = load_pipeline()
                title = report.get("title") or report.get("summary") or "Approved idea"
                existing = next(
                    (i for i in items if i.get("source_report_id") == report_id),
                    None,
                )
                if not existing:
                    item = create_item(
                        title,
                        source_agent="research",
                        source_report_id=report_id,
                    )
                    items.insert(0, item)
                    save_pipeline(items)
                    result["pipeline_item"] = item
        return result

    def _voice_tmp_dir() -> Path:
        tmp = data_dir() / "tmp_voice"
        tmp.mkdir(parents=True, exist_ok=True)
        return tmp

    def _validate_voice_upload(upload: UploadFile) -> Optional[str]:
        """Return error message if invalid, else None."""
        filename = (upload.filename or "").lower()
        ext = Path(filename).suffix
        content_type = (upload.content_type or "").split(";", 1)[0].strip().lower()
        if ext in CERBERUS_VOICE_ALLOWED_EXT:
            return None
        if content_type in CERBERUS_VOICE_ALLOWED_TYPES:
            return None
        return (
            "Unsupported audio type. Upload webm, ogg, or wav."
        )

    @router.get("/voice/status")
    async def voice_status(request: Request):
        """Report whether local Whisper is available (no model load)."""
        get_current_user(request)
        cfg = get_whisper_config()
        return {
            "ok": True,
            "whisper_available": whisper_available(),
            "model": cfg["model"],
            "device": cfg["device"],
            "compute_type": cfg["compute_type"],
        }

    @router.post("/voice/transcribe")
    async def voice_transcribe(
        request: Request,
        audio: UploadFile = File(...),
        language: str = Form("en"),
    ):
        """Local Whisper transcription for Atlas Voice V2."""
        get_current_user(request)

        type_err = _validate_voice_upload(audio)
        if type_err:
            return JSONResponse(
                status_code=400,
                content={"ok": False, "error": "unsupported_type", "message": type_err},
            )

        audio_bytes = await read_upload_limited(audio, CERBERUS_VOICE_MAX_BYTES, "Audio file")
        if not audio_bytes:
            return JSONResponse(
                status_code=400,
                content={"ok": False, "error": "empty_file", "message": "Empty audio file."},
            )

        ext = Path(audio.filename or "audio.webm").suffix.lower()
        if ext not in CERBERUS_VOICE_ALLOWED_EXT:
            ext = ".webm"

        tmp_path = _voice_tmp_dir() / f"{uuid.uuid4().hex}{ext}"
        try:
            tmp_path.write_bytes(audio_bytes)
            result = transcribe_audio(tmp_path, language=language or "en")
        except Exception as exc:
            logger.error("[atlas-voice] upload transcribe failed: %s", exc, exc_info=True)
            result = {
                "ok": False,
                "error": "transcription_failed",
                "message": f"Transcription failed: {exc}",
            }
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError as exc:
                logger.warning("[atlas-voice] could not delete temp audio %s: %s", tmp_path, exc)

        if not result.get("ok"):
            status = 501 if result.get("error") == "whisper_not_installed" else 500
            return JSONResponse(status_code=status, content=result)
        return result

    @router.get("/projects/{project_id}/command-centre")
    async def get_project_command_centre(project_id: str, request: Request):
        get_current_user(request)
        return build_command_centre(project_id)

    @router.post("/projects/{project_id}/deep-index")
    async def post_project_deep_index(project_id: str, request: Request):
        owner = get_current_user(request)
        projects = load_projects()
        project = next((p for p in projects if p.get("id") == project_id), None)
        if not project:
            return {"ok": False, "message": "Project not found"}
        result = await index_project_v2(data_dir(), project, owner=owner)
        if result.get("ok"):
            for i, p in enumerate(projects):
                if p.get("id") == project_id:
                    projects[i] = result["project"]
                    break
            save_projects(projects)
        return result

    @router.post("/projects/{project_id}/council-review")
    async def post_project_council_review(project_id: str, request: Request):
        owner = get_current_user(request)
        body = {}
        try:
            body = await request.json()
        except Exception:
            pass
        stage = body.get("stage") if isinstance(body, dict) else None
        return await run_council_review(project_id, owner=owner, stage=stage)

    @router.post("/projects/{project_id}/generate-cursor-prompt")
    async def post_generate_cursor_prompt(project_id: str, request: Request):
        owner = get_current_user(request)
        return await run_agent_action("developer", "cursor_prompt", owner=owner, project_id=project_id)

    @router.post("/projects/{project_id}/create-launch-plan")
    async def post_create_launch_plan(project_id: str, request: Request):
        owner = get_current_user(request)
        return await run_agent_action("marketing", "launch_strategy", owner=owner, project_id=project_id)

    @router.post("/projects/{project_id}/make-active")
    async def post_make_active_project(project_id: str, request: Request):
        get_current_user(request)
        return make_active_project(project_id)

    @router.get("/desktop/status")
    async def get_desktop_status(request: Request):
        get_current_user(request)
        return await desktop_status()

    @router.get("/desktop/apps")
    async def get_desktop_apps(request: Request):
        get_current_user(request)
        return await desktop_apps()

    @router.post("/desktop/parse")
    async def post_desktop_parse(request: Request, body: DesktopParseRequest):
        get_current_user(request)
        result = parse_desktop_intent(
            body.text,
            active_project_id=body.active_project_id,
        )
        return {"ok": True, **result}

    @router.post("/desktop/confirm-classify")
    async def post_desktop_confirm_classify(request: Request):
        get_current_user(request)
        try:
            body = await request.json()
        except Exception:
            body = {}
        text = (body.get("text") or "") if isinstance(body, dict) else ""
        return {"ok": True, "result": classify_confirmation_reply(text)}

    @router.post("/desktop/command")
    async def post_desktop_command(request: Request, body: DesktopCommandRequest):
        get_current_user(request)
        return await queue_desktop_command(body.command, body.args)

    @router.get("/desktop/launcher-apps")
    async def get_launcher_apps(request: Request):
        get_current_user(request)
        from src.cerberus_launcher_apps import list_launcher_apps
        return list_launcher_apps()

    @router.post("/desktop/launcher-apps")
    async def post_launcher_app(request: Request):
        get_current_user(request)
        from src.cerberus_launcher_apps import add_launcher_app
        try:
            body = await request.json()
        except Exception:
            body = {}
        return add_launcher_app(body if isinstance(body, dict) else {})

    @router.put("/desktop/launcher-apps/{app_id}")
    async def put_launcher_app(app_id: str, request: Request):
        get_current_user(request)
        from src.cerberus_launcher_apps import update_launcher_app
        try:
            body = await request.json()
        except Exception:
            body = {}
        return update_launcher_app(app_id, body if isinstance(body, dict) else {})

    @router.delete("/desktop/launcher-apps/{app_id}")
    async def delete_launcher_app(app_id: str, request: Request):
        get_current_user(request)
        from src.cerberus_launcher_apps import delete_launcher_app
        return delete_launcher_app(app_id)

    @router.post("/desktop/launcher-apps/{app_id}/test")
    async def test_launcher_app(app_id: str, request: Request):
        get_current_user(request)
        from src.cerberus_launcher_apps import get_app_by_id
        app = get_app_by_id(app_id)
        if not app:
            return {"ok": False, "message": f"App '{app_id}' not found."}
        if not app.get("enabled", True):
            return {"ok": False, "message": f"{app.get('name') or app_id} is disabled."}
        return await queue_desktop_command("open_app", {"app": app_id})

    @router.post("/ce/wipe-personal-data")
    async def post_ce_wipe_personal_data(request: Request):
        get_current_user(request)
        try:
            from src.cerberus_ce_wipe import wipe_all_personal_data
            return wipe_all_personal_data()
        except Exception as exc:
            logger.exception("[atlas] ce wipe failed")
            return JSONResponse({"ok": False, "message": str(exc)}, status_code=500)

    @router.get("/audit/reasoning")
    async def get_reasoning_audit(request: Request):
        get_current_user(request)
        return run_reasoning_audit()

    return router
