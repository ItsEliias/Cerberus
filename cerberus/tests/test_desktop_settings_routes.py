"""Tests for routes/desktop_settings_routes.py — the admin Docker-features toggle.

Covers the GET/POST settings round-trip: persistence to desktop_settings.json,
API-key masking + keep-on-blank, input validation, the enable toggle, and the
status endpoint shape. Auth is stubbed (require_admin -> no-op); the endpoints'
own admin gating is exercised by the shared auth tests, not here.
"""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routes.desktop_settings_routes as mod


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Redirect the settings file into a temp dir and bypass the admin gate.
    monkeypatch.setattr(mod, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(mod, "require_admin", lambda request: None)
    app = FastAPI()
    app.include_router(mod.setup_desktop_settings_routes())
    c = TestClient(app)
    c._settings_file = tmp_path / "desktop_settings.json"  # convenience handle
    return c


def test_get_defaults_when_no_file(client):
    r = client.get("/api/desktop/settings")
    assert r.status_code == 200
    data = r.json()
    # Off by default, and the UI is told a restart is needed to apply.
    assert data["CERBERUS_SANDBOX_ENABLED"] is False
    assert data["_meta"]["restart_required_to_apply"] is True
    assert "sandbox_execution" in data["_meta"]["docker_features"]


def test_post_persists_and_roundtrips(client):
    r = client.post("/api/desktop/settings", json={
        "CERBERUS_SANDBOX_ENABLED": True,
        "SANDBOX_URL": "http://localhost:8090",
        "SEARCH_SEARXNG_INSTANCE": "http://localhost:8080",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["restart_required"] is True

    # File written with the expected shape.
    saved = json.loads(client._settings_file.read_text())
    assert saved["CERBERUS_SANDBOX_ENABLED"] == "true"
    assert saved["SANDBOX_URL"] == "http://localhost:8090"

    # GET reflects it, with the boolean coerced back to a real bool.
    got = client.get("/api/desktop/settings").json()
    assert got["CERBERUS_SANDBOX_ENABLED"] is True
    assert got["SANDBOX_URL"] == "http://localhost:8090"
    assert got["SEARCH_SEARXNG_INSTANCE"] == "http://localhost:8080"


def test_api_key_is_masked_and_kept_on_blank(client):
    client.post("/api/desktop/settings", json={"SANDBOX_API_KEY": "super-secret-key"})
    got = client.get("/api/desktop/settings").json()
    # Never leak the raw key back to the UI.
    assert got["SANDBOX_API_KEY"].startswith("****")
    assert "super-secret" not in got["SANDBOX_API_KEY"]

    # Re-POSTing the masked value must NOT overwrite the stored secret.
    client.post("/api/desktop/settings", json={"SANDBOX_API_KEY": got["SANDBOX_API_KEY"]})
    saved = json.loads(client._settings_file.read_text())
    assert saved["SANDBOX_API_KEY"] == "super-secret-key"


def test_invalid_url_rejected(client):
    r = client.post("/api/desktop/settings", json={"SANDBOX_URL": "not-a-url"})
    assert r.status_code == 400
    assert "SANDBOX_URL" in r.json()["detail"]


def test_non_integer_timeout_rejected(client):
    r = client.post("/api/desktop/settings", json={"SANDBOX_TIMEOUT": "abc"})
    assert r.status_code == 400


def test_blank_value_removes_key(client):
    client.post("/api/desktop/settings", json={"SANDBOX_URL": "http://localhost:8090"})
    assert "SANDBOX_URL" in json.loads(client._settings_file.read_text())
    client.post("/api/desktop/settings", json={"SANDBOX_URL": ""})
    assert "SANDBOX_URL" not in json.loads(client._settings_file.read_text())


def test_status_reports_disabled(client, monkeypatch):
    monkeypatch.setenv("CERBERUS_SANDBOX_ENABLED", "false")
    r = client.get("/api/desktop/settings/status")
    assert r.status_code == 200
    data = r.json()
    assert data["enabled"] is False
    assert "reachable" in data and "sandbox_url" in data
