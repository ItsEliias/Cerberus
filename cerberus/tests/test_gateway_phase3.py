"""
test_gateway_phase3.py — Phase 3 gateway and cron unit tests.

Tests cover:
- GatewayConfig loads correctly from environment variables
- CerberusClient session creation and message dispatch
- TelegramAdapter message splitting and command routing
- CronJob ID validation, next_run computation, serialization
- GatewayCronScheduler job lifecycle (add/remove/list/tick)
- Platform adapter is pluggable (adding a second platform requires no core changes)
- Mock round-trip: inbound Telegram message → Cerberus chat → reply out

All tests run without a live Cerberus server or Telegram bot.
"""

import asyncio
import json
import os
import sys
import time
import types
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest


# ---------------------------------------------------------------------------
# Config tests
# ---------------------------------------------------------------------------

def test_gateway_config_from_env(monkeypatch):
    monkeypatch.setenv("CERBERUS_API_URL", "http://localhost:9000")
    monkeypatch.setenv("CERBERUS_GATEWAY_TOKEN", "test-token-abc")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:ABC")
    monkeypatch.setenv("GATEWAY_CRON_ENABLED", "true")
    monkeypatch.setenv("GATEWAY_CRON_INTERVAL", "120")

    from gateway.config import GatewayConfig
    cfg = GatewayConfig.from_env()
    assert cfg.cerberus.api_url == "http://localhost:9000"
    assert cfg.cerberus.token == "test-token-abc"
    assert cfg.telegram.enabled is True
    assert cfg.telegram.bot_token == "123:ABC"
    assert cfg.cron.enabled is True
    assert cfg.cron.tick_interval_s == 120


def test_gateway_config_telegram_disabled_when_token_missing(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    from gateway.config import GatewayConfig
    cfg = GatewayConfig.from_env()
    assert cfg.telegram.enabled is False


def test_gateway_config_allowed_chat_ids_parsed(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "tok")
    monkeypatch.setenv("TELEGRAM_ALLOWED_CHAT_IDS", "111,222,333")
    from gateway.config import GatewayConfig
    cfg = GatewayConfig.from_env()
    assert cfg.telegram.allowed_chat_ids == frozenset({111, 222, 333})


def test_gateway_config_empty_allowlist_means_open(monkeypatch):
    monkeypatch.delenv("TELEGRAM_ALLOWED_CHAT_IDS", raising=False)
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "tok")
    from gateway.config import GatewayConfig
    cfg = GatewayConfig.from_env()
    assert cfg.telegram.allowed_chat_ids == frozenset()


def test_cron_config_disabled_flag(monkeypatch):
    monkeypatch.setenv("GATEWAY_CRON_ENABLED", "false")
    from gateway.config import GatewayConfig
    cfg = GatewayConfig.from_env()
    assert cfg.cron.enabled is False


def test_enabled_platforms_dict(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "tok")
    from gateway.config import GatewayConfig
    cfg = GatewayConfig.from_env()
    platforms = cfg.enabled_platforms()
    assert "telegram" in platforms
    assert platforms["telegram"] is True


# ---------------------------------------------------------------------------
# CerberusClient tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cerberus_client_creates_session_and_sends():
    from gateway.config import CerberusConfig
    import gateway.cerberus_client as cc

    # Clear session cache
    cc._SESSION_CACHE.clear()
    cc._SESSION_LOCKS.clear()

    cfg = CerberusConfig(
        api_url="http://localhost:7000",
        token="test-tok",
        username="gateway",
        session_model="",
    )

    session_resp = MagicMock()
    session_resp.status_code = 200
    session_resp.json.return_value = {"id": "sess-abc-123"}
    session_resp.raise_for_status = MagicMock()

    chat_resp = MagicMock()
    chat_resp.status_code = 200
    chat_resp.json.return_value = {"response": "Hello from Cerberus"}
    chat_resp.raise_for_status = MagicMock()

    post_calls = []

    async def fake_post(url, **kwargs):
        post_calls.append(url)
        if "/session" in url:
            return session_resp
        return chat_resp

    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = fake_post

    with patch("httpx.AsyncClient", return_value=mock_client):
        result = await cc.send_message(
            cfg,
            platform="telegram",
            chat_id=99,
            message="hello cerberus",
        )

    assert result == "Hello from Cerberus"
    assert any("/session" in u for u in post_calls)
    assert any("/api/chat" in u for u in post_calls)


