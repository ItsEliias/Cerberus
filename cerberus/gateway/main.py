"""
gateway/main.py — Cerberus Gateway entry point.

Starts all configured platform adapters and the cron scheduler.
Run via: python -m gateway.main

Platform adapters are enabled when their required token env var is set.
The gateway exits cleanly on SIGTERM / SIGINT.

Adding a new platform:
1. Implement gateway/platforms/<name>.py (subclass BasePlatformAdapter)
2. Add a config class in gateway/config.py
3. Register it in _build_adapters() below (one line)
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
from typing import Dict

from gateway.config import GatewayConfig

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


def _build_adapters(cfg: GatewayConfig) -> Dict[str, object]:
    """Instantiate and return enabled platform adapters."""
    adapters: Dict[str, object] = {}

    if cfg.telegram.enabled:
        from gateway.platforms.telegram import TelegramAdapter
        adapters["telegram"] = TelegramAdapter(cfg.telegram, cfg.cerberus)
        logger.info("gateway: telegram adapter enabled")
    else:
        logger.info("gateway: telegram adapter disabled (TELEGRAM_BOT_TOKEN not set)")

    if cfg.discord.enabled:
        from gateway.platforms.discord import DiscordAdapter
        adapters["discord"] = DiscordAdapter(cfg.discord, cfg.cerberus)
        logger.info("gateway: discord adapter enabled")
    else:
        logger.info("gateway: discord adapter disabled (DISCORD_BOT_TOKEN not set)")

    # Add more platforms here:
    # if cfg.slack.enabled:
    #     from gateway.platforms.slack import SlackAdapter
    #     adapters["slack"] = SlackAdapter(cfg.slack, cfg.cerberus)

    return adapters


async def _run(cfg: GatewayConfig) -> None:
    adapters = _build_adapters(cfg)

    if not adapters:
        logger.warning(
            "gateway: no platforms are configured — "
            "set TELEGRAM_BOT_TOKEN or DISCORD_BOT_TOKEN to enable."
        )

    tasks = []

    # Start platform adapters
    for name, adapter in adapters.items():
        logger.info("gateway: starting %s adapter", name)
        try:
            await adapter.start()
        except Exception as exc:
            logger.error("gateway: failed to start %s: %s", name, exc)

    # Start cron scheduler
    if cfg.cron.enabled:
        from gateway.scheduler import GatewayCronScheduler
        scheduler = GatewayCronScheduler(cfg.cron, adapters)
        tasks.append(asyncio.create_task(scheduler.run(), name="cron-scheduler"))
        logger.info("gateway: cron scheduler started")
    else:
        scheduler = None
        logger.info("gateway: cron scheduler disabled (GATEWAY_CRON_ENABLED=false)")

    # Wait for shutdown signal
    stop_event = asyncio.Event()

    def _handle_signal():
        logger.info("gateway: shutdown signal received")
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _handle_signal)
        except NotImplementedError:
            # Windows doesn't support add_signal_handler for all signals
            pass

    logger.info("gateway: running — %d platform(s) active", len(adapters))
    await stop_event.wait()

    # Graceful shutdown
    logger.info("gateway: shutting down")
    if scheduler:
        await scheduler.stop()
    for task in tasks:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    for name, adapter in adapters.items():
        logger.info("gateway: stopping %s", name)
        try:
            await adapter.stop()
        except Exception as exc:
            logger.warning("gateway: error stopping %s: %s", name, exc)
    logger.info("gateway: shutdown complete")


def main() -> None:
    cfg = GatewayConfig.from_env()
    logger.info(
        "gateway: starting — api_url=%s platforms=%s cron=%s",
        cfg.cerberus.api_url,
        list(cfg.enabled_platforms().keys()),
        cfg.cron.enabled,
    )
    try:
        asyncio.run(_run(cfg))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
