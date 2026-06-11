# routes/cyberapps_recondesk_models.py
"""SQLAlchemy models for ReconDesk tables."""

import os
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Text, Boolean, DateTime, Integer, create_engine,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from src.constants import DATA_DIR

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR}/app.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class RDTarget(Base):
    __tablename__ = "cyberapps_recondesk_targets"

    id = Column(String, primary_key=True)
    owner = Column(String, nullable=True, index=True)
    name = Column(String, nullable=False)
    ip = Column(String, nullable=False)
    additional_ips = Column(Text, default="[]")
    platform = Column(String, default="HTB")
    os = Column(String, default="Unknown")
    status = Column(String, default="active")
    difficulty = Column(String, nullable=True)
    tags = Column(Text, default="[]")
    notes = Column(Text, default="")
    engagement_id = Column(String, nullable=True)
    scheduled_date = Column(String, nullable=True)
    completed_at = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow, nullable=False)


class RDPort(Base):
    __tablename__ = "cyberapps_recondesk_ports"

    id = Column(String, primary_key=True)
    target_id = Column(String, nullable=False, index=True)
    port = Column(Integer, nullable=False)
    protocol = Column(String, default="tcp")
    state = Column(String, default="open")
    service = Column(String, default="")
    version = Column(String, default="")
    notes = Column(Text, default="")
    source = Column(String, default="manual")
    added_at = Column(DateTime, default=_utcnow, nullable=False)


class RDCredential(Base):
    __tablename__ = "cyberapps_recondesk_credentials"

    id = Column(String, primary_key=True)
    target_id = Column(String, nullable=False, index=True)
    username = Column(String, default="")
    # Passwords are NOT stored — only hashes are persisted
    hash_value = Column(Text, nullable=True)
    hash_type = Column(String, nullable=True)
    service = Column(String, default="")
    port = Column(Integer, nullable=True)
    notes = Column(Text, default="")
    source = Column(String, default="")
    verified = Column(Boolean, default=False)
    added_at = Column(DateTime, default=_utcnow, nullable=False)


class RDAttackCard(Base):
    __tablename__ = "cyberapps_recondesk_attack_cards"

    id = Column(String, primary_key=True)
    target_id = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, default="")
    stage = Column(String, default="recon")
    status = Column(String, default="todo")
    notes = Column(Text, default="")
    due_date = Column(String, nullable=True)
    completed_at = Column(String, nullable=True)
    linked_port_ids = Column(Text, default="[]")
    linked_credential_ids = Column(Text, default="[]")
    created_at = Column(DateTime, default=_utcnow, nullable=False)


class RDTimelineEntry(Base):
    __tablename__ = "cyberapps_recondesk_timeline"

    id = Column(String, primary_key=True)
    target_id = Column(String, nullable=False, index=True)
    entry_type = Column(String, nullable=False)
    description = Column(Text, default="")
    created_at = Column(DateTime, default=_utcnow, nullable=False)


class RDEngagement(Base):
    __tablename__ = "cyberapps_recondesk_engagements"

    id = Column(String, primary_key=True)
    owner = Column(String, nullable=True, index=True)
    name = Column(String, nullable=False)
    color = Column(String, default="#d29922")
    in_scope = Column(Text, nullable=True)
    out_of_scope = Column(Text, nullable=True)
    authorised_by = Column(String, nullable=True)
    authorised_date = Column(String, nullable=True)
    window_start = Column(String, nullable=True)
    window_end = Column(String, nullable=True)
    allowed_activity = Column(Text, nullable=True)
    emergency_contact = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow, nullable=False)
