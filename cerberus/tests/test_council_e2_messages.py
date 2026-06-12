"""Phase E2 smoke tests: CerberusAgentMessage CRUD + messaging routes."""

import tempfile
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from tests.helpers.import_state import clear_fake_database_modules

clear_fake_database_modules()

import core.database as cdb
import routes.cerberus_agent_routes as car
from core.database import CerberusAgent, CerberusAgentMessage

# ---- Isolated in-memory DB ----

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)
car.SessionLocal = _TS


def _req(user="alice"):
    return SimpleNamespace(state=SimpleNamespace(current_user=user))


def _make_agent(owner="alice") -> str:
    db = _TS()
    try:
        agent = CerberusAgent(
            id=str(uuid.uuid4()),
            owner=owner,
            name=f"TestAgent-{uuid.uuid4().hex[:6]}",
            role="tester",
            agent_type="tester",
            system_prompt="You are a test agent.",
            status="idle",
            model_alias="sonnet",
        )
        db.add(agent)
        db.commit()
        return agent.id
    finally:
        db.close()


def _route(method: str, path: str):
    router = car.setup_cerberus_agent_routes()
    for route in router.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set()):
            return route.endpoint
    raise KeyError(f"{method} {path} not found")


# ---- Tests ----

def test_get_messages_empty():
    agent_id = _make_agent()
    fn = _route("GET", "/api/agents/{agent_id}/messages")
    result = fn(agent_id=agent_id, request=_req(), limit=100)
    assert result == {"messages": []}


def test_get_messages_401_unauth(monkeypatch):
    agent_id = _make_agent()
    fn = _route("GET", "/api/agents/{agent_id}/messages")
    monkeypatch.setattr(car, "require_user", lambda r: (_ for _ in ()).throw(HTTPException(401, "Unauthorized")))
    req = SimpleNamespace(state=SimpleNamespace(current_user=None))
    with pytest.raises(HTTPException) as exc_info:
        fn(agent_id=agent_id, request=req, limit=100)
    assert exc_info.value.status_code == 401


def test_get_messages_404_unknown_agent():
    fn = _route("GET", "/api/agents/{agent_id}/messages")
    with pytest.raises(HTTPException) as exc_info:
        fn(agent_id="no-such-id", request=_req(), limit=100)
    assert exc_info.value.status_code == 404


def test_get_messages_403_wrong_owner():
    agent_id = _make_agent(owner="alice")
    fn = _route("GET", "/api/agents/{agent_id}/messages")
    with pytest.raises(HTTPException) as exc_info:
        fn(agent_id=agent_id, request=_req(user="eve"), limit=100)
    assert exc_info.value.status_code == 403


def test_delete_messages_clears():
    agent_id = _make_agent()
    db = _TS()
    try:
        for role in ("user", "agent"):
            db.add(CerberusAgentMessage(
                id=str(uuid.uuid4()), agent_id=agent_id,
                owner="alice", role=role, content="hello",
            ))
        db.commit()
    finally:
        db.close()

    fn_del = _route("DELETE", "/api/agents/{agent_id}/messages")
    result = fn_del(agent_id=agent_id, request=_req())
    assert result["deleted"] == 2

    fn_get = _route("GET", "/api/agents/{agent_id}/messages")
    result2 = fn_get(agent_id=agent_id, request=_req(), limit=100)
    assert result2["messages"] == []


def test_message_model_to_dict():
    agent_id = _make_agent()
    msg = CerberusAgentMessage(
        id="test-uuid",
        agent_id=agent_id,
        owner="alice",
        role="user",
        content="hello world",
    )
    d = msg.to_dict()
    assert d["id"] == "test-uuid"
    assert d["role"] == "user"
    assert d["content"] == "hello world"
    assert d["agent_id"] == agent_id


def test_get_messages_limit():
    agent_id = _make_agent()
    db = _TS()
    try:
        for i in range(10):
            db.add(CerberusAgentMessage(
                id=str(uuid.uuid4()), agent_id=agent_id,
                owner="alice", role="user", content=f"msg {i}",
            ))
        db.commit()
    finally:
        db.close()

    fn = _route("GET", "/api/agents/{agent_id}/messages")
    result = fn(agent_id=agent_id, request=_req(), limit=5)
    assert len(result["messages"]) == 5
