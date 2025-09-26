#!/usr/bin/env python3
"""
Telegram notification manager for the Issue Orchestrator.

This module handles sending notifications to Telegram about issue processing
status, errors, and completion.
"""

import logging
from telegram import Bot
from telegram.error import TelegramError


class TelegramNotifier:
    """Telegram notification manager"""
    
    def __init__(self, bot_token: str, chat_id: str):
        self.bot = Bot(token=bot_token)
        self.chat_id = chat_id
    
    async def send_message(self, message: str, parse_mode: str = "Markdown"):
        """Send a message to Telegram"""
        try:
            # Truncate message if too long
            max_length = 4000
            if len(message) > max_length:
                message = message[:max_length] + "\n... (truncated)"
            
            await self.bot.send_message(
                chat_id=self.chat_id,
                text=message,
                parse_mode=parse_mode
            )
        except TelegramError as e:
            logging.error(f"Failed to send Telegram message: {e}")
    
    async def notify_start(self, issue_number: int, title: str):
        """Notify that processing has started"""
        message = f"🚀 *Started issue #{issue_number}*: {title}"
        await self.send_message(message)
    
    async def notify_complete(self, issue_number: int, duration: str):
        """Notify that processing is complete"""
        message = f"✅ *Completed issue #{issue_number}* [{duration}]"
        await self.send_message(message)
    
    async def notify_needs_input(self, issue_number: int, output: str):
        """Notify that Claude needs input"""
        message = f"⏳ *Issue #{issue_number} needs input*:\n```\n{output[-1000:]}\n```"
        await self.send_message(message)
    
    async def notify_error(self, issue_number: int, error: str, output: str = None):
        """Notify about an error"""
        message = f"❌ *Error on issue #{issue_number}*:\n{error}"
        if output:
            message += f"\n\nLast output:\n```\n{output[-500:]}\n```"
        await self.send_message(message)

