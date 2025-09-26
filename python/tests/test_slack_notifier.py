#!/usr/bin/env python3
"""
Unit tests for the Slack notifier module.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from slack_sdk.errors import SlackApiError

from lib.slack_notifier import SlackNotifier


@pytest.mark.asyncio
async def test_slack_notifier_init():
    """Test SlackNotifier initialization"""
    bot_token = "xoxb-test-token"
    channel_id = "C0123456789"
    
    notifier = SlackNotifier(bot_token, channel_id)
    
    assert notifier.channel_id == channel_id
    assert notifier.client is not None


@pytest.mark.asyncio
async def test_send_message_success():
    """Test successful message sending"""
    bot_token = "xoxb-test-token"
    channel_id = "C0123456789"
    
    notifier = SlackNotifier(bot_token, channel_id)
    
    with patch.object(notifier.client, 'chat_postMessage', new_callable=AsyncMock) as mock_send:
        mock_send.return_value = {"ok": True}
        
        await notifier.send_message(text="Test message")
        
        mock_send.assert_called_once_with(
            channel=channel_id,
            text="Test message",
            blocks=None
        )


@pytest.mark.asyncio
async def test_send_message_with_blocks():
    """Test sending message with blocks"""
    bot_token = "xoxb-test-token"
    channel_id = "C0123456789"
    
    notifier = SlackNotifier(bot_token, channel_id)
    
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "Test block message"
            }
        }
    ]
    
    with patch.object(notifier.client, 'chat_postMessage', new_callable=AsyncMock) as mock_send:
        mock_send.return_value = {"ok": True}
        
        await notifier.send_message(text="Fallback text", blocks=blocks)
        
        mock_send.assert_called_once_with(
            channel=channel_id,
            text="Fallback text",
            blocks=blocks
        )


@pytest.mark.asyncio
async def test_send_message_error_handling():
    """Test error handling when sending fails"""
    bot_token = "xoxb-test-token"
    channel_id = "C0123456789"
    
    notifier = SlackNotifier(bot_token, channel_id)
    
    with patch.object(notifier.client, 'chat_postMessage', new_callable=AsyncMock) as mock_send:
        mock_send.side_effect = SlackApiError(
            message="channel_not_found",
            response={"error": "channel_not_found"}
        )
        
        # Should not raise, just log the error
        await notifier.send_message(text="Test message")


@pytest.mark.asyncio
async def test_notify_start():
    """Test notify_start method"""
    bot_token = "xoxb-test-token"
    channel_id = "C0123456789"
    
    notifier = SlackNotifier(bot_token, channel_id)
    
    with patch.object(notifier, 'send_message', new_callable=AsyncMock) as mock_send:
        await notifier.notify_start(123, "Fix bug in authentication", "owner/repo")
        
        mock_send.assert_called_once()
        args = mock_send.call_args
        assert "Started issue #123" in args[1]['text']
        # Check that the message contains the link format
        assert ":rocket: *Started processing issue <https://github.com/owner/repo/issues/123|#123> in owner/repo*\nFix bug in authentication" == args[1]['blocks'][0]['text']['text']


@pytest.mark.asyncio
async def test_notify_complete():
    """Test notify_complete method"""
    bot_token = "xoxb-test-token"
    channel_id = "C0123456789"
    
    notifier = SlackNotifier(bot_token, channel_id)
    
    with patch.object(notifier, 'send_message', new_callable=AsyncMock) as mock_send:
        await notifier.notify_complete(123, "1:23:45", "owner/repo")
        
        mock_send.assert_called_once()
        args = mock_send.call_args
        assert "Completed issue #123" in args[1]['text']
        block_text = args[1]['blocks'][0]['text']['text']
        assert ":white_check_mark:" in block_text
        assert "<https://github.com/owner/repo/issues/123|#123>" in block_text
        assert "1:23:45" in block_text


@pytest.mark.asyncio
async def test_notify_needs_input():
    """Test notify_needs_input method"""
    bot_token = "xoxb-test-token"
    channel_id = "C0123456789"
    
    notifier = SlackNotifier(bot_token, channel_id)
    
    output = "Claude is waiting for user input..."
    
    with patch.object(notifier, 'send_message', new_callable=AsyncMock) as mock_send:
        await notifier.notify_needs_input(123, output, "owner/repo")
        
        mock_send.assert_called_once()
        args = mock_send.call_args
        assert "Issue #123 needs input" in args[1]['text']
        block_text = args[1]['blocks'][0]['text']['text']
        assert ":hourglass:" in block_text
        assert "<https://github.com/owner/repo/issues/123|#123>" in block_text
        assert output in args[1]['blocks'][1]['text']['text']


@pytest.mark.asyncio
async def test_notify_error():
    """Test notify_error method"""
    bot_token = "xoxb-test-token"
    channel_id = "C0123456789"
    
    notifier = SlackNotifier(bot_token, channel_id)
    
    error = "Connection timeout"
    output = "Last command output..."
    
    with patch.object(notifier, 'send_message', new_callable=AsyncMock) as mock_send:
        await notifier.notify_error(123, error, output, "owner/repo")
        
        mock_send.assert_called_once()
        args = mock_send.call_args
        assert f"Error on issue #123: {error}" in args[1]['text']
        block_text = args[1]['blocks'][0]['text']['text']
        assert ":x:" in block_text
        assert "<https://github.com/owner/repo/issues/123|#123>" in block_text
        assert error in block_text
        assert output in args[1]['blocks'][1]['text']['text']


@pytest.mark.asyncio
async def test_output_truncation():
    """Test that long output is truncated"""
    bot_token = "xoxb-test-token"
    channel_id = "C0123456789"
    
    notifier = SlackNotifier(bot_token, channel_id)
    
    # Create a very long output
    long_output = "A" * 1000
    
    with patch.object(notifier, 'send_message', new_callable=AsyncMock) as mock_send:
        await notifier.notify_needs_input(123, long_output)
        
        mock_send.assert_called_once()
        args = mock_send.call_args
        # Check that output was truncated to 500 chars
        assert len(args[1]['blocks'][1]['text']['text']) < 600  # Account for formatting