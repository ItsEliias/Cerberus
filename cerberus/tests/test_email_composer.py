"""Tests for the CC email composer endpoints.

Four spec invariants:
  1. Send to an allowlisted recipient succeeds.
  2. Send to a non-allowlisted recipient returns 403.
  3. Empty to/subject/body returns 400.
  4. The correct downstream helpers are called with the correct fields
     (verifies the wrapper isn't silently dropping a value before hand-off).

Fast lane. No real SMTP; the helpers are stubbed via module-level
monkeypatching so the test focuses on the wrapper's logic.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import routes.email_compose_routes as ecr


# ── Fixtures ──────────────────────────────────────────────────────────────

@pytest.fixture
def fake_smtp(monkeypatch):
    """Capture calls to the lazy-imported SMTP helpers.

    `compose_send` resolves these via lazy imports inside the closure
    (so the module stays importable without routes.email_routes). To
    intercept, we plant lambdas on the modules from which the closure
    pulls them.
    """
    state = {"sent": None, "resolve_owner": "alice", "smtp_config": {
        "from_address": "noreply@example.com",
        "smtp_host": "smtp.example.com",
        "smtp_port": 587,
        "smtp_user": "noreply@example.com",
        "smtp_password": "secret",
        "smtp_security": "starttls",
    }}

    # Patch require_user on src.auth_helpers (closure imports lazily)
    import src.auth_helpers as ah
    monkeypatch.setattr(ah, "require_user", lambda req: state["resolve_owner"])

    # Patch _resolve_send_config on routes.email_routes
    import routes.email_routes as er
    monkeypatch.setattr(er, "_resolve_send_config",
                        lambda account_id, owner="": dict(state["smtp_config"]))

    # Patch _send_smtp_message on routes.email_helpers; capture the call
    import routes.email_helpers as eh
    def _fake_send(cfg, from_addr, recipients, message, timeout=30):
        state["sent"] = {
            "cfg": cfg,
            "from": from_addr,
            "recipients": list(recipients),
            "message": message,
        }
    monkeypatch.setattr(eh, "_send_smtp_message", _fake_send)
    return state


@pytest.fixture
def client(monkeypatch, fake_smtp):
    """Disposable FastAPI app with just the compose routes mounted."""
    app = FastAPI()
    app.include_router(ecr.setup_email_compose_routes())
    # Each test sets GATEWAY_EMAIL_ALLOWLIST explicitly; start from a
    # known-empty baseline.
    monkeypatch.delenv("GATEWAY_EMAIL_ALLOWLIST", raising=False)
    return TestClient(app)


# ── Tests ─────────────────────────────────────────────────────────────────

# 1. Allowlisted recipient succeeds.

def test_send_to_allowlisted_recipient_succeeds(client, monkeypatch, fake_smtp):
    monkeypatch.setenv("GATEWAY_EMAIL_ALLOWLIST", "alice@example.com")
    r = client.post("/api/email/compose-send", json={
        "to": "alice@example.com",
        "subject": "Hello",
        "body": "Test message.",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body == {"ok": True, "error": None}
    # SMTP helper was invoked
    assert fake_smtp["sent"] is not None
    assert fake_smtp["sent"]["recipients"] == ["alice@example.com"]


def test_send_case_insensitive_match(client, monkeypatch, fake_smtp):
    monkeypatch.setenv("GATEWAY_EMAIL_ALLOWLIST", "ALICE@example.com")
    r = client.post("/api/email/compose-send", json={
        "to": "alice@EXAMPLE.com",
        "subject": "Hi",
        "body": "msg",
    })
    assert r.status_code == 200, r.text


# 2. Non-allowlisted recipient returns 403.

def test_send_to_non_allowlisted_recipient_returns_403(client, monkeypatch, fake_smtp):
    monkeypatch.setenv("GATEWAY_EMAIL_ALLOWLIST", "alice@example.com")
    r = client.post("/api/email/compose-send", json={
        "to": "attacker@evil.example",
        "subject": "Hello",
        "body": "Test message.",
    })
    assert r.status_code == 403
    assert "GATEWAY_EMAIL_ALLOWLIST" in r.text
    # SMTP helper was NOT invoked
    assert fake_smtp["sent"] is None


def test_send_with_empty_allowlist_returns_403(client, monkeypatch, fake_smtp):
    monkeypatch.delenv("GATEWAY_EMAIL_ALLOWLIST", raising=False)
    r = client.post("/api/email/compose-send", json={
        "to": "alice@example.com",
        "subject": "Hi",
        "body": "m",
    })
    assert r.status_code == 403
    assert "empty" in r.text.lower() or "GATEWAY_EMAIL_ALLOWLIST" in r.text


# 3. Empty to/subject/body returns 400.

def test_send_empty_to_returns_400(client, monkeypatch):
    monkeypatch.setenv("GATEWAY_EMAIL_ALLOWLIST", "alice@example.com")
    r = client.post("/api/email/compose-send", json={
        "to": "",
        "subject": "Hi",
        "body": "m",
    })
    assert r.status_code == 400


def test_send_empty_subject_returns_400(client, monkeypatch):
    monkeypatch.setenv("GATEWAY_EMAIL_ALLOWLIST", "alice@example.com")
    r = client.post("/api/email/compose-send", json={
        "to": "alice@example.com",
        "subject": "",
        "body": "m",
    })
    assert r.status_code == 400


def test_send_empty_body_returns_400(client, monkeypatch):
    monkeypatch.setenv("GATEWAY_EMAIL_ALLOWLIST", "alice@example.com")
    r = client.post("/api/email/compose-send", json={
        "to": "alice@example.com",
        "subject": "Hi",
        "body": "",
    })
    assert r.status_code == 400


def test_send_whitespace_only_body_returns_400(client, monkeypatch):
    monkeypatch.setenv("GATEWAY_EMAIL_ALLOWLIST", "alice@example.com")
    r = client.post("/api/email/compose-send", json={
        "to": "alice@example.com",
        "subject": "Hi",
        "body": "   \n\t ",
    })
    assert r.status_code == 400


# 4. Correct endpoint called with correct fields.
#    (The wrapper hands a fully-built EmailMessage to _send_smtp_message;
#    confirm Subject + recipients + body all propagate.)

def test_send_passes_correct_fields_through(client, monkeypatch, fake_smtp):
    monkeypatch.setenv("GATEWAY_EMAIL_ALLOWLIST", "alice@example.com")
    r = client.post("/api/email/compose-send", json={
        "to": "alice@example.com",
        "subject": "Urgent: please review",
        "body": "Line one\nLine two",
    })
    assert r.status_code == 200, r.text
    captured = fake_smtp["sent"]
    assert captured is not None
    assert captured["recipients"] == ["alice@example.com"]
    assert captured["from"] == "noreply@example.com"
    # The serialized message string carries the Subject header and body
    msg = captured["message"]
    assert "Urgent: please review" in msg
    assert "Line one" in msg
    assert "Line two" in msg
    # From: header propagated
    assert "noreply@example.com" in msg
    # SMTP config keys propagated
    assert captured["cfg"]["smtp_host"] == "smtp.example.com"
    assert captured["cfg"]["smtp_port"] == 587


def test_compose_allowlist_endpoint_returns_addresses(client, monkeypatch):
    monkeypatch.setenv(
        "GATEWAY_EMAIL_ALLOWLIST",
        "ALICE@example.com, bob@example.com , alice@EXAMPLE.com",
    )
    r = client.get("/api/email/compose-allowlist")
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is True
    assert body["count"] == 2
    # Case-folded + de-duped
    assert set(body["addresses"]) == {"alice@example.com", "bob@example.com"}


def test_compose_allowlist_endpoint_empty_when_unset(client, monkeypatch):
    monkeypatch.delenv("GATEWAY_EMAIL_ALLOWLIST", raising=False)
    r = client.get("/api/email/compose-allowlist")
    assert r.status_code == 200
    body = r.json()
    assert body == {"addresses": [], "count": 0, "enabled": False}


def test_send_smtp_failure_returns_ok_false_with_error(client, monkeypatch, fake_smtp):
    """When SMTP raises, the wrapper catches it and surfaces {ok: False}
    so the composer can render // FAILED rather than a generic 500."""
    monkeypatch.setenv("GATEWAY_EMAIL_ALLOWLIST", "alice@example.com")

    import routes.email_helpers as eh
    def _boom(*args, **kwargs):
        raise RuntimeError("simulated SMTP refusal")
    monkeypatch.setattr(eh, "_send_smtp_message", _boom)

    r = client.post("/api/email/compose-send", json={
        "to": "alice@example.com",
        "subject": "Hi",
        "body": "m",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert "SMTP" in body["error"] or "simulated" in body["error"]
