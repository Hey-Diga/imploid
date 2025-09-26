#!/usr/bin/env python3
"""
Slack notification manager for the Issue Orchestrator.

This module handles sending notifications to Slack about issue processing
status, errors, and completion.
"""

import logging
from slack_sdk.web.async_client import AsyncWebClient
from slack_sdk.errors import SlackApiError


class SlackNotifier:
    """Slack notification manager"""
    
    def __init__(self, bot_token: str, channel_id: str):
        self.client = AsyncWebClient(token=bot_token)
        self.channel_id = channel_id
    
    async def send_message(self, text: str = None, blocks: list = None):
        """Send a message to Slack"""
        try:
            # Send message with text or blocks
            response = await self.client.chat_postMessage(
                channel=self.channel_id,
                text=text,
                blocks=blocks
            )
            return response
        except SlackApiError as e:
            logging.error(f"Failed to send Slack message: {e.response['error']}")
    
    async def notify_start(self, issue_number: int, title: str, repo_name: str = None):
        """Notify that processing has started"""
        repo_text = f" in {repo_name}" if repo_name else ""
        issue_url = f"https://github.com/{repo_name}/issues/{issue_number}" if repo_name else f"#{issue_number}"
        issue_link = f"<{issue_url}|#{issue_number}>" if repo_name else f"#{issue_number}"
        
        blocks = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f":rocket: *Started processing issue {issue_link}{repo_text}*\n{title}"
                }
            }
        ]
        await self.send_message(
            text=f"Started issue #{issue_number}: {title}",
            blocks=blocks
        )
    
    async def notify_complete(self, issue_number: int, duration: str, repo_name: str = None):
        """Notify that processing is complete"""
        repo_text = f" in {repo_name}" if repo_name else ""
        issue_url = f"https://github.com/{repo_name}/issues/{issue_number}" if repo_name else f"#{issue_number}"
        issue_link = f"<{issue_url}|#{issue_number}>" if repo_name else f"#{issue_number}"
        
        blocks = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f":white_check_mark: *Completed issue {issue_link}{repo_text}*\nDuration: `{duration}`"
                }
            }
        ]
        await self.send_message(
            text=f"Completed issue #{issue_number} [{duration}]",
            blocks=blocks
        )
    
    async def notify_needs_input(self, issue_number: int, output: str, repo_name: str = None):
        """Notify that Claude needs input"""
        repo_text = f" in {repo_name}" if repo_name else ""
        issue_url = f"https://github.com/{repo_name}/issues/{issue_number}" if repo_name else f"#{issue_number}"
        issue_link = f"<{issue_url}|#{issue_number}>" if repo_name else f"#{issue_number}"
        
        # Truncate output for Slack
        truncated_output = output[-500:] if len(output) > 500 else output
        
        blocks = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f":hourglass: *Issue {issue_link}{repo_text} needs input*"
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"```{truncated_output}```"
                }
            }
        ]
        await self.send_message(
            text=f"Issue #{issue_number} needs input",
            blocks=blocks
        )
    
    async def notify_error(self, issue_number: int, error: str, output: str = None, repo_name: str = None):
        """Notify about an error"""
        repo_text = f" in {repo_name}" if repo_name else ""
        issue_url = f"https://github.com/{repo_name}/issues/{issue_number}" if repo_name else f"#{issue_number}"
        issue_link = f"<{issue_url}|#{issue_number}>" if repo_name else f"#{issue_number}"
        
        blocks = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f":x: *Error on issue {issue_link}{repo_text}*\n{error}"
                }
            }
        ]
        
        if output:
            # Truncate output for Slack
            truncated_output = output[-300:] if len(output) > 300 else output
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Last output:*\n```{truncated_output}```"
                }
            })
        
        await self.send_message(
            text=f"Error on issue #{issue_number}: {error}",
            blocks=blocks
        )