"""Tests for the Slack gateway adapter and config.

All tests run without a live Slack workspace or bot token.
"""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

ROOT = Path(__file__).resolve().parents[1]


# ── Config tests ─────────────────────────────────────────────────────────────

def test_slack_config_disabled_when_no_tokens(monkeypatch):
    monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
    monkeypatch.delenv("SLACK_APP_TOKEN", raising=False)
    from gateway.config import GatewayConfig
    cfg = GatewayConfig.from_env()
    assert cfg.slack.enabled is False


def test_slack_config_disabled_when_only_bot_token(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.delenv("SLACK_APP_TOKEN", raising=False)
    from gateway.config import GatewayConfig
    cfg = GatewayConfig.from_env()
    assert cfg.slack.enabled is False


def test_slack_config_disabled_when_only_app_token(monkeypatch):
    monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
    monkeypatch.setenv("SLACK_APP_TOKEN", "xapp-test")
    from gateway.config import GatewayConfig
    cfg = GatewayConfig.from_env()
    assert cfg.slack.enabled is False


def test_slack_config_enabled_when_both_tokens_set(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setenv("SLACK_APP_TOKEN", "xapp-test")
    from gateway.config import GatewayConfig
    cfg = GatewayConfig.from_env()
    assert cfg.slack.enabled is True


def test_slack_allowed_team_ids_parsed(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setenv("SLACK_APP_TOKEN", "xapp-test")
    monkeypatch.setenv("SLACK_ALLOWED_TEAM_IDS", "T111,T222,T333")
    from gateway.config import GatewayConfig
    cfg = GatewayConfig.from_env()
    assert cfg.slack.allowed_team_ids == frozenset({"T111", "T222", "T333"})


def test_slack_allowed_channel_ids_parsed(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setenv("SLACK_APP_TOKEN", "xapp-test")
    monkeypatch.setenv("SLACK_ALLOWED_CHANNEL_IDS", "C001,D002")
    from gateway.config import GatewayConfig
    cfg = GatewayConfig.from_env()
    assert cfg.slack.allowed_channel_ids == frozenset({"C001", "D002"})


def test_slack_open_access_when_no_team_filter(monkeypatch):
    monkeypatch.delenv("SLACK_ALLOWED_TEAM_IDS", raising=False)
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setenv("SLACK_APP_TOKEN", "xapp-test")
    from gateway.config import GatewayConfig
    cfg = GatewayConfig.from_env()
    assert cfg.slack.allowed_team_ids == frozenset()


def test_enabled_platforms_includes_slack(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setenv("SLACK_APP_TOKEN", "xapp-test")
    from gateway.config import GatewayConfig
    cfg = GatewayConfig.from_env()
    assert cfg.enabled_platforms().get("slack") is True


# ── Message splitting ─────────────────────────────────────────────────────────

def test_slack_message_split_short():
    from gateway.platforms.slack import _split_long_message
    assert _split_long_message("hello", max_len=3000) == ["hello"]


def test_slack_message_split_long():
    from gateway.platforms.slack import _split_long_message
    text = "a" * 4000
    chunks = _split_long_message(text, max_len=3000)
    assert len(chunks) >= 2
    for chunk in chunks:
        assert len(chunk) <= 3000


def test_slack_message_split_preserves_content():
    from gateway.platforms.slack import _split_long_message
    text = ("word " * 1000).strip()
    chunks = _split_long_message(text, max_len=100)
    rejoined = " ".join(c.strip() for c in chunks)
    assert "word" in rejoined


# ── Adapter access control ───────────────────────────────────────────────────

def test_slack_adapter_team_access_control():
    from gateway.platforms.slack import SlackAdapter
    from gateway.config import SlackConfig, CerberusConfig

    cfg = SlackConfig(
        bot_token="xoxb-test",
        app_token="xapp-test",
        allowed_team_ids=frozenset({"T100", "T200"}),
        allowed_channel_ids=frozenset(),
    )
    cerberus = CerberusConfig(api_url="http://x", token="", username="g", session_model="")
    adapter = SlackAdapter(cfg, cerberus)

    assert adapter._is_team_allowed("T100") is True
    assert adapter._is_team_allowed("T999") is False


def test_slack_adapter_open_team_when_no_filter():
    from gateway.platforms.slack import SlackAdapter
    from gateway.config import SlackConfig, CerberusConfig

    cfg = SlackConfig(
        bot_token="xoxb-test",
        app_token="xapp-test",
        allowed_team_ids=frozenset(),
        allowed_channel_ids=frozenset(),
    )
    cerberus = CerberusConfig(api_url="http://x", token="", username="g", session_model="")
    adapter = SlackAdapter(cfg, cerberus)

    assert adapter._is_team_allowed("T99999") is True


def test_slack_adapter_channel_access_control():
    from gateway.platforms.slack import SlackAdapter
    from gateway.config import SlackConfig, CerberusConfig

    cfg = SlackConfig(
        bot_token="xoxb-test",
        app_token="xapp-test",
        allowed_team_ids=frozenset(),
        allowed_channel_ids=frozenset({"C001", "D002"}),
    )
    cerberus = CerberusConfig(api_url="http://x", token="", username="g", session_model="")
    adapter = SlackAdapter(cfg, cerberus)

    assert adapter._is_channel_allowed("C001") is True
    assert adapter._is_channel_allowed("C999") is False


def test_slack_adapter_open_channel_when_no_filter():
    from gateway.platforms.slack import SlackAdapter
    from gateway.config import SlackConfig, CerberusConfig

    cfg = SlackConfig(
        bot_token="xoxb-test",
        app_token="xapp-test",
        allowed_team_ids=frozenset(),
        allowed_channel_ids=frozenset(),
    )
    cerberus = CerberusConfig(api_url="http://x", token="", username="g", session_model="")
    adapter = SlackAdapter(cfg, cerberus)

    assert adapter._is_channel_allowed("C99999") is True


# ── send_message (scheduler-initiated) ───────────────────────────────────────

@pytest.mark.asyncio
async def test_slack_send_message_posts_to_channel():
    from gateway.platforms.slack import SlackAdapter
    from gateway.config import SlackConfig, CerberusConfig
    from gateway.platforms.base import OutgoingMessage

    cfg = SlackConfig(
        bot_token="xoxb-test",
        app_token="xapp-test",
        allowed_team_ids=frozenset(),
        allowed_channel_ids=frozenset(),
    )
    cerberus = CerberusConfig(api_url="http://x", token="", username="g", session_model="")
    adapter = SlackAdapter(cfg, cerberus)

    mock_app = MagicMock()
    mock_app.client.chat_postMessage = AsyncMock()
    adapter._app = mock_app

    await adapter.send_message(OutgoingMessage(
        platform="slack", chat_id="C123", text="Hello Slack",
    ))

    mock_app.client.chat_postMessage.assert_called_once_with(
        channel="C123",
        text="Hello Slack",
    )


@pytest.mark.asyncio
async def test_slack_send_message_no_op_when_not_started():
    from gateway.platforms.slack import SlackAdapter
    from gateway.config import SlackConfig, CerberusConfig
    from gateway.platforms.base import OutgoingMessage

    cfg = SlackConfig(
        bot_token="xoxb-test",
        app_token="xapp-test",
        allowed_team_ids=frozenset(),
        allowed_channel_ids=frozenset(),
    )
    cerberus = CerberusConfig(api_url="http://x", token="", username="g", session_model="")
    adapter = SlackAdapter(cfg, cerberus)
    # _app is None — should log and return, not raise
    await adapter.send_message(OutgoingMessage(platform="slack", chat_id="C1", text="hi"))


# ── Compose env vars ─────────────────────────────────────────────────────────

import yaml


def _gateway_env_keys(compose_path: Path) -> list[str]:
    data = yaml.safe_load(compose_path.read_text())
    env = data["services"]["cerberus-gateway"].get("environment", [])
    return [e.split("=")[0] for e in env]


def test_compose_gateway_has_slack_env():
    keys = _gateway_env_keys(ROOT / "docker-compose.yml")
    assert "SLACK_BOT_TOKEN" in keys
    assert "SLACK_APP_TOKEN" in keys
    assert "SLACK_ALLOWED_TEAM_IDS" in keys
    assert "SLACK_ALLOWED_CHANNEL_IDS" in keys


def test_gpu_nvidia_gateway_has_slack_env():
    keys = _gateway_env_keys(ROOT / "docker-compose.gpu-nvidia.yml")
    assert "SLACK_BOT_TOKEN" in keys
    assert "SLACK_APP_TOKEN" in keys


def test_gpu_amd_gateway_has_slack_env():
    keys = _gateway_env_keys(ROOT / "docker-compose.gpu-amd.yml")
    assert "SLACK_BOT_TOKEN" in keys
    assert "SLACK_APP_TOKEN" in keys
