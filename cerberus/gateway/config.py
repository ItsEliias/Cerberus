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

    @classmethod
    def from_env(cls) -> "CerberusConfig":
        return cls(
            api_url=os.environ.get("CERBERUS_API_URL", "http://cerberus:7000").rstrip("/"),
            token=os.environ.get("CERBERUS_GATEWAY_TOKEN", ""),
            username=os.environ.get("CERBERUS_GATEWAY_USER", "gateway"),
            session_model=os.environ.get("CERBERUS_SESSION_MODEL", ""),
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
    cron: CronConfig

    @classmethod
    def from_env(cls) -> "GatewayConfig":
        return cls(
            cerberus=CerberusConfig.from_env(),
            telegram=TelegramConfig.from_env(),
            cron=CronConfig.from_env(),
        )

    def enabled_platforms(self) -> Dict[str, bool]:
        return {
            "telegram": self.telegram.enabled,
        }
