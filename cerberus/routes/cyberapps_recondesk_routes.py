# routes/cyberapps_recondesk_routes.py
"""ReconDesk — target tracking, port/credential/attack-card management."""

import json
import uuid
import logging
from typing import Optional

from fastapi import APIRouter, Request, HTTPException

from src.auth_helpers import get_current_user
from routes.cyberapps_recondesk_models import (
    RDTarget, RDPort, RDCredential, RDAttackCard, RDTimelineEntry,
    RDEngagement, engine, Base, SessionLocal,
)
from routes.cyberapps_recondesk_schemas import (
    TargetCreate, TargetUpdate, PortCreate, PortUpdate,
    CredentialCreate, CredentialUpdate, AttackCardCreate, AttackCardUpdate,
    EngagementCreate, EngagementUpdate, NmapImportRequest, TimelineAdd,
    ser_target, ser_port, ser_cred, ser_card, ser_timeline, ser_engagement,
    parse_nmap_xml,
)

logger = logging.getLogger(__name__)


def _add_timeline(db, target_id: str, entry_type: str, description: str) -> RDTimelineEntry:
    """Insert a timeline entry and add to session (caller must commit)."""
    e = RDTimelineEntry(
        id=str(uuid.uuid4()),
        target_id=target_id,
        entry_type=entry_type,
        description=description,
    )
    db.add(e)
    return e


