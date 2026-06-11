"""
CyberLab Companion — Pydantic request models.
Imported by cyberapps_cyberlab_routes.py.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class VaultSetupBody(BaseModel):
    password: str


class VaultUnlockBody(BaseModel):
    password: str


class VaultChangeBody(BaseModel):
    old_password: str
    new_password: str


class LabCreate(BaseModel):
    name: str
    platform: str = "htb"
    os: str = ""
    difficulty: str = ""
    status: str = "in-progress"
    ip: str = ""
    notes: str = ""
    url: str = ""
    tags: List[str] = []
    completed_at: Optional[str] = None


class LabUpdate(BaseModel):
    name: Optional[str] = None
    platform: Optional[str] = None
    os: Optional[str] = None
    difficulty: Optional[str] = None
    status: Optional[str] = None
    ip: Optional[str] = None
    notes: Optional[str] = None
    url: Optional[str] = None
    tags: Optional[List[str]] = None
    completed_at: Optional[str] = None


class SessionCreate(BaseModel):
    name: str = "New Session"
    platform: str = "htb"
    machine: str = ""
    ip: str = ""
    notes: str = ""
    lab_id: Optional[str] = None


class ReviewCreate(BaseModel):
    machine_name: str
    platform: str = "htb"
    rating: int = 3
    notes: str = ""
    tags: List[str] = []
    lab_id: Optional[str] = None


class ReviewUpdate(BaseModel):
    rating: Optional[int] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None


class KnowledgeCreate(BaseModel):
    title: str
    content: str = ""
    tags: List[str] = []
    linked_lab_id: Optional[str] = None


class KnowledgeUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    tags: Optional[List[str]] = None
    linked_lab_id: Optional[str] = None


class SnippetCreate(BaseModel):
    title: str
    command: str = ""
    language: str = "bash"
    tags: List[str] = []


class SnippetUpdate(BaseModel):
    title: Optional[str] = None
    command: Optional[str] = None
    language: Optional[str] = None
    tags: Optional[List[str]] = None


class ChatMessage(BaseModel):
    message: str
    history: List[Dict[str, str]] = []
    session_id: Optional[str] = None
    active_lab: Dict[str, Any] = {}
    kb_entries: List[Dict[str, Any]] = []


class CredentialSave(BaseModel):
    token: str
    label: str = ""


class SettingsSave(BaseModel):
    default_model: Optional[str] = None
    max_tokens: Optional[int] = None
    system_prompt_override: Optional[str] = None
    auto_context_inject: Optional[bool] = None
    kb_auto_surface: Optional[bool] = None
