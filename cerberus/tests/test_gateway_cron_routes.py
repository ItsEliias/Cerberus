"""Tests for the gateway cron job management API (routes/gateway_routes.py)."""

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


# ── Minimal app fixture ───────────────────────────────────────────────────────

@pytest.fixture()
def tmp_jobs_file(tmp_path):
    return tmp_path / "cron_jobs.json"


@pytest.fixture()
def client(tmp_jobs_file):
    from fastapi import FastAPI
    from routes.gateway_routes import router

    app = FastAPI()
    app.include_router(router)

    with patch("routes.gateway_routes._JOBS_PATH", tmp_jobs_file):
        with TestClient(app) as c:
            yield c


# ── Helpers ───────────────────────────────────────────────────────────────────

def _seed(tmp_path_file, jobs):
    tmp_path_file.parent.mkdir(parents=True, exist_ok=True)
    tmp_path_file.write_text(json.dumps({"jobs": jobs}))


# ── List ──────────────────────────────────────────────────────────────────────

def test_list_empty(client):
    r = client.get("/api/gateway/cron/jobs")
    assert r.status_code == 200
    assert r.json() == {"jobs": []}


def test_list_returns_jobs(client, tmp_jobs_file):
    _seed(tmp_jobs_file, [
        {"id": "j1", "name": "Job 1", "prompt": "hello", "cron": "0 9 * * *",
         "platform": "telegram", "chat_id": 123, "enabled": True},
    ])
    with patch("routes.gateway_routes._JOBS_PATH", tmp_jobs_file):
        r = client.get("/api/gateway/cron/jobs")
    assert r.status_code == 200
    assert len(r.json()["jobs"]) == 1
    assert r.json()["jobs"][0]["name"] == "Job 1"


# ── Create ────────────────────────────────────────────────────────────────────

def test_create_minimal(client, tmp_jobs_file):
    with patch("routes.gateway_routes._JOBS_PATH", tmp_jobs_file):
        r = client.post("/api/gateway/cron/jobs", json={
            "name": "Daily summary",
            "prompt": "Summarise today",
            "cron": "0 9 * * *",
            "platform": "telegram",
        })
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Daily summary"
    assert "id" in data


def test_create_with_explicit_id(client, tmp_jobs_file):
    with patch("routes.gateway_routes._JOBS_PATH", tmp_jobs_file):
        r = client.post("/api/gateway/cron/jobs", json={
            "id": "my-job",
            "name": "My job",
            "prompt": "Do something",
            "cron": "*/5 * * * *",
            "platform": "discord",
        })
    assert r.status_code == 201
    assert r.json()["id"] == "my-job"


def test_create_duplicate_id_rejected(client, tmp_jobs_file):
    payload = {
        "id": "dupe-job",
        "name": "Job",
        "prompt": "hi",
        "cron": "0 * * * *",
        "platform": "telegram",
    }
    with patch("routes.gateway_routes._JOBS_PATH", tmp_jobs_file):
        r1 = client.post("/api/gateway/cron/jobs", json=payload)
        assert r1.status_code == 201
        r2 = client.post("/api/gateway/cron/jobs", json=payload)
        assert r2.status_code == 409


def test_create_missing_name_rejected(client, tmp_jobs_file):
    with patch("routes.gateway_routes._JOBS_PATH", tmp_jobs_file):
        r = client.post("/api/gateway/cron/jobs", json={
            "prompt": "hi", "cron": "0 9 * * *",
        })
    assert r.status_code == 422


def test_create_missing_prompt_rejected(client, tmp_jobs_file):
    with patch("routes.gateway_routes._JOBS_PATH", tmp_jobs_file):
        r = client.post("/api/gateway/cron/jobs", json={
            "name": "job", "cron": "0 9 * * *",
        })
    assert r.status_code == 422


def test_create_invalid_platform_rejected(client, tmp_jobs_file):
    with patch("routes.gateway_routes._JOBS_PATH", tmp_jobs_file):
        r = client.post("/api/gateway/cron/jobs", json={
            "name": "job", "prompt": "hi", "cron": "0 9 * * *",
            "platform": "irc",
        })
    assert r.status_code == 422