def setup_recondesk_routes() -> APIRouter:
    Base.metadata.create_all(engine)
    router = APIRouter(prefix="/api/cyberapps/recondesk", tags=["recondesk"])

    def _owner(request: Request) -> Optional[str]:
        return get_current_user(request)

    def _get_target(db, tid: str, owner: Optional[str]) -> RDTarget:
        t = db.query(RDTarget).filter(RDTarget.id == tid).first()
        if not t:
            raise HTTPException(404, "Target not found")
        if owner is not None and t.owner != owner:
            raise HTTPException(404, "Target not found")
        return t

    # ── Targets ─────────────────────────────────────────────────────────────

    @router.get("")
    def list_targets(request: Request):
        owner = _owner(request)
        db = SessionLocal()
        try:
            tq = db.query(RDTarget)
            eq = db.query(RDEngagement)
            if owner is not None:
                tq = tq.filter(RDTarget.owner == owner)
                eq = eq.filter(RDEngagement.owner == owner)
            return {
                "targets": [ser_target(t) for t in tq.order_by(RDTarget.created_at.desc()).all()],
                "engagements": [ser_engagement(e) for e in eq.all()],
            }
        finally:
            db.close()

    @router.post("/targets")
    def create_target(request: Request, body: TargetCreate):
        owner = _owner(request)
        if not body.name.strip() or not body.ip.strip():
            raise HTTPException(400, "name and ip are required")
        db = SessionLocal()
        try:
            t = RDTarget(
                id=str(uuid.uuid4()), owner=owner,
                name=body.name.strip(), ip=body.ip.strip(),
                platform=body.platform, os=body.os, status=body.status,
                difficulty=body.difficulty, tags=json.dumps(body.tags),
                notes=body.notes, engagement_id=body.engagement_id,
                scheduled_date=body.scheduled_date,
                additional_ips=json.dumps(body.additional_ips),
            )
            db.add(t)
            _add_timeline(db, t.id, "status_changed", f"Target created: {t.name} ({t.ip})")
            db.commit(); db.refresh(t)
            return ser_target(t)
        finally:
            db.close()

    @router.get("/targets/{target_id}")
    def get_target(request: Request, target_id: str):
        owner = _owner(request)
        db = SessionLocal()
        try:
            t = _get_target(db, target_id, owner)
            ports    = db.query(RDPort).filter(RDPort.target_id == target_id).all()
            creds    = db.query(RDCredential).filter(RDCredential.target_id == target_id).all()
            cards    = db.query(RDAttackCard).filter(RDAttackCard.target_id == target_id).all()
            timeline = db.query(RDTimelineEntry).filter(
                RDTimelineEntry.target_id == target_id
            ).order_by(RDTimelineEntry.created_at.asc()).all()
            return {
                **ser_target(t),
                "ports": [ser_port(p) for p in ports],
                "credentials": [ser_cred(c) for c in creds],
                "attack_cards": [ser_card(c) for c in cards],
                "timeline": [ser_timeline(e) for e in timeline],
            }
        finally:
            db.close()

    @router.put("/targets/{target_id}")
    def update_target(request: Request, target_id: str, body: TargetUpdate):
        owner = _owner(request)
        db = SessionLocal()
        try:
            t = _get_target(db, target_id, owner)
            prev_status = t.status
            if body.name is not None: t.name = body.name.strip() or t.name
            if body.ip is not None: t.ip = body.ip.strip() or t.ip
            if body.platform is not None: t.platform = body.platform
            if body.os is not None: t.os = body.os
            if body.status is not None: t.status = body.status
            if body.difficulty is not None: t.difficulty = body.difficulty
            if body.tags is not None: t.tags = json.dumps(body.tags)
            if body.notes is not None: t.notes = body.notes
            if body.engagement_id is not None: t.engagement_id = body.engagement_id
            if body.scheduled_date is not None: t.scheduled_date = body.scheduled_date
            if body.completed_at is not None: t.completed_at = body.completed_at
            if body.additional_ips is not None: t.additional_ips = json.dumps(body.additional_ips)
            if body.status and body.status != prev_status:
                _add_timeline(db, target_id, "status_changed", f"Status changed to {body.status}")
            db.commit(); db.refresh(t)
            return ser_target(t)
        finally:
            db.close()

    @router.delete("/targets/{target_id}")
    def delete_target(request: Request, target_id: str):
        owner = _owner(request)
        db = SessionLocal()
        try:
            t = _get_target(db, target_id, owner)
            for model in [RDPort, RDCredential, RDAttackCard, RDTimelineEntry]:
                db.query(model).filter(model.target_id == target_id).delete()
            db.delete(t); db.commit()
            return {"ok": True}
        finally:
            db.close()

    # ── Ports ────────────────────────────────────────────────────────────────

    @router.post("/targets/{target_id}/ports")
    def add_port(request: Request, target_id: str, body: PortCreate):
        owner = _owner(request)
        if not (1 <= body.port <= 65535):
            raise HTTPException(400, "port must be 1-65535")
        db = SessionLocal()
        try:
            _get_target(db, target_id, owner)
            p = RDPort(
                id=str(uuid.uuid4()), target_id=target_id,
                port=body.port, protocol=body.protocol, state=body.state,
                service=body.service, version=body.version,
                notes=body.notes, source=body.source,
            )
            db.add(p)
            _add_timeline(db, target_id, "port_added",
                          f"Port {body.port}/{body.protocol} ({body.service or '?'}) added")
            db.commit(); db.refresh(p)
            return ser_port(p)
        finally:
            db.close()

    @router.put("/targets/{target_id}/ports/{port_id}")
    def update_port(request: Request, target_id: str, port_id: str, body: PortUpdate):
        owner = _owner(request)
        db = SessionLocal()
        try:
            _get_target(db, target_id, owner)
            p = db.query(RDPort).filter(RDPort.id == port_id, RDPort.target_id == target_id).first()
            if not p: raise HTTPException(404, "Port not found")
            if body.state is not None: p.state = body.state
            if body.service is not None: p.service = body.service
            if body.version is not None: p.version = body.version
            if body.notes is not None: p.notes = body.notes
            db.commit(); db.refresh(p)
            return ser_port(p)
        finally:
            db.close()

    @router.delete("/targets/{target_id}/ports/{port_id}")
    def delete_port(request: Request, target_id: str, port_id: str):
        owner = _owner(request)
        db = SessionLocal()
        try:
            _get_target(db, target_id, owner)
            p = db.query(RDPort).filter(RDPort.id == port_id, RDPort.target_id == target_id).first()
            if not p: raise HTTPException(404, "Port not found")
            db.delete(p); db.commit()
            return {"ok": True}
        finally:
            db.close()

    @router.post("/targets/{target_id}/ports/import-nmap")
    async def import_nmap(request: Request, target_id: str, body: NmapImportRequest):
        owner = _owner(request)
        db = SessionLocal()
        try:
            _get_target(db, target_id, owner)
            parsed = parse_nmap_xml(body.xml)
            existing = {
                (p.port, p.protocol)
                for p in db.query(RDPort).filter(RDPort.target_id == target_id).all()
            }
            imported = 0; skipped = 0
            for pd in parsed:
                key = (pd["port"], pd["protocol"])
                if key in existing: skipped += 1; continue
                existing.add(key)
                db.add(RDPort(
                    id=str(uuid.uuid4()), target_id=target_id,
                    port=pd["port"], protocol=pd["protocol"], state=pd["state"],
                    service=pd["service"], version=pd["version"], source=pd["source"],
                ))
                _add_timeline(db, target_id, "port_added",
                              f"Port {pd['port']}/{pd['protocol']} imported from nmap")
                imported += 1
            db.commit()
            return {"imported": imported, "skipped": skipped}
        except ValueError as e:
            raise HTTPException(400, str(e))
        finally:
            db.close()

    # ── Credentials ─────────────────────────────────────────────────────────

    @router.post("/targets/{target_id}/credentials")
    def add_credential(request: Request, target_id: str, body: CredentialCreate):
        owner = _owner(request)
        if not body.username.strip() and not body.hash_value:
            raise HTTPException(400, "username or hash_value required")
        db = SessionLocal()
        try:
            _get_target(db, target_id, owner)
            c = RDCredential(
                id=str(uuid.uuid4()), target_id=target_id,
                username=body.username, hash_value=body.hash_value,
                hash_type=body.hash_type, service=body.service,
                port=body.port, notes=body.notes, source=body.source,
                verified=body.verified,
            )
            db.add(c)
            svc = f" @ {body.service}" if body.service else ""
            _add_timeline(db, target_id, "credential_added",
                          f"Credential added: {body.username or 'hash'}{svc}")
            db.commit(); db.refresh(c)
            return ser_cred(c)
        finally:
            db.close()

    @router.put("/targets/{target_id}/credentials/{cred_id}")
    def update_credential(request: Request, target_id: str, cred_id: str, body: CredentialUpdate):
        owner = _owner(request)
        db = SessionLocal()
        try:
            _get_target(db, target_id, owner)
            c = db.query(RDCredential).filter(
                RDCredential.id == cred_id, RDCredential.target_id == target_id
            ).first()
            if not c: raise HTTPException(404, "Credential not found")
            if body.username is not None: c.username = body.username
            if body.service is not None: c.service = body.service
            if body.port is not None: c.port = body.port
            if body.notes is not None: c.notes = body.notes
            if body.source is not None: c.source = body.source
            if body.verified is not None: c.verified = body.verified
            db.commit(); db.refresh(c)
            return ser_cred(c)
        finally:
            db.close()

    @router.delete("/targets/{target_id}/credentials/{cred_id}")
    def delete_credential(request: Request, target_id: str, cred_id: str):
        owner = _owner(request)
        db = SessionLocal()
        try:
            _get_target(db, target_id, owner)
            c = db.query(RDCredential).filter(
                RDCredential.id == cred_id, RDCredential.target_id == target_id
            ).first()
            if not c: raise HTTPException(404, "Credential not found")
            db.delete(c); db.commit()
            return {"ok": True}
        finally:
            db.close()

    # ── Attack Cards ─────────────────────────────────────────────────────────

    @router.post("/targets/{target_id}/cards")
    def add_card(request: Request, target_id: str, body: AttackCardCreate):
        owner = _owner(request)
        if not body.title.strip(): raise HTTPException(400, "title required")
        db = SessionLocal()
        try:
            _get_target(db, target_id, owner)
            c = RDAttackCard(
                id=str(uuid.uuid4()), target_id=target_id,
                title=body.title.strip(), description=body.description,
                stage=body.stage, status=body.status, notes=body.notes,
                due_date=body.due_date,
                linked_port_ids=json.dumps(body.linked_port_ids),
                linked_credential_ids=json.dumps(body.linked_credential_ids),
            )
            db.add(c)
            _add_timeline(db, target_id, "card_created",
                          f"Attack card created: \"{body.title}\" [{body.stage}]")
            db.commit(); db.refresh(c)
            return ser_card(c)
        finally:
            db.close()

    @router.put("/targets/{target_id}/cards/{card_id}")
    def update_card(request: Request, target_id: str, card_id: str, body: AttackCardUpdate):
        owner = _owner(request)
        db = SessionLocal()
        try:
            _get_target(db, target_id, owner)
            c = db.query(RDAttackCard).filter(
                RDAttackCard.id == card_id, RDAttackCard.target_id == target_id
            ).first()
            if not c: raise HTTPException(404, "Card not found")
            prev_stage, prev_status = c.stage, c.status
            if body.title is not None: c.title = body.title.strip() or c.title
            if body.description is not None: c.description = body.description
            if body.stage is not None: c.stage = body.stage
            if body.status is not None: c.status = body.status
            if body.notes is not None: c.notes = body.notes
            if body.due_date is not None: c.due_date = body.due_date
            if body.completed_at is not None: c.completed_at = body.completed_at
            if body.linked_port_ids is not None: c.linked_port_ids = json.dumps(body.linked_port_ids)
            if body.linked_credential_ids is not None: c.linked_credential_ids = json.dumps(body.linked_credential_ids)
            if body.stage and body.stage != prev_stage:
                _add_timeline(db, target_id, "card_moved", f"\"{c.title}\" moved to {body.stage}")
            if body.status == "done" and prev_status != "done":
                _add_timeline(db, target_id, "card_completed", f"\"{c.title}\" marked done")
            db.commit(); db.refresh(c)
            return ser_card(c)
        finally:
            db.close()

    @router.delete("/targets/{target_id}/cards/{card_id}")
    def delete_card(request: Request, target_id: str, card_id: str):
        owner = _owner(request)
        db = SessionLocal()
        try:
            _get_target(db, target_id, owner)
            c = db.query(RDAttackCard).filter(
                RDAttackCard.id == card_id, RDAttackCard.target_id == target_id
            ).first()
            if not c: raise HTTPException(404, "Card not found")
            db.delete(c); db.commit()
            return {"ok": True}
        finally:
            db.close()

    # ── Timeline ─────────────────────────────────────────────────────────────

    @router.post("/targets/{target_id}/timeline")
    def add_timeline_entry(request: Request, target_id: str, body: TimelineAdd):
        owner = _owner(request)
        db = SessionLocal()
        try:
            _get_target(db, target_id, owner)
            e = _add_timeline(db, target_id, body.entry_type, body.description)
            db.commit(); db.refresh(e)
            return ser_timeline(e)
        finally:
            db.close()

    # ── Engagements ──────────────────────────────────────────────────────────

    @router.post("/engagements")
    def create_engagement(request: Request, body: EngagementCreate):
        owner = _owner(request)
        if not body.name.strip(): raise HTTPException(400, "name required")
        db = SessionLocal()
        try:
            e = RDEngagement(
                id=str(uuid.uuid4()), owner=owner,
                name=body.name.strip(), color=body.color,
                in_scope=body.in_scope, out_of_scope=body.out_of_scope,
            )
            db.add(e); db.commit(); db.refresh(e)
            return ser_engagement(e)
        finally:
            db.close()

    @router.put("/engagements/{eng_id}")
    def update_engagement(request: Request, eng_id: str, body: EngagementUpdate):
        owner = _owner(request)
        db = SessionLocal()
        try:
            e = db.query(RDEngagement).filter(RDEngagement.id == eng_id).first()
            if not e: raise HTTPException(404, "Engagement not found")
            if owner is not None and e.owner != owner: raise HTTPException(404, "Engagement not found")
            if body.name is not None: e.name = body.name.strip() or e.name
            if body.color is not None: e.color = body.color
            if body.in_scope is not None: e.in_scope = body.in_scope
            if body.out_of_scope is not None: e.out_of_scope = body.out_of_scope
            if body.authorised_by is not None: e.authorised_by = body.authorised_by
            if body.authorised_date is not None: e.authorised_date = body.authorised_date
            if body.window_start is not None: e.window_start = body.window_start
            if body.window_end is not None: e.window_end = body.window_end
            if body.allowed_activity is not None: e.allowed_activity = body.allowed_activity
            if body.emergency_contact is not None: e.emergency_contact = body.emergency_contact
            db.commit(); db.refresh(e)
            return ser_engagement(e)
        finally:
            db.close()

    @router.delete("/engagements/{eng_id}")
    def delete_engagement(request: Request, eng_id: str):
        owner = _owner(request)
        db = SessionLocal()
        try:
            e = db.query(RDEngagement).filter(RDEngagement.id == eng_id).first()
            if not e: raise HTTPException(404, "Engagement not found")
            if owner is not None and e.owner != owner: raise HTTPException(404, "Engagement not found")
            if e.id == "default": raise HTTPException(400, "Cannot delete default engagement")
            db.delete(e); db.commit()
            return {"ok": True}
        finally:
            db.close()

    return router