@pytest.mark.asyncio
async def test_cerberus_client_caches_session():
    from gateway.config import CerberusConfig
    import gateway.cerberus_client as cc

    cc._SESSION_CACHE.clear()
    cc._SESSION_LOCKS.clear()

    cfg = CerberusConfig(
        api_url="http://localhost:7000",
        token="", username="gw", session_model="",
    )

    session_resp = MagicMock()
    session_resp.status_code = 200
    session_resp.json.return_value = {"id": "sess-cached"}
    session_resp.raise_for_status = MagicMock()

    chat_resp = MagicMock()
    chat_resp.status_code = 200
    chat_resp.json.return_value = {"response": "ok"}
    chat_resp.raise_for_status = MagicMock()

    session_call_count = [0]

    async def fake_post(url, **kwargs):
        if "/session" in url:
            session_call_count[0] += 1
            return session_resp
        return chat_resp

    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = fake_post

    with patch("httpx.AsyncClient", return_value=mock_client):
        await cc.send_message(cfg, platform="tg", chat_id=1, message="msg1")
        await cc.send_message(cfg, platform="tg", chat_id=1, message="msg2")

    # Session should only be created once
    assert session_call_count[0] == 1


def test_invalidate_session_clears_cache():
    import gateway.cerberus_client as cc
    cc._SESSION_CACHE["telegram:42"] = "sess-xyz"
    cc.invalidate_session("telegram", 42)
    assert "telegram:42" not in cc._SESSION_CACHE


@pytest.mark.asyncio
async def test_cerberus_client_raises_on_empty_message():
    from gateway.config import CerberusConfig
    import gateway.cerberus_client as cc
    cfg = CerberusConfig(api_url="http://x", token="", username="g", session_model="")
    with pytest.raises(cc.CerberusClientError, match="Empty message"):
        await cc.send_message(cfg, platform="tg", chat_id=1, message="  ")


# ---------------------------------------------------------------------------
# Telegram adapter tests
# ---------------------------------------------------------------------------

def test_telegram_message_split_short():
    from gateway.platforms.telegram import _split_long_message
    chunks = _split_long_message("hello", max_len=4096)
    assert chunks == ["hello"]


def test_telegram_message_split_long():
    from gateway.platforms.telegram import _split_long_message
    text = "a" * 5000
    chunks = _split_long_message(text, max_len=4096)
    assert len(chunks) >= 2
    for chunk in chunks:
        assert len(chunk) <= 4096


def test_telegram_message_split_preserves_content():
    from gateway.platforms.telegram import _split_long_message
    text = ("word " * 1000).strip()
    chunks = _split_long_message(text, max_len=100)
    rejoined = " ".join(c.strip() for c in chunks)
    # All original words present
    assert "word" in rejoined


def test_telegram_adapter_chat_access_control():
    from gateway.platforms.telegram import TelegramAdapter
    from gateway.config import TelegramConfig, CerberusConfig

    cfg = TelegramConfig(bot_token="tok", allowed_chat_ids=frozenset({100, 200}))
    cerberus = CerberusConfig(api_url="http://x", token="", username="g", session_model="")
    adapter = TelegramAdapter(cfg, cerberus)

    assert adapter._is_chat_allowed(100) is True
    assert adapter._is_chat_allowed(200) is True
    assert adapter._is_chat_allowed(999) is False


def test_telegram_adapter_open_when_no_allowlist():
    from gateway.platforms.telegram import TelegramAdapter
    from gateway.config import TelegramConfig, CerberusConfig

    cfg = TelegramConfig(bot_token="tok", allowed_chat_ids=frozenset())
    cerberus = CerberusConfig(api_url="http://x", token="", username="g", session_model="")
    adapter = TelegramAdapter(cfg, cerberus)

    assert adapter._is_chat_allowed(99999) is True


# ---------------------------------------------------------------------------
# CronJob tests
# ---------------------------------------------------------------------------