def test_create_invalid_id_format_rejected(client, tmp_jobs_file):
    with patch("routes.gateway_routes._JOBS_PATH", tmp_jobs_file):
        r = client.post("/api/gateway/cron/jobs", json={
            "id": "../evil",
            "name": "job", "prompt": "hi", "cron": "0 9 * * *",
        })
    assert r.status_code == 422


# ── Update ────────────────────────────────────────────────────────────────────

def test_update_enabled_flag(client, tmp_jobs_file):
    _seed(tmp_jobs_file, [
        {"id": "j1", "name": "J", "prompt": "hi", "cron": "0 9 * * *",
         "platform": "telegram", "chat_id": 0, "enabled": True},
    ])
    with patch("routes.gateway_routes._JOBS_PATH", tmp_jobs_file):
        r = client.put("/api/gateway/cron/jobs/j1", json={"enabled": False})
    assert r.status_code == 200
    assert r.json()["enabled"] is False


def test_update_not_found(client, tmp_jobs_file):
    with patch("routes.gateway_routes._JOBS_PATH", tmp_jobs_file):
        r = client.put("/api/gateway/cron/jobs/nonexistent", json={"enabled": True})
    assert r.status_code == 404


def test_update_invalid_id_format(client, tmp_jobs_file):
    with patch("routes.gateway_routes._JOBS_PATH", tmp_jobs_file):
        r = client.put("/api/gateway/cron/jobs/..%2Fevil", json={"enabled": True})
    assert r.status_code in (400, 404, 422)


def test_update_name(client, tmp_jobs_file):
    _seed(tmp_jobs_file, [
        {"id": "j1", "name": "Old name", "prompt": "hi", "cron": "0 9 * * *",
         "platform": "telegram", "chat_id": 0, "enabled": True},
    ])
    with patch("routes.gateway_routes._JOBS_PATH", tmp_jobs_file):
        r = client.put("/api/gateway/cron/jobs/j1", json={"name": "New name"})
    assert r.status_code == 200
    assert r.json()["name"] == "New name"


# ── Delete ────────────────────────────────────────────────────────────────────

def test_delete_removes_job(client, tmp_jobs_file):
    _seed(tmp_jobs_file, [
        {"id": "to-del", "name": "Delete me", "prompt": "bye", "cron": "0 * * * *",
         "platform": "telegram", "chat_id": 0, "enabled": True},
    ])
    with patch("routes.gateway_routes._JOBS_PATH", tmp_jobs_file):
        r = client.delete("/api/gateway/cron/jobs/to-del")
        assert r.status_code == 204
        after = client.get("/api/gateway/cron/jobs")
    assert after.json()["jobs"] == []


def test_delete_not_found(client, tmp_jobs_file):
    with patch("routes.gateway_routes._JOBS_PATH", tmp_jobs_file):
        r = client.delete("/api/gateway/cron/jobs/ghost")
    assert r.status_code == 404


def test_delete_preserves_other_jobs(client, tmp_jobs_file):
    _seed(tmp_jobs_file, [
        {"id": "j1", "name": "Keep", "prompt": "hi", "cron": "0 9 * * *",
         "platform": "telegram", "chat_id": 0, "enabled": True},
        {"id": "j2", "name": "Delete", "prompt": "bye", "cron": "0 * * * *",
         "platform": "telegram", "chat_id": 0, "enabled": True},
    ])
    with patch("routes.gateway_routes._JOBS_PATH", tmp_jobs_file):
        client.delete("/api/gateway/cron/jobs/j2")
        after = client.get("/api/gateway/cron/jobs")
    remaining = [j["id"] for j in after.json()["jobs"]]
    assert remaining == ["j1"]


# ── Missing file resilience ───────────────────────────────────────────────────

def test_list_when_file_missing(client, tmp_jobs_file):
    # File does not exist — should return empty list, not 500
    assert not tmp_jobs_file.exists()
    r = client.get("/api/gateway/cron/jobs")
    assert r.status_code == 200
    assert r.json()["jobs"] == []


def test_create_creates_file_when_missing(client, tmp_jobs_file):
    assert not tmp_jobs_file.exists()
    with patch("routes.gateway_routes._JOBS_PATH", tmp_jobs_file):
        r = client.post("/api/gateway/cron/jobs", json={
            "name": "Auto-create", "prompt": "hi", "cron": "0 9 * * *",
        })
    assert r.status_code == 201
    assert tmp_jobs_file.exists()
