"""
gateway/platforms/discord.py — Discord adapter.

Uses discord.py (the `discord` package) for:
- Receiving messages in servers (guilds) and DMs
- Sending responses back
- /reset and /help slash-style prefix commands

Dependencies:
  discord.py >= 2.0   (async, application commands + message intents)

If DISCORD_BOT_TOKEN is empty the adapter is disabled at startup —
no import errors are raised so the service boots cleanly without a token.

Required Discord bot permissions (set in Discord Developer Portal):
  - Send Messages
  - Read Message History
  - Message Content Intent  (must be enabled under Bot → Privileged Intents)

Setup:
  1. discord.com/developers/applications → New Application
  2. Bot → Add Bot → copy token → set DISCORD_BOT_TOKEN in .env
  3. Bot → Privileged Gateway Intents → enable "Message Content Intent"
  4. OAuth2 → URL Generator → scopes: bot → permissions: Send Messages,
     Read Message History → copy URL → open in browser → add to your server

Chat access control:
  DISCORD_ALLOWED_GUILD_IDS — comma-separated guild (server) IDs.
  Empty = respond in any guild the bot is in (plus DMs).
  DISCORD_ALLOWED_CHANNEL_IDS — comma-separated channel IDs.
  Empty = respond in all channels in allowed guilds.

Commands (prefix: !):
  !reset  — clear the Cerberus session for this channel
  !help   — usage instructions

Message handling:
  - Bot ignores its own messages (no reply loops)
  - Long responses split at 2000-char Discord limit
  - Typing indicator shown while Cerberus processes
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import discord
    from discord.ext import commands as discord_commands
    DISCORD_AVAILABLE = True
except ImportError:
    DISCORD_AVAILABLE = False
    discord = None
    discord_commands = None

from gateway.platforms.base import BasePlatformAdapter, IncomingMessage, OutgoingMessage
from gateway.config import DiscordConfig, CerberusConfig

# Discord hard cap on message length
_DISCORD_MAX_CHARS = 2000


def _split_long_message(text: str, max_len: int = _DISCORD_MAX_CHARS) -> list[str]:
    """Split a long response into Discord-safe chunks at paragraph boundaries."""
    if len(text) <= max_len:
        return [text]
    chunks = []
    while text:
        if len(text) <= max_len:
            chunks.append(text)
            break
        split_at = text.rfind("\n", 0, max_len)
        if split_at < max_len // 2:
            split_at = max_len
        chunks.append(text[:split_at].rstrip())
        text = text[split_at:].lstrip()
    return [c for c in chunks if c]


class DiscordAdapter(BasePlatformAdapter):
    """Discord platform adapter using discord.py."""

    platform_name = "discord"

    def __init__(self, config: DiscordConfig, cerberus_config: CerberusConfig):
        super().__init__(config, cerberus_config)
        self._client: Optional[discord.Client] = None
        self._ready = asyncio.Event()

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #

    async def start(self) -> None:
        if not DISCORD_AVAILABLE:
            raise RuntimeError(
                "discord.py is not installed. "
                "Add 'discord.py>=2.0' to requirements.txt."
            )
        if not self._config.bot_token:
            raise RuntimeError("DISCORD_BOT_TOKEN is not set.")

        intents = discord.Intents.default()
        intents.message_content = True  # required for reading message text
        intents.dm_messages = True

        self._client = discord.Client(intents=intents)
        self._register_events()
        self._running = True

        # Run the discord client in a background task — it blocks internally
        asyncio.create_task(
            self._client.start(self._config.bot_token),
            name="discord-client",
        )
        # Wait up to 30s for the client to be ready before returning
        try:
            await asyncio.wait_for(self._ready.wait(), timeout=30.0)
            logger.info("discord: adapter ready, logged in as %s", self._client.user)
        except asyncio.TimeoutError:
            logger.warning("discord: client did not become ready within 30s — continuing anyway")

    async def stop(self) -> None:
        if self._client and self._running:
            logger.info("discord: stopping adapter")
            self._running = False
            try:
                await self._client.close()
            except Exception as exc:
                logger.warning("discord: error during stop: %s", exc)

    # ------------------------------------------------------------------ #
    # Event registration
    # ------------------------------------------------------------------ #

    def _register_events(self) -> None:
        client = self._client

        @client.event
        async def on_ready():
            logger.info("discord: on_ready fired, user=%s", client.user)
            self._ready.set()

        @client.event
        async def on_message(message: discord.Message):
            # Ignore own messages
            if message.author == client.user:
                return

            # Guild access control
            if message.guild and not self._is_guild_allowed(message.guild.id):
                return

            # Channel access control (DMs have no channel ID in the guild sense)
            if message.guild and not self._is_channel_allowed(message.channel.id):
                return

            content = message.content.strip()
            if not content:
                return

            # Prefix commands
            if content.startswith("!reset"):
                await self._cmd_reset(message)
                return
            if content.startswith("!help"):
                await self._cmd_help(message)
                return

            # Ignore messages starting with other bot prefixes / slash commands
            if content.startswith("!") or content.startswith("/"):
                return

            await self._on_text(message)

    # ------------------------------------------------------------------ #
    # Access control
    # ------------------------------------------------------------------ #

    def _is_guild_allowed(self, guild_id: int) -> bool:
        allowed = self._config.allowed_guild_ids
        return (not allowed) or (guild_id in allowed)

    def _is_channel_allowed(self, channel_id: int) -> bool:
        allowed = self._config.allowed_channel_ids
        return (not allowed) or (channel_id in allowed)

    # ------------------------------------------------------------------ #
    # Message handlers
    # ------------------------------------------------------------------ #

    async def _on_text(self, message: discord.Message) -> None:
        # Use channel ID as the chat_id for session keying
        chat_id = message.channel.id

        msg = IncomingMessage(
            platform=self.platform_name,
            chat_id=chat_id,
            user_id=message.author.id,
            username=str(message.author),
            text=message.content.strip(),
            message_id=message.id,
        )

        # Show typing indicator while Cerberus thinks
        async with message.channel.typing():
            await self.on_message(msg)

    async def _cmd_reset(self, message: discord.Message) -> None:
        from gateway.cerberus_client import invalidate_session
        invalidate_session(self.platform_name, message.channel.id)
        await message.channel.send(
            "Session cleared. Your next message starts a fresh conversation."
        )

    async def _cmd_help(self, message: discord.Message) -> None:
        await message.channel.send(
            "**Cerberus Gateway — Discord**\n\n"
            "Send any message to chat with your Cerberus AI workspace.\n\n"
            "`!reset` — clear conversation history for this channel\n"
            "`!help` — this message\n\n"
            "Powered by Cerberus"
        )

    # ------------------------------------------------------------------ #
    # Outgoing message
    # ------------------------------------------------------------------ #

    async def send_message(self, msg: OutgoingMessage) -> None:
        if not self._client:
            logger.warning("discord: send_message called but client is not started")
            return

        channel = self._client.get_channel(int(msg.chat_id))
        if channel is None:
            try:
                channel = await self._client.fetch_channel(int(msg.chat_id))
            except Exception as exc:
                logger.error("discord: cannot find channel %s: %s", msg.chat_id, exc)
                return

        text = msg.text or "(no response)"
        chunks = _split_long_message(text)

        for chunk in chunks:
            try:
                await channel.send(chunk)
            except Exception as exc:
                logger.error("discord: failed to send to channel %s: %s", msg.chat_id, exc)

    async def send_text_to_chat(self, chat_id: int | str, text: str) -> None:
        """Convenience method for scheduler-initiated delivery."""
        await self.send_message(OutgoingMessage(
            platform=self.platform_name,
            chat_id=chat_id,
            text=text,
        ))
