#!/usr/bin/env python3
"""
Manual test script to verify Slack notifications with GitHub issue links.
"""

import asyncio
import json
import sys
from pathlib import Path

# Add lib to path
sys.path.insert(0, str(Path(__file__).parent))

from lib.slack_notifier import SlackNotifier


async def test_slack_links():
    """Test Slack notifications with GitHub issue links"""
    
    # Load config
    config_path = Path("config.json")
    if not config_path.exists():
        print("config.json not found - using example values")
        bot_token = "xoxb-your-bot-token"
        channel_id = "C0123456789"
        repo_name = "owner/repo"
    else:
        with open(config_path) as f:
            config = json.load(f)
            bot_token = config.get("slack", {}).get("bot_token", "")
            channel_id = config.get("slack", {}).get("channel_id", "")
            # Get first configured repo
            repos = config.get("github", {}).get("repos", [])
            repo_name = repos[0]["name"] if repos else "owner/repo"
    
    if not bot_token or bot_token == "xoxb-your-bot-token":
        print("No valid Slack token found. Testing with mock output:")
        print()
        
        # Create a mock notifier for testing
        class MockSlackNotifier(SlackNotifier):
            async def send_message(self, text=None, blocks=None):
                print(f"Text: {text}")
                if blocks:
                    print("Blocks:")
                    for block in blocks:
                        if block.get("type") == "section":
                            print(f"  - {block['text']['text']}")
                print()
                return {"ok": True}
        
        notifier = MockSlackNotifier("mock-token", "mock-channel")
    else:
        print(f"Using real Slack config for repo: {repo_name}")
        notifier = SlackNotifier(bot_token, channel_id)
    
    issue_number = 42
    
    # Test start notification with link
    print("1. Testing start notification:")
    await notifier.notify_start(issue_number, "Add dark mode support", repo_name)
    
    # Test completion notification with link
    print("2. Testing completion notification:")
    await notifier.notify_complete(issue_number, "0:15:30", repo_name)
    
    # Test needs input notification with link
    print("3. Testing needs input notification:")
    await notifier.notify_needs_input(issue_number, "Waiting for user confirmation...", repo_name)
    
    # Test error notification with link
    print("4. Testing error notification:")
    await notifier.notify_error(issue_number, "Connection timeout", "Last output: Failed to connect", repo_name)
    
    print("\nAll notifications sent! Check:")
    print(f"  - GitHub issue link format: https://github.com/{repo_name}/issues/{issue_number}")
    print(f"  - Slack link format: <https://github.com/{repo_name}/issues/{issue_number}|#{issue_number}>")


if __name__ == "__main__":
    asyncio.run(test_slack_links())