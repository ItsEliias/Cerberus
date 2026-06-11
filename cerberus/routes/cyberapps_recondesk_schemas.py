# routes/cyberapps_recondesk_schemas.py
"""Pydantic request models and dict serialisers for ReconDesk."""

import json
from typing import Optional, List

from pydantic import BaseModel

from routes.cyberapps_recondesk_models import (
    RDTarget, RDPort, RDCredential, RDAttackCard, RDTimelineEntry, RDEngagement,
)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class TargetCreate(BaseModel):
    name: str
    ip: str
    platform: str = "HTB"
    os: str = "Unknown"
    status: str = "active"
    difficulty: Optional[str] = None
    tags: List[str] = []
    notes: str = ""
    engagement_id: Optional[str] = None
    scheduled_date: Optional[str] = None
    additional_ips: List[str] = []


class TargetUpdate(BaseModel):
    name: Optional[str] = None
    ip: Optional[str] = None
    platform: Optional[str] = None
    os: Optional[str] = None
    status: Optional[str] = None
    difficulty: Optional[str] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
    engagement_id: Optional[str] = None
    scheduled_date: Optional[str] = None
    completed_at: Optional[str] = None
    additional_ips: Optional[List[str]] = None


class PortCreate(BaseModel):
    port: int
    protocol: str = "tcp"
    state: str = "open"
    service: str = ""
    version: str = ""
    notes: str = ""
    source: str = "manual"


class PortUpdate(BaseModel):
    state: Optional[str] = None
    service: Optional[str] = None
    version: Optional[str] = None
    notes: Optional[str] = None


class CredentialCreate(BaseModel):
    username: str = ""
    password: Optional[str] = None
    hash_value: Optional[str] = None
    hash_type: Optional[str] = None
    service: str = ""
    port: Optional[int] = None
    notes: str = ""
    source: str = ""
    verified: bool = False


class CredentialUpdate(BaseModel):
    username: Optional[str] = None
    service: Optional[str] = None
    port: Optional[int] = None
    notes: Optional[str] = None
    source: Optional[str] = None
    verified: Optional[bool] = None


class AttackCardCreate(BaseModel):
    title: str
    description: str = ""
    stage: str = "recon"
    status: str = "todo"
    notes: str = ""
    due_date: Optional[str] = None
    linked_port_ids: List[str] = []
    linked_credential_ids: List[str] = []


class AttackCardUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    stage: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    due_date: Optional[str] = None
    completed_at: Optional[str] = None
    linked_port_ids: Optional[List[str]] = None
    linked_credential_ids: Optional[List[str]] = None


class EngagementCreate(BaseModel):
    name: str
    color: str = "#d29922"
    in_scope: Optional[str] = None
    out_of_scope: Optional[str] = None


class EngagementUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    in_scope: Optional[str] = None
    out_of_scope: Optional[str] = None
    authorised_by: Optional[str] = None
    authorised_date: Optional[str] = None
    window_start: Optional[str] = None
    window_end: Optional[str] = None
    allowed_activity: Optional[str] = None
    emergency_contact: Optional[str] = None


class NmapImportRequest(BaseModel):
    xml: str


class TimelineAdd(BaseModel):
    entry_type: str
    description: str


# ---------------------------------------------------------------------------
# Serialisers
# ---------------------------------------------------------------------------

def ser_target(t: RDTarget) -> dict:
    return {
        "id": t.id, "owner": t.owner, "name": t.name, "ip": t.ip,
        "additional_ips": json.loads(t.additional_ips or "[]"),
        "platform": t.platform, "os": t.os, "status": t.status,
        "difficulty": t.difficulty, "tags": json.loads(t.tags or "[]"),
        "notes": t.notes or "", "engagement_id": t.engagement_id,
        "scheduled_date": t.scheduled_date, "completed_at": t.completed_at,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


def ser_port(p: RDPort) -> dict:
    return {
        "id": p.id, "target_id": p.target_id,
        "port": p.port, "protocol": p.protocol, "state": p.state,
        "service": p.service or "", "version": p.version or "",
        "notes": p.notes or "", "source": p.source or "manual",
        "added_at": p.added_at.isoformat() if p.added_at else None,
    }


def ser_cred(c: RDCredential) -> dict:
    return {
        "id": c.id, "target_id": c.target_id, "username": c.username or "",
        "hash_value": c.hash_value, "hash_type": c.hash_type,
        "service": c.service or "", "port": c.port, "notes": c.notes or "",
        "source": c.source or "", "verified": bool(c.verified),
        "added_at": c.added_at.isoformat() if c.added_at else None,
    }


def ser_card(c: RDAttackCard) -> dict:
    return {
        "id": c.id, "target_id": c.target_id,
        "title": c.title, "description": c.description or "",
        "stage": c.stage, "status": c.status, "notes": c.notes or "",
        "due_date": c.due_date, "completed_at": c.completed_at,
        "linked_port_ids": json.loads(c.linked_port_ids or "[]"),
        "linked_credential_ids": json.loads(c.linked_credential_ids or "[]"),
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def ser_timeline(e: RDTimelineEntry) -> dict:
    return {
        "id": e.id, "target_id": e.target_id,
        "entry_type": e.entry_type, "description": e.description or "",
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


def ser_engagement(e: RDEngagement) -> dict:
    return {
        "id": e.id, "owner": e.owner, "name": e.name,
        "color": e.color or "#d29922",
        "in_scope": e.in_scope, "out_of_scope": e.out_of_scope,
        "authorised_by": e.authorised_by, "authorised_date": e.authorised_date,
        "window_start": e.window_start, "window_end": e.window_end,
        "allowed_activity": e.allowed_activity,
        "emergency_contact": e.emergency_contact,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


# ---------------------------------------------------------------------------
# Nmap XML parser (stdlib only — no binary subprocess)
# ---------------------------------------------------------------------------

def parse_nmap_xml(xml: str) -> list:
    """Parse nmap -oX output and return list of port dicts. No binary needed."""
    try:
        import xml.etree.ElementTree as ET
        root = ET.fromstring(xml)
        ports = []
        for host in root.findall(".//host"):
            for port_el in host.findall(".//port"):
                state_el = port_el.find("state")
                if state_el is None:
                    continue
                service_el = port_el.find("service")
                service = ""
                version = ""
                if service_el is not None:
                    service = service_el.get("name", "")
                    product = service_el.get("product", "")
                    ver = service_el.get("version", "")
                    version = " ".join(filter(None, [product, ver]))
                ports.append({
                    "port":     int(port_el.get("portid", "0")),
                    "protocol": port_el.get("protocol", "tcp"),
                    "state":    state_el.get("state", ""),
                    "service":  service,
                    "version":  version,
                    "source":   "nmap-import",
                })
        return ports
    except Exception as e:
        raise ValueError(f"Invalid nmap XML: {e}")