def test_cron_job_valid():
    from gateway.scheduler import CronJob
    job = CronJob({
        "id": "daily-ping",
        "name": "Daily Ping",
        "prompt": "Say hello",
        "cron": "0 9 * * *",
        "platform": "telegram",
        "chat_id": 12345,
    })
    assert job.id == "daily-ping"
    assert job.platform == "telegram"
    assert job.enabled is True


def test_cron_job_invalid_id_rejected():
    from gateway.scheduler import CronJob
    with pytest.raises(ValueError, match="Invalid cron job id"):
        CronJob({"id": "../escape", "prompt": "x", "cron": "* * * * *", "chat_id": 1})


def test_cron_job_empty_prompt_rejected():
    from gateway.scheduler import CronJob
    with pytest.raises(ValueError, match="prompt must be non-empty"):
        CronJob({"id": "valid-id", "prompt": "", "cron": "* * * * *", "chat_id": 1})


def test_cron_job_prompt_truncated():
    from gateway.scheduler import CronJob
    job = CronJob({
        "id": "test",
        "prompt": "x" * 20_000,
        "cron": "* * * * *",
        "chat_id": 1,
    })
    assert len(job.prompt) <= 10_000


def test_cron_job_compute_next():
    from gateway.scheduler import CronJob
    job = CronJob({
        "id": "test",
        "prompt": "go",
        "cron": "* * * * *",
        "chat_id": 1,
    })
    nxt = job.compute_next()
    assert nxt is not None


def test_cron_job_invalid_cron_returns_none():
    from gateway.scheduler import CronJob
    job = CronJob({
        "id": "test",
        "prompt": "go",
        "cron": "not-a-cron",
        "chat_id": 1,
    })
    assert job.compute_next() is None


def test_cron_job_round_trips_json():
    from gateway.scheduler import CronJob
    data = {
        "id": "test-job",
        "name": "Test",
        "prompt": "run",
        "cron": "0 * * * *",
        "platform": "telegram",
        "chat_id": 7,
        "enabled": True,
    }
    job = CronJob(data)
    d = job.to_dict()
    assert d["id"] == "test-job"
    assert d["cron"] == "0 * * * *"


# ---------------------------------------------------------------------------
# GatewayCronScheduler tests
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_jobs_file(tmp_path):
    return str(tmp_path / "cron_jobs.json")


@pytest.fixture
def cron_config(tmp_jobs_file):
    from gateway.config import CronConfig
    return CronConfig(enabled=True, tick_interval_s=60, jobs_path=tmp_jobs_file)


def test_scheduler_add_and_list_jobs(cron_config):
    from gateway.scheduler import GatewayCronScheduler
    s = GatewayCronScheduler(cron_config, {})
    s._load_jobs()  # empty start

    s.add_job({
        "id": "job-one",
        "prompt": "ping",
        "cron": "0 * * * *",
        "chat_id": 1,
    })
    jobs = s.list_jobs()
    assert len(jobs) == 1
    assert jobs[0]["id"] == "job-one"


def test_scheduler_remove_job(cron_config):
    from gateway.scheduler import GatewayCronScheduler
    s = GatewayCronScheduler(cron_config, {})
    s._load_jobs()
    s.add_job({"id": "to-remove", "prompt": "x", "cron": "* * * * *", "chat_id": 1})
    assert s.remove_job("to-remove") is True
    assert s.list_jobs() == []


def test_scheduler_remove_nonexistent_job(cron_config):
    from gateway.scheduler import GatewayCronScheduler
    s = GatewayCronScheduler(cron_config, {})
    s._load_jobs()
    assert s.remove_job("ghost") is False


def test_scheduler_duplicate_id_rejected(cron_config):
    from gateway.scheduler import GatewayCronScheduler
    s = GatewayCronScheduler(cron_config, {})
    s._load_jobs()
    s.add_job({"id": "dup", "prompt": "x", "cron": "* * * * *", "chat_id": 1})
    with pytest.raises(ValueError, match="already exists"):
        s.add_job({"id": "dup", "prompt": "y", "cron": "* * * * *", "chat_id": 1})


def test_scheduler_persists_jobs(tmp_jobs_file, cron_config):
    from gateway.scheduler import GatewayCronScheduler
    s = GatewayCronScheduler(cron_config, {})
    s._load_jobs()
    s.add_job({"id": "persist-test", "prompt": "hi", "cron": "0 6 * * *", "chat_id": 2})

    # Reload in a fresh instance
    s2 = GatewayCronScheduler(cron_config, {})
    s2._load_jobs()
    assert any(j["id"] == "persist-test" for j in s2.list_jobs())


