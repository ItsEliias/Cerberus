"""
CredVault — Pydantic request/response models for the Cerberus native routes.
All credential fields map 1:1 to the Electron Credential type in shared/types.ts.
"""
from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Credential models
# ---------------------------------------------------------------------------

class CredentialCreate(BaseModel):
    type: Optional[str] = "credential"          # 'credential' | 'note'
    username: str
    password: Optional[str] = None
    hash: Optional[str] = None
    hashType: Optional[str] = None
    service: str
    ip: Optional[str] = None
    port: Optional[int] = None
    protocol: Optional[str] = None
    source: str
    labName: Optional[str] = None
    targetName: Optional[str] = None
    category: Optional[str] = None
    folder: Optional[str] = None
    tags: List[str] = []
    notes: Optional[str] = None
    verified: bool = False
    status: str = "active"
    expiresAt: Optional[str] = None
    totpSecret: Optional[str] = None
    lastUsed: Optional[str] = None
    useCount: Optional[int] = None


class CredentialUpdate(BaseModel):
    type: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    hash: Optional[str] = None
    hashType: Optional[str] = None
    service: Optional[str] = None
    ip: Optional[str] = None
    port: Optional[int] = None
    protocol: Optional[str] = None
    source: Optional[str] = None
    labName: Optional[str] = None
    targetName: Optional[str] = None
    category: Optional[str] = None
    folder: Optional[str] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
    verified: Optional[bool] = None
    status: Optional[str] = None
    expiresAt: Optional[str] = None
    totpSecret: Optional[str] = None
    lastUsed: Optional[str] = None
    useCount: Optional[int] = None


class CredentialImportRow(BaseModel):
    type: Optional[str] = "credential"
    username: str
    password: Optional[str] = None
    hash: Optional[str] = None
    hashType: Optional[str] = None
    service: str
    ip: Optional[str] = None
    port: Optional[int] = None
    protocol: Optional[str] = None
    source: str
    labName: Optional[str] = None
    targetName: Optional[str] = None
    category: Optional[str] = None
    folder: Optional[str] = None
    tags: List[str] = []
    notes: Optional[str] = None
    verified: bool = False
    status: str = "active"
    expiresAt: Optional[str] = None
    totpSecret: Optional[str] = None


class ImportBody(BaseModel):
    credentials: List[CredentialImportRow]


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

class SettingsUpdate(BaseModel):
    sort_order: Optional[str] = None
    auto_lock_ms: Optional[int] = None
    clipboard_clear_ms: Optional[int] = None
