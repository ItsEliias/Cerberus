"""
routes/cyberapps_reportforge_routes.py
ReportForge — pentest report generator native Cerberus app.

Storage:
  data/cyberapps/reportforge/<user>/reports.json  — full report content
  data/cyberapps/reportforge/<user>/templates.json — user-saved custom templates

Cross-app reads (no writes):
  data/cyberapps/recondesk/<user>/targets.json  — imports targets from ReconDesk
"""

import copy
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from src.auth_helpers import get_current_user
from src.constants import DATA_DIR
from routes.cyberapps_reportforge_data import (
    BUILTIN_TEMPLATES,
    assemble_markdown,
    wrap_html,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------

def _user_dir(user: str) -> Path:
    d = Path(DATA_DIR) / "cyberapps" / "reportforge" / (user or "default")
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load_json(path: Path, default: Any) -> Any:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("cyberapps_reportforge: failed to read %s", path)
    return default


def _save_json(path: Path, data: Any) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------

class FindingModel(BaseModel):
    id: str
    title: str
    severity: str = "medium"
    description: str = ""
    evidence: str = ""
    impact: str = ""
    recommendation: str = ""
    cvss: Optional[str] = None
    likelihood: Optional[int] = None
    impactScore: Optional[int] = None
    linkedCardId: Optional[str] = None
    references: List[str] = []


class SectionCommentModel(BaseModel):
    id: str
    text: str
    author: str
    createdAt: str
    resolved: bool = False


class ReportSectionModel(BaseModel):
    id: str
    title: str
    content: str = ""
    order: int = 0
    visible: bool = True
    type: Optional[str] = None
    comments: List[SectionCommentModel] = []
    coverData: Optional[Dict[str, Any]] = None
    signatureBlock: Optional[Dict[str, Any]] = None


class ReportVariablesModel(BaseModel):
    client_name: str = ""
    test_date: str = ""
    tester_name: str = ""
    scope: str = ""
    engagement_type: str = ""


class ReportVersionModel(BaseModel):
    id: str
    label: str
    createdAt: str
    sectionCount: int = 0


class ReportCreate(BaseModel):
    id: Optional[str] = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str = "Untitled Report"
    targetName: str = ""
    targetIP: str = ""
    platform: str = "THM"
    assessmentDate: str = ""
    operator: str = ""
    difficulty: Optional[str] = None
    status: str = "draft"
    sections: List[ReportSectionModel] = []
    findings: List[FindingModel] = []
    reconDeskTargetId: Optional[str] = None
    cyberLabSessionId: Optional[str] = None
    variables: Optional[ReportVariablesModel] = None
    versions: List[ReportVersionModel] = []
    watermark: str = "none"


class ReportUpdate(BaseModel):
    title: Optional[str] = None
    targetName: Optional[str] = None
    targetIP: Optional[str] = None
    platform: Optional[str] = None
    assessmentDate: Optional[str] = None
    operator: Optional[str] = None
    difficulty: Optional[str] = None
    status: Optional[str] = None
    sections: Optional[List[ReportSectionModel]] = None
    findings: Optional[List[FindingModel]] = None
    reconDeskTargetId: Optional[str] = None
    cyberLabSessionId: Optional[str] = None
    variables: Optional[ReportVariablesModel] = None
    versions: Optional[List[ReportVersionModel]] = None
    watermark: Optional[str] = None


class TemplateCreate(BaseModel):
    id: Optional[str] = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str = ""
    sectionTitles: List[str] = []


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------

def setup_cyberapps_reportforge_routes() -> APIRouter:
    router = APIRouter(prefix="/api/cyberapps/reportforge", tags=["cyberapps-reportforge"])

    def _user(request: Request) -> str:
        return get_current_user(request) or "default"

    # ── Health ───────────────────────────────────────────────────────────────

    @router.get("")
    def health(request: Request) -> Dict[str, str]:
        return {"status": "ok", "app": "reportforge"}

    # ── Reports CRUD ─────────────────────────────────────────────────────────

    @router.get("/reports")
    def list_reports(request: Request) -> Dict[str, Any]:
        u = _user(request)
        return {"reports": _load_json(_user_dir(u) / "reports.json", [])}

    @router.post("/reports")
    def create_report(body: ReportCreate, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "reports.json"
        reports: List[Dict] = _load_json(path, [])
        if any(r["id"] == body.id for r in reports):
            raise HTTPException(status_code=409, detail="Report id already exists")
        now = _now_iso()
        record = body.model_dump()
        record.setdefault("createdAt", now)
        record["updatedAt"] = now
        reports.insert(0, record)
        _save_json(path, reports)
        return {"ok": True, "report": record}

    @router.get("/reports/{report_id}")
    def get_report(report_id: str, request: Request) -> Dict[str, Any]:
        u = _user(request)
        reports: List[Dict] = _load_json(_user_dir(u) / "reports.json", [])
        report = next((r for r in reports if r["id"] == report_id), None)
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")
        return {"report": report}

    @router.put("/reports/{report_id}")
    def update_report(report_id: str, body: ReportUpdate, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "reports.json"
        reports: List[Dict] = _load_json(path, [])
        idx = next((i for i, r in enumerate(reports) if r["id"] == report_id), None)
        if idx is None:
            raise HTTPException(status_code=404, detail="Report not found")
        patch = {k: v for k, v in body.model_dump().items() if v is not None}
        patch["updatedAt"] = _now_iso()
        reports[idx] = {**reports[idx], **patch}
        _save_json(path, reports)
        return {"ok": True, "report": reports[idx]}

    @router.delete("/reports/{report_id}")
    def delete_report(report_id: str, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "reports.json"
        reports: List[Dict] = _load_json(path, [])
        orig = len(reports)
        reports = [r for r in reports if r["id"] != report_id]
        if len(reports) == orig:
            raise HTTPException(status_code=404, detail="Report not found")
        _save_json(path, reports)
        return {"ok": True}

    @router.post("/reports/{report_id}/duplicate")
    def duplicate_report(report_id: str, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "reports.json"
        reports: List[Dict] = _load_json(path, [])
        src = next((r for r in reports if r["id"] == report_id), None)
        if not src:
            raise HTTPException(status_code=404, detail="Report not found")
        dup = copy.deepcopy(src)
        now = _now_iso()
        dup["id"] = str(uuid.uuid4())
        dup["createdAt"] = now
        dup["updatedAt"] = now
        dup["title"] = f"{dup.get('title', 'Report')} (copy)"
        dup["status"] = "draft"
        reports.insert(0, dup)
        _save_json(path, reports)
        return {"ok": True, "report": dup}

    # ── Export ────────────────────────────────────────────────────────────────

    @router.post("/reports/{report_id}/export/markdown")
    def export_markdown(
        report_id: str,
        request: Request,
        include_toc: bool = True,
        include_findings_table: bool = True,
        include_credentials: bool = True,
        redact_credentials: bool = True,
        include_raw_nmap: bool = False,
    ) -> Dict[str, Any]:
        u = _user(request)
        reports: List[Dict] = _load_json(_user_dir(u) / "reports.json", [])
        report = next((r for r in reports if r["id"] == report_id), None)
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")
        md = assemble_markdown(
            report,
            include_toc=include_toc,
            include_findings_table=include_findings_table,
            include_credentials=include_credentials,
            redact_credentials=redact_credentials,
            include_raw_nmap=include_raw_nmap,
        )
        return {"ok": True, "markdown": md, "filename": f"{report.get('title', 'report')}.md"}

    @router.post("/reports/{report_id}/export/html")
    def export_html(
        report_id: str,
        request: Request,
        include_toc: bool = True,
        include_findings_table: bool = True,
        include_credentials: bool = True,
        redact_credentials: bool = True,
    ) -> Dict[str, Any]:
        u = _user(request)
        reports: List[Dict] = _load_json(_user_dir(u) / "reports.json", [])
        report = next((r for r in reports if r["id"] == report_id), None)
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")
        try:
            import markdown as md_lib
            md_text = assemble_markdown(
                report,
                include_toc=include_toc,
                include_findings_table=include_findings_table,
                include_credentials=include_credentials,
                redact_credentials=redact_credentials,
            )
            body_html = md_lib.markdown(md_text, extensions=["tables", "fenced_code"])
        except ImportError:
            import html as html_lib
            md_text = assemble_markdown(report)
            body_html = f"<pre>{html_lib.escape(md_text)}</pre>"
        html_doc = wrap_html(body_html, report.get("title", "Report"))
        return {"ok": True, "html": html_doc, "filename": f"{report.get('title', 'report')}.html"}

    # ── Templates CRUD ────────────────────────────────────────────────────────

    @router.get("/templates")
    def list_templates(request: Request) -> Dict[str, Any]:
        u = _user(request)
        custom = _load_json(_user_dir(u) / "templates.json", [])
        return {"builtin": BUILTIN_TEMPLATES, "custom": custom}

    @router.post("/templates")
    def create_template(body: TemplateCreate, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "templates.json"
        templates: List[Dict] = _load_json(path, [])
        if any(t["id"] == body.id for t in templates):
            raise HTTPException(status_code=409, detail="Template id already exists")
        record = body.model_dump()
        templates.append(record)
        _save_json(path, templates)
        return {"ok": True, "template": record}

    @router.delete("/templates/{template_id}")
    def delete_template(template_id: str, request: Request) -> Dict[str, Any]:
        u = _user(request)
        path = _user_dir(u) / "templates.json"
        templates: List[Dict] = _load_json(path, [])
        orig = len(templates)
        templates = [t for t in templates if t["id"] != template_id]
        if len(templates) == orig:
            raise HTTPException(status_code=404, detail="Template not found")
        _save_json(path, templates)
        return {"ok": True}

    # ── Cross-app: ReconDesk target import ───────────────────────────────────

    @router.get("/recon-targets")
    def get_recon_targets(request: Request) -> Dict[str, Any]:
        """Read ReconDesk targets for the current user (read-only cross-app)."""
        u = _user(request)
        recon_dir = Path(DATA_DIR) / "cyberapps" / "recondesk" / (u or "default")
        return {"targets": _load_json(recon_dir / "targets.json", [])}

    return router
