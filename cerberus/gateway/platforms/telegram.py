"""
gateway/platforms/telegram.py — Telegram Bot API adapter.

Adapted from hermes-agent/gateway/platforms/telegram.py (MIT).
The hermes agent-loop calls are replaced with Cerberus REST calls
via gateway.cerberus_client.send_message().

Dependencies:
  python-telegram-bot >= 20.0   (async, application-builder API)

If TELEGRAM_BOT_TOKEN is empty the adapter is disabled at startup —
no import errors are raised so the service boots cleanly without a token.

Supported commands:
  /start  — greeting + Cerberus intro
  /reset  — clear the session cache for this chat (start fresh)
  /help   — usage instructions

Chat access control:
  If TELEGRAM_ALLOWED_CHAT_IDS is non-empty, messages from unlisted chats
  are silently dropped (no error, to avoid leaking that the bot exists).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

try:
    from telegram import Update
    from telegram.ext import (
        Application,
        CommandHandler,
        MessageHandler,
        ContextTypes,
        filters,
    )
    from telegram.constants import ParseMode
    TELEGRAM_AVAILABLE = True
except ImportError:
    TELEGRAM_AVAILABLE = False
    Update = object
    Application = object
    ContextTypes = object

from gateway.platforms.base import BasePlatformAdapter, IncomingMessage, OutgoingMessage
from gateway.config import TelegramConfig, CerberusConfig

# Telegram hard cap on text message length
_TELEGRAM_MAX_CHARS = 4096


def _split_long_message(text: str, max_len: int = _TELEGRAM_MAX_CHARS) -> list[str]:
    """Split a long response into Telegram-safe chunks at paragraph boundaries."""
    if len(text) <= max_len:
        return [text]
    chunks = []
    while text:
        if len(text) <= max_len:
            chunks.append(text)
            break
        # Try to split at a newline within the limit
        split_at = text.rfind("\n", 0, max_len)
        if split_at < max_len // 2:
            split_at = max_len
        chunks.append(text[:split_at].rstrip())
        text = text[split_at:].lstrip()
    return [c for c in chunks if c]


class TelegramAdapter(BasePlatformAdapter):
    """Telegram platform adapter using python-telegram-bot."""

    platform_name = "telegram"

    def __init__(self, config: TelegramConfig, cerberus_config: CerberusConfig):
        super().__init__(config, cerberus_config)
        self._app: Optional[Application] = None

    def _is_chat_allowed(self, chat_id: int) -> bool:
        allowed = self._config.allowed_chat_ids
        return (not allowed) or (chat_id in allowed)

    async def start(self) -> None:
        if not TELEGRAM_AVAILABLE:
            raise RuntimeError(
                "python-telegram-bot is not installed. "
                "Add 'python-telegram-bot>=20.0' to requirements.txt."
            )
        if not self._config.bot_token:
            raise RuntimeError("TELEGRAM_BOT_TOKEN is not set.")

        logger.info("telegram: starting adapter")
        self._app = (
            Application.builder()
            .token(self._config.bot_token)
            .build()
        )

        self._app.add_handler(CommandHandler("start", self._cmd_start))
        self._app.add_handler(CommandHandler("reset", self._cmd_reset))
        self._app.add_handler(CommandHandler("help", self._cmd_help))
        self._app.add_handler(
            MessageHandler(filters.TEXT & ~filters.COMMAND, self._on_text)
        )

        self._running = True
        logger.info("telegram: polling started")
        await self._app.initialize()
        await self._app.start()
        await self._app.updater.start_polling(drop_pending_updates=True)

    async def stop(self) -> None:
        if self._app and self._running:
            logger.info("telegram: stopping adapter")
            self._running = False
            try:
                await self._app.updater.stop()
                await self._app.stop()
                await self._app.shutdown()
            except Exception as exc:
                logger.warning("telegram: error during stop: %s", exc)

    # ------------------------------------------------------------------ #
    # Message handlers
    # ------------------------------------------------------------------ #

    async def _on_text(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not update.message or not update.message.text:
            return
        chat_id = update.effective_chat.id
        if not self._is_chat_allowed(chat_id):
            return

        user = update.effective_user
        msg = IncomingMessage(
            platform=self.platform_name,
            chat_id=chat_id,
            user_id=user.id if user else 0,
            username=user.username or str(user.id) if user else "unknown",
            text=update.message.text,
            message_id=update.message.message_id,
        )
        await self.on_message(msg)

    async def _cmd_start(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        chat_id = update.effective_chat.id
        if not self._is_chat_allowed(chat_id):
            return
        await update.message.reply_text(
            "Cerberus is online.\n\n"
            "Send me any message and I'll route it to your Cerberus AI workspace.\n\n"
            "Commands:\n"
            "  /reset — start a fresh conversation\n"
            "  /help  — show this message"
        )

    async def _cmd_reset(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        chat_id = update.effective_chat.id
        if not self._is_chat_allowed(chat_id):
            return
        from gateway.cerberus_client import invalidate_session
        invalidate_session(self.platform_name, chat_id)
        await update.message.reply_text(
            "Session cleared. Your next message starts a fresh conversation."
        )

    async def _cmd_help(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        chat_id = update.effective_chat.id
        if not self._is_chat_allowed(chat_id):
            return
        await update.message.reply_text(
            "Cerberus Gateway — Telegram\n\n"
            "Send any text to chat with your Cerberus AI workspace.\n\n"
            "/start  — introduction\n"
            "/reset  — clear conversation history\n"
            "/help   — this message\n\n"
            "Powered by Cerberus (github.com/ItsEliias/Cerberus)"
        )

    # ------------------------------------------------------------------ #
    # Outgoing message
    # ------------------------------------------------------------------ #

    async def send_message(self, msg: OutgoingMessage) -> None:
        if not self._app:
            logger.warning("telegram: send_message called but app is not started")
            return

        text = msg.text or "(no response)"
        chunks = _split_long_message(text)

        for i, chunk in enumerate(chunks):
            try:
                reply_id = msg.reply_to_message_id if i == 0 else None
                await self._app.bot.send_message(
                    chat_id=msg.chat_id,
                    text=chunk,
                    reply_to_message_id=reply_id,
                    parse_mode=ParseMode.MARKDOWN if TELEGRAM_AVAILABLE else None,
                )
            except Exception as exc:
                # Retry without Markdown if parsing failed
                try:
                    await self._app.bot.send_message(
                        chat_id=msg.chat_id,
                        text=chunk,
                        reply_to_message_id=msg.reply_to_message_id if i == 0 else None,
                    )
                except Exception as exc2:
                    logger.error(
                        "telegram: failed to send message to %s: %s / %s",
                        msg.chat_id, exc, exc2,
                    )

    async def send_text_to_chat(self, chat_id: int | str, text: str) -> None:
        """Convenience method for scheduler-initiated messages."""
        await self.send_message(OutgoingMessage(
            platform=self.platform_name,
            chat_id=chat_id,
            text=text,
        ))
