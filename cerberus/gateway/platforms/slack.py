"""
gateway/platforms/slack.py — Slack adapter using Socket Mode.

Uses slack-bolt's async Socket Mode handler so no public URL is required.
The bot receives events from Slack's WebSocket connection.

Dependencies:
  slack-bolt >= 1.18   (AsyncApp + AsyncSocketModeHandler)

If SLACK_BOT_TOKEN or SLACK_APP_TOKEN are empty the adapter is disabled at
startup — no import errors are raised so the service boots cleanly.

Required Slack OAuth scopes (api.slack.com/apps → OAuth & Permissions):
  Bot Token Scopes:
    chat:write            send messages
    im:history            read DM history
    channels:history      read public channel messages
    groups:history        read private channel messages
    app_mentions:read     receive @mentions
    im:read               list/open DMs

App-level token scopes (for Socket Mode):
    connections:write

Event subscriptions (Socket Mode → Event Subscriptions):
    message.im            DM messages
    message.channels      public channel messages
    message.groups        private channel messages
    app_mention           @mentions in channels

Setup:
  1. api.slack.com/apps → New App (from scratch)
  2. Socket Mode → Enable Socket Mode → Generate App-Level Token
     with connections:write → copy to SLACK_APP_TOKEN in .env
  3. OAuth & Permissions → Bot Token Scopes → add scopes above
     → Install to Workspace → copy Bot User OAuth Token → SLACK_BOT_TOKEN
  4. Event Subscriptions → Enable → Subscribe to bot events above

Access control:
  SLACK_ALLOWED_TEAM_IDS     — comma-separated workspace IDs (T...).
                               Empty = all workspaces the bot is in.
  SLACK_ALLOWED_CHANNEL_IDS  — comma-separated channel/DM IDs (C..., D...).
                               Empty = all channels in allowed workspaces.

Commands (prefix: !):
  !reset  — clear Cerberus session for this channel
  !help   — usage instructions

Message handling:
  - Bot ignores its own messages (no reply loops)
  - Long responses split at 3000-char Slack limit
  - Replies sent in-thread when the incoming message has a thread_ts
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

try:
    from slack_bolt.async_app import AsyncApp
    from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler
    SLACK_AVAILABLE = True
except ImportError:
    SLACK_AVAILABLE = False
    AsyncApp = None
    AsyncSocketModeHandler = None

from gateway.platforms.base import BasePlatformAdapter, IncomingMessage, OutgoingMessage
from gateway.config import SlackConfig, CerberusConfig

_SLACK_MAX_CHARS = 3000


def _split_long_message(text: str, max_len: int = _SLACK_MAX_CHARS) -> list[str]:
    """Split a long response into Slack-safe chunks at paragraph boundaries."""
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


class SlackAdapter(BasePlatformAdapter):
    """Slack platform adapter using slack-bolt Socket Mode."""

    platform_name = "slack"

    def __init__(self, config: SlackConfig, cerberus_config: CerberusConfig):
        super().__init__(config, cerberus_config)
        self._app: Optional[AsyncApp] = None
        self._handler: Optional[AsyncSocketModeHandler] = None
        self._bot_user_id: Optional[str] = None

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #

    async def start(self) -> None:
        if not SLACK_AVAILABLE:
            raise RuntimeError(
                "slack-bolt is not installed. "
                "Add 'slack-bolt>=1.18' to requirements.txt."
            )
        if not self._config.bot_token:
            raise RuntimeError("SLACK_BOT_TOKEN is not set.")
        if not self._config.app_token:
            raise RuntimeError("SLACK_APP_TOKEN is not set (required for Socket Mode).")

        self._app = AsyncApp(token=self._config.bot_token)
        self._register_events()

        self._handler = AsyncSocketModeHandler(self._app, self._config.app_token)
        self._running = True

        # Fetch bot user ID once so we can filter our own messages
        try:
            auth = await self._app.client.auth_test()
            self._bot_user_id = auth["user_id"]
            logger.info("slack: adapter ready, bot_user_id=%s", self._bot_user_id)
        except Exception as exc:
            logger.warning("slack: could not fetch bot user ID: %s", exc)

        # Start handler in background task
        asyncio.create_task(
            self._handler.start_async(),
            name="slack-socket-mode",
        )

    async def stop(self) -> None:
        if self._handler and self._running:
            logger.info("slack: stopping adapter")
            self._running = False
            try:
                await self._handler.close_async()
            except Exception as exc:
                logger.warning("slack: error during stop: %s", exc)

    # ------------------------------------------------------------------ #
    # Event registration
    # ------------------------------------------------------------------ #

    def _register_events(self) -> None:
        app = self._app

        @app.event("message")
        async def handle_message(event, say, ack):
            await ack()
            await self._on_event(event, say)

        @app.event("app_mention")
        async def handle_mention(event, say, ack):
            await ack()
            await self._on_event(event, say)

    # ------------------------------------------------------------------ #
    # Access control
    # ------------------------------------------------------------------ #

    def _is_team_allowed(self, team_id: str) -> bool:
        allowed = self._config.allowed_team_ids
        return (not allowed) or (team_id in allowed)

    def _is_channel_allowed(self, channel_id: str) -> bool:
        allowed = self._config.allowed_channel_ids
        return (not allowed) or (channel_id in allowed)

    # ------------------------------------------------------------------ #
    # Message handlers
    # ------------------------------------------------------------------ #

    async def _on_event(self, event: dict, say) -> None:
        # Ignore bot messages and our own messages
        if event.get("bot_id"):
            return
        user_id = event.get("user", "")
        if self._bot_user_id and user_id == self._bot_user_id:
            return
        # Ignore message subtypes (edits, joins, etc.)
        if event.get("subtype"):
            return

        team_id = event.get("team", "")
        channel_id = event.get("channel", "")

        if team_id and not self._is_team_allowed(team_id):
            return
        if channel_id and not self._is_channel_allowed(channel_id):
            return

        text = (event.get("text") or "").strip()
        # Strip bot mention prefix (e.g. "<@U123>") from app_mention events
        if text.startswith("<@"):
            text = text.split(">", 1)[-1].strip()

        if not text:
            return

        thread_ts = event.get("thread_ts") or event.get("ts")

        # Prefix commands
        if text.startswith("!reset"):
            await self._cmd_reset(channel_id, say, thread_ts)
            return
        if text.startswith("!help"):
            await self._cmd_help(say, thread_ts)
            return
        if text.startswith("!"):
            return

        await self._dispatch(
            channel_id=channel_id,
            user_id=user_id,
            username=user_id,
            text=text,
            message_ts=event.get("ts"),
            thread_ts=thread_ts,
            say=say,
        )

    async def _dispatch(
        self,
        channel_id: str,
        user_id: str,
        username: str,
        text: str,
        message_ts: Optional[str],
        thread_ts: Optional[str],
        say,
    ) -> None:
        msg = IncomingMessage(
            platform=self.platform_name,
            chat_id=channel_id,
            user_id=user_id,
            username=username,
            text=text,
            message_id=message_ts,
        )

        # Ack with a typing indicator while Cerberus thinks
        try:
            await say(text="…", thread_ts=thread_ts)
        except Exception:
            pass

        from gateway.cerberus_client import send_message, CerberusClientError
        try:
            response = await send_message(
                self._cerberus,
                platform=self.platform_name,
                chat_id=channel_id,
                message=text,
            )
        except CerberusClientError as exc:
            logger.error("cerberus error for slack/%s: %s", channel_id, exc)
            response = "Cerberus is unavailable right now. Please try again shortly."

        chunks = _split_long_message(response or "(no response)")
        for chunk in chunks:
            try:
                await say(text=chunk, thread_ts=thread_ts)
            except Exception as exc:
                logger.error("slack: failed to send to %s: %s", channel_id, exc)

    async def _cmd_reset(self, channel_id: str, say, thread_ts: Optional[str]) -> None:
        from gateway.cerberus_client import invalidate_session
        invalidate_session(self.platform_name, channel_id)
        try:
            await say(
                text="Session cleared. Your next message starts a fresh conversation.",
                thread_ts=thread_ts,
            )
        except Exception as exc:
            logger.error("slack: reset reply failed for %s: %s", channel_id, exc)

    async def _cmd_help(self, say, thread_ts: Optional[str]) -> None:
        try:
            await say(
                text=(
                    "*Cerberus Gateway — Slack*\n\n"
                    "Send any message to chat with your Cerberus AI workspace.\n\n"
                    "`!reset` — clear conversation history for this channel\n"
                    "`!help` — this message\n\n"
                    "Powered by Cerberus"
                ),
                thread_ts=thread_ts,
            )
        except Exception as exc:
            logger.error("slack: help reply failed: %s", exc)

    # ------------------------------------------------------------------ #
    # Outgoing message (scheduler-initiated)
    # ------------------------------------------------------------------ #

    async def send_message(self, msg: OutgoingMessage) -> None:
        if not self._app:
            logger.warning("slack: send_message called but app is not started")
            return

        text = msg.text or "(no response)"
        chunks = _split_long_message(text)

        for chunk in chunks:
            try:
                await self._app.client.chat_postMessage(
                    channel=str(msg.chat_id),
                    text=chunk,
                )
            except Exception as exc:
                logger.error("slack: failed to post to %s: %s", msg.chat_id, exc)

    async def send_text_to_chat(self, chat_id: str, text: str) -> None:
        """Convenience method for scheduler-initiated delivery."""
        await self.send_message(OutgoingMessage(
            platform=self.platform_name,
            chat_id=chat_id,
            text=text,
        ))
