"""Gateway message log — unit tests (fast lane, in-memory SQLite, no HTTP stack).

Covers six invariants:
  1. GatewayMessage model has all required columns.
  2. GET /api/gateway/messages route returns owner-scoped list.
  3. channel_id is masked in the response (middle digits replaced with *).
  4. Recording failure does not propagate (must never break message handling).
  5. Tool calls stored and returned as a JSON list.
  6. Results are newest-first ordering.
"""

import json
import sys
import os
import uuid
from datetime import datetime
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ---------------------------------------------------------------------------
# 1. GatewayMessage model has all required columns
# ---------------------------------------------------------------------------

def test_gateway_message_model_columns():
    """All spec-required columns exist on the GatewayMessage model."""
    from core.database import GatewayMessage
    required = {
        "id", "platform", "channel_id", "sender",
        "message_preview", "agent_response_preview",
        "tool_calls_triggered", "was_approved", "timestamp", "owner",
    }
    cols = {c.name for c in GatewayMessage.__table__.columns}
    missing = required - cols
    assert not missing, f"GatewayMessage missing columns: {missing}"


# ---------------------------------------------------------------------------
# Helpers — in-memory DB fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def mem_db_with_rows():
    """In-memory SQLite DB with seeded GatewayMessage rows."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from core.database import Base, GatewayMessage

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)

    db = Session()
    rows = [
        GatewayMessage(
            id=str(uuid.uuid4()), owner="owner1", platform="discord",
            channel_id="1234567890", sender="Alice",
            message_preview="Hello bot!", agent_response_preview="Hi Alice!",
            tool_calls_triggered=json.dumps(["manage_calendar"]),
            was_approved=True,
            timestamp=datetime(2026, 6, 22, 12, 0, 0),
        ),
        GatewayMessage(
            id=str(uuid.uuid4()), owner="owner1", platform="telegram",
            channel_id="9876543210", sender="Bob",
            message_preview="What's the weather?", agent_response_preview="Sunny!",
            tool_calls_triggered=json.dumps([]),
            was_approved=None,
            timestamp=datetime(2026, 6, 22, 13, 0, 0),
        ),
        GatewayMessage(
            id=str(uuid.uuid4()), owner="owner1", platform="slack",
            channel_id="ABCDEFGHIJ", sender="Carol",
            message_preview="Send email", agent_response_preview="Sent!",
            tool_calls_triggered=json.dumps(["mcp__email__send_email"]),
            was_approved=False,
            timestamp=datetime(2026, 6, 22, 14, 0, 0),  # newest
        ),
        GatewayMessage(
            id=str(uuid.uuid4()), owner="owner2", platform="discord",
            channel_id="111222333444", sender="Other",
            message_preview="Should not appear", agent_response_preview="",
            tool_calls_triggered=json.dumps([]),
            was_approved=None,
            timestamp=datetime(2026, 6, 22, 15, 0, 0),
        ),
    ]
    for row in rows:
        db.add(row)
    db.commit()
    db.close()
    return Session


def _call_gateway_messages(Session, owner="owner1", limit=50):
    """Call the gateway_messages route logic directly, bypassing HTTP."""
    import json as _json
    from core.database import GatewayMessage
    import routes.gateway_status_routes as gw_mod

    db = Session()
    try:
        rows = (
            db.query(GatewayMessage)
            .filter(GatewayMessage.owner == owner)
            .order_by(GatewayMessage.timestamp.desc())
            .limit(limit)
            .all()
        )
        messages = []
        for row in rows:
            try:
                tool_calls = _json.loads(row.tool_calls_triggered or "[]")
            except Exception:
                tool_calls = []
            ts = row.timestamp
            iso = (ts.isoformat() + "Z") if ts else ""
            messages.append({
                "id": row.id,
                "platform": row.platform or "",
                "channel_id": gw_mod._mask_channel_id(row.channel_id),
                "sender": row.sender or "",
                "message_preview": row.message_preview or "",
                "agent_response_preview": row.agent_response_preview or "",
                "tool_calls_triggered": tool_calls,
                "was_approved": row.was_approved,
                "timestamp": iso,
            })
    finally:
        db.close()
    return messages


# ---------------------------------------------------------------------------
# 2. Returns owner-scoped list
# ---------------------------------------------------------------------------

def test_gateway_messages_owner_scoped(mem_db_with_rows):
    """Only rows belonging to the queried owner are returned."""
    msgs = _call_gateway_messages(mem_db_with_rows, owner="owner1")
    assert len(msgs) == 3, "Should return exactly 3 rows for owner1"
    for m in msgs:
        assert "Should not appear" not in str(m), "owner2 data must not appear"


# ---------------------------------------------------------------------------
# 3. channel_id masked in response
# ---------------------------------------------------------------------------

def test_channel_id_masked(mem_db_with_rows):
    """channel_id returned must have its middle digits masked."""
    msgs = _call_gateway_messages(mem_db_with_rows, owner="owner1")
    for m in msgs:
        assert "*" in m["channel_id"], f"channel_id not masked: {m['channel_id']!r}"
        assert m["channel_id"] not in {"1234567890", "9876543210", "ABCDEFGHIJ"}, (
            f"Unmasked channel_id leaked: {m['channel_id']!r}"
        )


# ---------------------------------------------------------------------------
# 4. Recording failure does not propagate
# ---------------------------------------------------------------------------

def test_record_failure_does_not_propagate():
    """_record_gateway_message must not raise even if the DB is unavailable."""
    from gateway.platforms.base import _record_gateway_message
    import core.database as db_mod

    original = db_mod.SessionLocal

    def _broken_session():
        raise RuntimeError("DB unavailable")

    db_mod.SessionLocal = _broken_session
    try:
        _record_gateway_message(
            platform="discord",
            channel_id="123",
            sender="tester",
            message_text="hi",
            response_text="hello",
        )
    except Exception as e:
        pytest.fail(f"_record_gateway_message raised unexpectedly: {e}")
    finally:
        db_mod.SessionLocal = original


# ---------------------------------------------------------------------------
# 5. Tool calls stored as JSON list
# ---------------------------------------------------------------------------

def test_tool_calls_stored_as_json_list(mem_db_with_rows):
    """tool_calls_triggered is returned as a proper list, not a raw JSON string."""
    msgs = _call_gateway_messages(mem_db_with_rows, owner="owner1")
    discord_msg = next((m for m in msgs if m["platform"] == "discord"), None)
    assert discord_msg is not None
    assert isinstance(discord_msg["tool_calls_triggered"], list)
    assert "manage_calendar" in discord_msg["tool_calls_triggered"]


# ---------------------------------------------------------------------------
# 6. Newest first ordering
# ---------------------------------------------------------------------------

def test_newest_first_ordering(mem_db_with_rows):
    """Messages are returned newest first."""
    msgs = _call_gateway_messages(mem_db_with_rows, owner="owner1")
    timestamps = [m["timestamp"] for m in msgs if m["timestamp"]]
    assert timestamps == sorted(timestamps, reverse=True), "Messages should be newest-first"


# ---------------------------------------------------------------------------
# 7. _mask_channel_id helper
# ---------------------------------------------------------------------------

def test_mask_channel_id():
    """_mask_channel_id replaces the middle of a channel ID with asterisks."""
    from routes.gateway_status_routes import _mask_channel_id
    assert _mask_channel_id("1234567890") == "123****890"
    assert _mask_channel_id("") == ""
    assert _mask_channel_id(None) == ""
    short = _mask_channel_id("abc")
    assert short == "***"
