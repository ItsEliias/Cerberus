"""Tests for GET /api/cyberapps/operations/gateway endpoint."""

from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch


def _make_client():
    from fastapi.testclient import TestClient
    from fastapi import FastAPI
    from routes.cyberapps_routes import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# ── Structure tests ──────────────────────────────────────────────────────────

def test_gateway_returns_two_platforms(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("DISCORD_BOT_TOKEN", raising=False)
    with patch("core.database.SessionLocal", side_effect=Exception("no db")):
        client = _make_client()
        r = client.get("/api/cyberapps/operations/gateway")
    assert r.status_code == 200
    data = r.json()
    names = [p["name"] for p in data["platforms"]]
    assert "telegram" in names
    assert "discord"  in names


def test_gateway_platform_schema(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("DISCORD_BOT_TOKEN", raising=False)
    with patch("core.database.SessionLocal", side_effect=Exception("no db")):
        client = _make_client()
        r = client.get("/api/cyberapps/operations/gateway")
    for p in r.json()["platforms"]:
        assert "name"       in p
        assert "configured" in p
        assert "last_seen"  in p
        assert "status"     in p


# ── configured flag ──────────────────────────────────────────────────────────

def test_telegram_configured_when_token_set(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:ABC")
    monkeypatch.delenv("DISCORD_BOT_TOKEN", raising=False)
    with patch("core.database.SessionLocal", side_effect=Exception("no db")):
        client = _make_client()
        r = client.get("/api/cyberapps/operations/gateway")
    tg = next(p for p in r.json()["platforms"] if p["name"] == "telegram")
    assert tg["configured"] is True


def test_telegram_not_configured_when_no_token(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    with patch("core.database.SessionLocal", side_effect=Exception("no db")):
        client = _make_client()
        r = client.get("/api/cyberapps/operations/gateway")
    tg = next(p for p in r.json()["platforms"] if p["name"] == "telegram")
    assert tg["configured"] is False
    assert tg["status"] == "unconfigured"


def test_discord_configured_when_token_set(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "Bot.Token.Here")
    with patch("core.database.SessionLocal", side_effect=Exception("no db")):
        client = _make_client()
        r = client.get("/api/cyberapps/operations/gateway")
    dc = next(p for p in r.json()["platforms"] if p["name"] == "discord")
    assert dc["configured"] is True


# ── Status rules ─────────────────────────────────────────────────────────────

def _make_db_with_last_seen(delta_seconds: int | None):
    """Return a mock SessionLocal that yields last_message_at = now - delta."""
    mock_db = MagicMock()
    if delta_seconds is None:
        mock_db.execute.return_value.fetchone.return_value = (None,)
    else:
        ts = datetime.now(timezone.utc) - timedelta(seconds=delta_seconds)
        mock_db.execute.return_value.fetchone.return_value = (ts.isoformat(),)
    mock_db.close = MagicMock()
    mock_sl = MagicMock(return_value=mock_db)
    return mock_sl


def test_status_active_when_seen_recently(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "tok")
    mock_sl = _make_db_with_last_seen(60)  # 1 minute ago
    with patch("core.database.SessionLocal", mock_sl):
        client = _make_client()
        r = client.get("/api/cyberapps/operations/gateway")
    tg = next(p for p in r.json()["platforms"] if p["name"] == "telegram")
    assert tg["status"] == "active"


def test_status_idle_when_seen_30_min_ago(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "tok")
    mock_sl = _make_db_with_last_seen(1800)  # 30 minutes ago
    with patch("core.database.SessionLocal", mock_sl):
        client = _make_client()
        r = client.get("/api/cyberapps/operations/gateway")
    tg = next(p for p in r.json()["platforms"] if p["name"] == "telegram")
    assert tg["status"] == "idle"


def test_status_offline_when_seen_2h_ago(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "tok")
    mock_sl = _make_db_with_last_seen(7200)  # 2 hours ago
    with patch("core.database.SessionLocal", mock_sl):
        client = _make_client()
        r = client.get("/api/cyberapps/operations/gateway")
    tg = next(p for p in r.json()["platforms"] if p["name"] == "telegram")
    assert tg["status"] == "offline"


def test_status_offline_when_never_seen(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "tok")
    mock_sl = _make_db_with_last_seen(None)
    with patch("core.database.SessionLocal", mock_sl):
        client = _make_client()
        r = client.get("/api/cyberapps/operations/gateway")
    tg = next(p for p in r.json()["platforms"] if p["name"] == "telegram")
    assert tg["status"] == "offline"
    assert tg["last_seen"] is None


def test_last_seen_iso_returned(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "tok")
    mock_sl = _make_db_with_last_seen(120)
    with patch("core.database.SessionLocal", mock_sl):
        client = _make_client()
        r = client.get("/api/cyberapps/operations/gateway")
    tg = next(p for p in r.json()["platforms"] if p["name"] == "telegram")
    assert tg["last_seen"] is not None
    datetime.fromisoformat(tg["last_seen"])  # must be valid ISO string


def test_db_failure_does_not_crash(monkeypatch):
    """If the DB is unavailable the endpoint still returns 200 with offline status."""
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "tok")
    with patch("core.database.SessionLocal", side_effect=RuntimeError("db gone")):
        client = _make_client()
        r = client.get("/api/cyberapps/operations/gateway")
    assert r.status_code == 200
    tg = next(p for p in r.json()["platforms"] if p["name"] == "telegram")
    assert tg["status"] == "offline"


def test_gateway_user_env_respected(monkeypatch):
    """CERBERUS_GATEWAY_USER controls which owner is queried."""
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "tok")
    monkeypatch.setenv("CERBERUS_GATEWAY_USER", "mybot")

    mock_db = MagicMock()
    mock_db.execute.return_value.fetchone.return_value = (None,)
    mock_db.close = MagicMock()
    mock_sl = MagicMock(return_value=mock_db)

    with patch("core.database.SessionLocal", mock_sl):
        client = _make_client()
        client.get("/api/cyberapps/operations/gateway")

    call_args = mock_db.execute.call_args
    assert call_args[0][1]["owner"] == "mybot"
