"""
GhostVault — Pydantic request/response models.
Imported by cyberapps_ghostvault_routes.py.
"""
from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel


class NoteCreate(BaseModel):
    title: str
    content: str = ""
    folder: str = "Notes"
    tags: List[str] = []
    template: Optional[str] = None
    ai_context: Optional[str] = None  # 'work' | 'cyber' | 'personal'
    pinned: bool = False


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    folder: Optional[str] = None
    tags: Optional[List[str]] = None
    ai_context: Optional[str] = None
    pinned: Optional[bool] = None


class FolderCreate(BaseModel):
    name: str


class SettingsUpdate(BaseModel):
    default_folder: Optional[str] = None
    default_ai_context: Optional[str] = None
    editor_mode: Optional[str] = None   # 'edit' | 'split' | 'preview'
    autosave: Optional[bool] = None
    show_word_count: Optional[bool] = None
    default_template: Optional[str] = None
