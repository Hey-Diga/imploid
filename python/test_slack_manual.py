#!/usr/bin/env python3
"""
Manual test script for Slack integration
Run this to test Slack notifications are working
"""

import asyncio
from lib.slack_notifier import SlackNotifier

async def test_slack():
    # You'll need to set these with your actual Slack credentials
    BOT_TOKEN = "xoxb-YOUR-SLACK-BOT-TOKEN"
    CHANNEL_ID = "YOUR-CHANNEL-ID"
    
    if BOT_TOKEN == "xoxb-YOUR-SLACK-BOT-TOKEN":
        print("Please edit this file and add your actual Slack credentials")
        return
    
    notifier = SlackNotifier(BOT_TOKEN, CHANNEL_ID)
    
    print("Testing Slack notifications...")
    
    # Test start notification
    await notifier.notify_start(123, "Fix authentication bug", "owner/repo")
    print("✓ Start notification sent")
    
    # Test completion notification
    await notifier.notify_complete(123, "0:15:30", "owner/repo")
    print("✓ Completion notification sent")
    
    # Test needs input notification
    await notifier.notify_needs_input(123, "Claude is waiting for user input...", "owner/repo")
    print("✓ Needs input notification sent")
    
    # Test error notification
    await notifier.notify_error(123, "Connection timeout", "Last output...", "owner/repo")
    print("✓ Error notification sent")
    
    print("\nAll notifications sent successfully! Check your Slack channel.")

if __name__ == "__main__":
    asyncio.run(test_slack())