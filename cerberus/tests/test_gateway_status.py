"""GET /api/gateway/status — owner-only dashboard snapshot.

Covers the five invariants from the gateway-dashboard spec:
  1. Endpoint returns 200 with all required response keys.
  2. email_enabled is False when GATEWAY_EMAIL_ALLOWLIST is unset.
  3. email_enabled is True when GATEWAY_EMAIL_ALLOWLIST is non-empty.
  4. email_allowlist_count matches the number of distinct addresses
     (de-duped + lowercased to match the approve handler's parsing).
  5. platforms.{discord,telegram,slack} = 'configured' iff the matching
     *_BOT_TOKEN env var is set.

Fast lane (no @pytest.mark.slow). No real DB / HTTP / network. Builds a
disposable FastAPI app with require_user patched to a no-op so the route
focuses on its own logic.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI
from fastapi.testclient import TestClient

import routes.gateway_status_routes as gw_status


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_PLATFORM_ENV_KEYS = ("DISCORD_BOT_TOKEN", "TELEGRAM_BOT_TOKEN", "SLACK_BOT_TOKEN")


@pytest.fixture
def client(monkeypatch):
    """A TestClient mounted on a disposable FastAPI app with require_user
    monkeypatched to a no-op. Also nulls every platform/email env var so each
    test starts from a known empty baseline and opts in by re-setting them."""
    monkeypatch.setattr(gw_status, "require_user", lambda req: "owner")
    for key in (*_PLATFORM_ENV_KEYS, "GATEWAY_EMAIL_ALLOWLIST"):
        monkeypatch.delenv(key, raising=False)
    app = FastAPI()
    app.include_router(gw_status.setup_gateway_status_routes())
    return TestClient(app)


# ---------------------------------------------------------------------------
# 1. /status returns 200 with required keys
# ---------------------------------------------------------------------------

_REQUIRED_KEYS = {
    "gateway_enabled",
    "platforms",
    "email_allowlist_count",
    "email_enabled",
    "pending_approvals",
    "recent_approvals",
}


def test_status_returns_200_with_required_keys(client):
    r = client.get("/api/gateway/status")
    assert r.status_code == 200, r.text
    body = r.json()
    missing = _REQUIRED_KEYS - set(body.keys())
    assert not missing, f"missing keys in /api/gateway/status response: {missing}"
    assert isinstance(body["platforms"], dict)
    assert set(body["platforms"].keys()) == {"discord", "telegram", "slack"}
    assert isinstance(body["recent_approvals"], list)
    assert isinstance(body["pending_approvals"], int)
    assert isinstance(body["email_allowlist_count"], int)
    assert isinstance(body["email_enabled"], bool)
    assert isinstance(body["gateway_enabled"], bool)


# ---------------------------------------------------------------------------
# 2. email_enabled False when GATEWAY_EMAIL_ALLOWLIST unset
# ---------------------------------------------------------------------------

def test_email_enabled_false_when_allowlist_unset(client, monkeypatch):
    monkeypatch.delenv("GATEWAY_EMAIL_ALLOWLIST", raising=False)
    body = client.get("/api/gateway/status").json()
    assert body["email_enabled"] is False
    assert body["email_allowlist_count"] == 0


def test_email_enabled_false_when_allowlist_blank(client, monkeypatch):
    # Whitespace-only is the same as unset (mirrors the approve handler's parsing).
    monkeypatch.setenv("GATEWAY_EMAIL_ALLOWLIST", "   ")
    body = client.get("/api/gateway/status").json()
    assert body["email_enabled"] is False
    assert body["email_allowlist_count"] == 0


# ---------------------------------------------------------------------------
# 3. email_enabled True when GATEWAY_EMAIL_ALLOWLIST has one address
# ---------------------------------------------------------------------------

def test_email_enabled_true_when_allowlist_one_address(client, monkeypatch):
    monkeypatch.setenv("GATEWAY_EMAIL_ALLOWLIST", "alice@example.com")
    body = client.get("/api/gateway/status").json()
    assert body["email_enabled"] is True
    assert body["email_allowlist_count"] == 1


# ---------------------------------------------------------------------------
# 4. email_allowlist_count matches address count (de-dup + case fold)
# ---------------------------------------------------------------------------

def test_email_allowlist_count_matches_distinct_addresses(client, monkeypatch):
    # 3 raw entries with duplicates and mixed case — should de-dupe to 2.
    monkeypatch.setenv(
        "GATEWAY_EMAIL_ALLOWLIST",
        "alice@example.com, BOB@Example.com, , alice@EXAMPLE.com",
    )
    body = client.get("/api/gateway/status").json()
    assert body["email_allowlist_count"] == 2
    assert body["email_enabled"] is True


def test_email_allowlist_count_three_addresses(client, monkeypatch):
    monkeypatch.setenv(
        "GATEWAY_EMAIL_ALLOWLIST",
        "a@x.com,b@y.com,c@z.com",
    )
    body = client.get("/api/gateway/status").json()
    assert body["email_allowlist_count"] == 3
    assert body["email_enabled"] is True


# ---------------------------------------------------------------------------
# 5. platforms reflect bot-token env vars
# ---------------------------------------------------------------------------

def test_platforms_all_not_configured_by_default(client):
    body = client.get("/api/gateway/status").json()
    assert body["platforms"] == {
        "discord": "not_configured",
        "telegram": "not_configured",
        "slack": "not_configured",
    }
    assert body["gateway_enabled"] is False


def test_platforms_discord_configured_when_token_set(client, monkeypatch):
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "abc123")
    body = client.get("/api/gateway/status").json()
    assert body["platforms"]["discord"] == "configured"
    assert body["platforms"]["telegram"] == "not_configured"
    assert body["platforms"]["slack"] == "not_configured"
    assert body["gateway_enabled"] is True


def test_platforms_all_three_configured(client, monkeypatch):
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "d")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "t")
    monkeypatch.setenv("SLACK_BOT_TOKEN", "s")
    body = client.get("/api/gateway/status").json()
    assert body["platforms"] == {
        "discord": "configured",
        "telegram": "configured",
        "slack": "configured",
    }
    assert body["gateway_enabled"] is True


def test_platforms_whitespace_token_treated_as_not_configured(client, monkeypatch):
    # The approve / config layer already strips bot tokens; the status check
    # mirrors that so a value like "   " doesn't show a misleading "CONNECTED".
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "   ")
    body = client.get("/api/gateway/status").json()
    assert body["platforms"]["discord"] == "not_configured"