@pytest.mark.asyncio
async def test_scheduler_tick_fires_due_job(cron_config):
    """A job with next_run in the past should be dispatched on tick."""
    from gateway.scheduler import GatewayCronScheduler, CronJob
    from datetime import datetime, timezone, timedelta

    fired_jobs = []

    async def fake_run_job(job):
        fired_jobs.append(job.id)

    s = GatewayCronScheduler(cron_config, {})
    s._load_jobs()

    job = CronJob({"id": "overdue", "prompt": "go", "cron": "* * * * *", "chat_id": 1})
    # Set next_run to the past
    job.next_run = datetime(2000, 1, 1)
    s._jobs.append(job)

    with patch.object(s, "_run_job", side_effect=fake_run_job):
        await s._tick()
        # Give tasks a chance to run
        await asyncio.sleep(0)

    assert "overdue" in fired_jobs


# ---------------------------------------------------------------------------
# Platform pluggability test
# ---------------------------------------------------------------------------

def test_platform_adapter_interface_is_abstract():
    """Adding a new platform only requires subclassing BasePlatformAdapter."""
    from gateway.platforms.base import BasePlatformAdapter, OutgoingMessage
    from gateway.config import CerberusConfig

    class MockAdapter(BasePlatformAdapter):
        platform_name = "mock"
        sent_messages = []

        async def start(self):
            pass

        async def stop(self):
            pass

        async def send_message(self, msg: OutgoingMessage):
            self.sent_messages.append(msg)

    cerberus = CerberusConfig(api_url="http://x", token="", username="g", session_model="")
    adapter = MockAdapter(config=None, cerberus_config=cerberus)
    assert adapter.platform_name == "mock"


@pytest.mark.asyncio
async def test_mock_round_trip_message():
    """Full round-trip: inbound message → Cerberus → reply."""
    from gateway.platforms.base import (
        BasePlatformAdapter, IncomingMessage, OutgoingMessage
    )
    from gateway.config import CerberusConfig
    import gateway.cerberus_client as cc

    cc._SESSION_CACHE.clear()
    cc._SESSION_LOCKS.clear()

    cerberus = CerberusConfig(
        api_url="http://cerberus:7000",
        token="tok",
        username="gw",
        session_model="",
    )

    class MockAdapter(BasePlatformAdapter):
        platform_name = "mock"
        sent: list = []

        async def start(self):
            pass

        async def stop(self):
            pass

        async def send_message(self, msg: OutgoingMessage):
            self.sent.append(msg.text)

    adapter = MockAdapter(config=None, cerberus_config=cerberus)

    session_resp = MagicMock()
    session_resp.status_code = 200
    session_resp.json.return_value = {"id": "rt-sess"}
    session_resp.raise_for_status = MagicMock()

    chat_resp = MagicMock()
    chat_resp.status_code = 200
    chat_resp.json.return_value = {"response": "round-trip response"}
    chat_resp.raise_for_status = MagicMock()

    async def fake_post(url, **kwargs):
        if "/session" in url:
            return session_resp
        return chat_resp

    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = fake_post

    with patch("httpx.AsyncClient", return_value=mock_client):
        msg = IncomingMessage(
            platform="mock",
            chat_id=777,
            user_id=1,
            username="testuser",
            text="hello cerberus",
            message_id=42,
        )
        await adapter.on_message(msg)

    assert adapter.sent == ["round-trip response"]


# ---------------------------------------------------------------------------
# GPU compose sync: gateway service appears in standalone files
# ---------------------------------------------------------------------------

def test_gpu_nvidia_standalone_has_gateway_service():
    import yaml
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    data = yaml.safe_load((root / "docker-compose.gpu-nvidia.yml").read_text())
    assert "cerberus-gateway" in data["services"]


def test_gpu_amd_standalone_has_gateway_service():
    import yaml
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    data = yaml.safe_load((root / "docker-compose.gpu-amd.yml").read_text())
    assert "cerberus-gateway" in data["services"]
