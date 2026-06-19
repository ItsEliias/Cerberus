"""
gateway/config.py — Configuration for the Cerberus gateway service.

All secrets are supplied via environment variables; nothing is hardcoded.
The human enters bot tokens themselves after the sandbox boundary is proven
(mission constraint).

Environment variables:

  CERBERUS_API_URL        — Base URL of the Cerberus app
                            Default: http://cerberus:7000 (compose network)
  CERBERUS_GATEWAY_TOKEN  — API token for the gateway's Cerberus service account
                            Required in production; optional for mock/dry-run.
  CERBERUS_GATEWAY_USER   — Username the gateway authenticates as
                            Default: gateway
  CERBERUS_SESSION_MODEL  — Model to use for gateway-created sessions
                            Default: (empty — Cerberus picks the default)

  TELEGRAM_BOT_TOKEN      — Telegram Bot API token (from @BotFather)
                            Leave empty to disable Telegram.

  DISCORD_BOT_TOKEN       — Discord bot token (from Discord Developer Portal)
                            Leave empty to disable Discord.
  DISCORD_ALLOWED_GUILD_IDS   — Comma-separated guild (server) IDs to respond in.
                                 Empty = all guilds the bot is in.
  DISCORD_ALLOWED_CHANNEL_IDS — Comma-separated channel IDs to respond in.
                                 Empty = all channels in allowed guilds.

  SLACK_BOT_TOKEN         — Slack bot OAuth token (xoxb-...) from api.slack.com
                            Leave empty to disable Slack.
  SLACK_APP_TOKEN         — Slack app-level token (xapp-...) for Socket Mode
                            Required when Slack is enabled.
  SLACK_ALLOWED_TEAM_IDS     — Comma-separated workspace IDs (T...).
                               Empty = all workspaces.
  SLACK_ALLOWED_CHANNEL_IDS  — Comma-separated channel/DM IDs (C..., D...).
                               Empty = all channels.

  GATEWAY_CRON_ENABLED    — Enable the cron scheduler (true/false)
                            Default: true
  GATEWAY_CRON_INTERVAL   — Seconds between scheduler ticks
                            Default: 60

Platform adapter registry: each platform is enabled when its required token
env var is non-empty. To add a new platform, add a config entry here and a
class in platforms/.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Dict, Optional


@dataclass(frozen=True)
class CerberusConfig:
    """Connection config for talking to the Cerberus REST API."""

    api_url: str
    token: str
    username: str
    session_model: str
    endpoint_id: str

    @classmethod
    def from_env(cls) -> "CerberusConfig":
        return cls(
            api_url=os.environ.get("CERBERUS_API_URL", "http://cerberus:7000").rstrip("/"),
            token=os.environ.get("CERBERUS_GATEWAY_TOKEN", ""),
            username=os.environ.get("CERBERUS_GATEWAY_USER", "gateway"),
            session_model=os.environ.get("CERBERUS_SESSION_MODEL", ""),
            endpoint_id=os.environ.get("CERBERUS_GATEWAY_ENDPOINT_ID", ""),
        )


@dataclass(frozen=True)
class TelegramConfig:
    """Telegram platform configuration."""

    bot_token: str
    # Chat IDs the bot will respond to (comma-separated env var).
    # Empty = respond to all chats (open to any user who can find the bot).
    allowed_chat_ids: frozenset

    @property
    def enabled(self) -> bool:
        return bool(self.bot_token.strip())

    @classmethod
    def from_env(cls) -> "TelegramConfig":
        raw_ids = os.environ.get("TELEGRAM_ALLOWED_CHAT_IDS", "").strip()
        allowed: frozenset = frozenset()
        if raw_ids:
            parts = [p.strip() for p in raw_ids.split(",") if p.strip()]
            try:
                allowed = frozenset(int(p) for p in parts)
            except ValueError:
                pass  # malformed — default to open
        return cls(
            bot_token=os.environ.get("TELEGRAM_BOT_TOKEN", "").strip(),
            allowed_chat_ids=allowed,
        )


def _parse_id_frozenset(env_var: str) -> frozenset:
    """Parse a comma-separated list of integer IDs from an env var."""
    raw = os.environ.get(env_var, "").strip()
    if not raw:
        return frozenset()
    try:
        return frozenset(int(p.strip()) for p in raw.split(",") if p.strip())
    except ValueError:
        return frozenset()


def _parse_str_frozenset(env_var: str) -> frozenset:
    """Parse a comma-separated list of string IDs from an env var."""
    raw = os.environ.get(env_var, "").strip()
    if not raw:
        return frozenset()
    return frozenset(p.strip() for p in raw.split(",") if p.strip())


@dataclass(frozen=True)
class DiscordConfig:
    """Discord platform configuration."""

    bot_token: str
    allowed_guild_ids: frozenset
    allowed_channel_ids: frozenset

    @property
    def enabled(self) -> bool:
        return bool(self.bot_token.strip())

    @classmethod
    def from_env(cls) -> "DiscordConfig":
        return cls(
            bot_token=os.environ.get("DISCORD_BOT_TOKEN", "").strip(),
            allowed_guild_ids=_parse_id_frozenset("DISCORD_ALLOWED_GUILD_IDS"),
            allowed_channel_ids=_parse_id_frozenset("DISCORD_ALLOWED_CHANNEL_IDS"),
        )


@dataclass(frozen=True)
class SlackConfig:
    """Slack platform configuration (Socket Mode)."""

    bot_token: str            # xoxb-...
    app_token: str            # xapp-... (Socket Mode)
    allowed_team_ids: frozenset    # workspace IDs; empty = all
    allowed_channel_ids: frozenset  # channel/DM IDs; empty = all

    @property
    def enabled(self) -> bool:
        return bool(self.bot_token.strip() and self.app_token.strip())

    @classmethod
    def from_env(cls) -> "SlackConfig":
        return cls(
            bot_token=os.environ.get("SLACK_BOT_TOKEN", "").strip(),
            app_token=os.environ.get("SLACK_APP_TOKEN", "").strip(),
            allowed_team_ids=_parse_str_frozenset("SLACK_ALLOWED_TEAM_IDS"),
            allowed_channel_ids=_parse_str_frozenset("SLACK_ALLOWED_CHANNEL_IDS"),
        )


@dataclass(frozen=True)
class CronConfig:
    """Cron scheduler configuration."""

    enabled: bool
    tick_interval_s: int
    # Path to the cron jobs JSON file (persisted between restarts).
    jobs_path: str

    @classmethod
    def from_env(cls) -> "CronConfig":
        enabled_raw = os.environ.get("GATEWAY_CRON_ENABLED", "true").strip().lower()
        enabled = enabled_raw not in {"false", "0", "no", "off"}
        return cls(
            enabled=enabled,
            tick_interval_s=int(os.environ.get("GATEWAY_CRON_INTERVAL", "60")),
            jobs_path=os.environ.get(
                "GATEWAY_CRON_JOBS_PATH",
                "/app/data/gateway/cron_jobs.json",
            ),
        )


@dataclass
class GatewayConfig:
    """Top-level gateway configuration."""

    cerberus: CerberusConfig
    telegram: TelegramConfig
    discord: DiscordConfig
    slack: SlackConfig
    cron: CronConfig

    @classmethod
    def from_env(cls) -> "GatewayConfig":
        return cls(
            cerberus=CerberusConfig.from_env(),
            telegram=TelegramConfig.from_env(),
            discord=DiscordConfig.from_env(),
            slack=SlackConfig.from_env(),
            cron=CronConfig.from_env(),
        )

    def enabled_platforms(self) -> Dict[str, bool]:
        return {
            "telegram": self.telegram.enabled,
            "discord": self.discord.enabled,
            "slack": self.slack.enabled,
        }
