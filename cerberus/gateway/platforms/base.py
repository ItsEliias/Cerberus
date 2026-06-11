"""
gateway/platforms/base.py — Abstract platform adapter interface.

Adapted from hermes-agent/gateway/platforms/base.py (MIT).

Adding a new platform:
1. Create gateway/platforms/<name>.py
2. Subclass BasePlatformAdapter, implement start() and stop()
3. Register in gateway/main.py's _PLATFORM_ADAPTERS dict
4. Add config in gateway/config.py
"""

from __future__ import annotations

import abc
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class IncomingMessage:
    """Normalised inbound message from any platform."""

    platform: str
    chat_id: str | int
    user_id: str | int
    username: str
    text: str
    message_id: Optional[str | int] = None
    is_command: bool = False
    command: Optional[str] = None
    command_args: str = ""


@dataclass
class OutgoingMessage:
    """Response to send back to a platform chat."""

    platform: str
    chat_id: str | int
    text: str
    reply_to_message_id: Optional[str | int] = None
    parse_mode: Optional[str] = None


class BasePlatformAdapter(abc.ABC):
    """
    Abstract base for all platform adapters.

    Lifecycle:
      start() — connect to the platform, begin polling/webhooks
      stop()  — disconnect cleanly
    """

    #: Short lowercase platform name (e.g. "telegram", "slack")
    platform_name: str = ""

    def __init__(self, config, cerberus_config):
        self._config = config
        self._cerberus = cerberus_config
        self._running = False

    @abc.abstractmethod
    async def start(self) -> None:
        """Connect to the platform and begin receiving messages."""

    @abc.abstractmethod
    async def stop(self) -> None:
        """Disconnect from the platform gracefully."""

    async def on_message(self, msg: IncomingMessage) -> None:
        """
        Default message handler: forward to Cerberus, send reply back.

        Override in subclasses for platform-specific handling (e.g. /reset).
        """
        from gateway.cerberus_client import send_message, CerberusClientError
        try:
            response = await send_message(
                self._cerberus,
                platform=self.platform_name,
                chat_id=msg.chat_id,
                message=msg.text,
            )
        except CerberusClientError as exc:
            logger.error("cerberus error for %s/%s: %s", self.platform_name, msg.chat_id, exc)
            response = "Cerberus is unavailable right now. Please try again shortly."

        await self.send_message(OutgoingMessage(
            platform=self.platform_name,
            chat_id=msg.chat_id,
            text=response,
            reply_to_message_id=msg.message_id,
        ))

    @abc.abstractmethod
    async def send_message(self, msg: OutgoingMessage) -> None:
        """Send a message to the platform."""
