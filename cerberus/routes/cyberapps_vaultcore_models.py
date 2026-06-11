"""
VaultCore — Pydantic request models.
Imported by cyberapps_vaultcore_routes.py.
"""
from __future__ import annotations

from typing import Any, Dict, Optional
from pydantic import BaseModel


class SourceCreate(BaseModel):
    name: str
    type: str = "website"
    url: str = ""
    config: Dict[str, Any] = {}
    schedule_enabled: bool = False
    schedule_cron: str = ""
    conflict_strategy: str = "skip"


class SourceUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    url: Optional[str] = None
    config: Optional[Dict[str, Any]] = None
    schedule_enabled: Optional[bool] = None
    schedule_cron: Optional[str] = None
    conflict_strategy: Optional[str] = None


class ScrapeJobCreate(BaseModel):
    source_id: Optional[str] = None
    source_type: str = "website"
    url: str = ""
    source_name: str = ""
    output_subfolder: str = ""
    conflict_strategy: str = "skip"
    update_mode: str = "all"
    depth: int = 3
    max_pages: int = 50
    delay: int = 1


class LogQueryParams(BaseModel):
    limit: int = 100
    source_id: Optional[str] = None
    status: Optional[str] = None


class SettingsSave(BaseModel):
    vault_path: Optional[str] = None
    default_conflict_strategy: Optional[str] = None
    default_depth: Optional[int] = None
    default_max_pages: Optional[int] = None
    default_delay: Optional[int] = None
    auto_wikilinks: Optional[bool] = None
    auto_tag: Optional[bool] = None
    notifications: Optional[bool] = None
