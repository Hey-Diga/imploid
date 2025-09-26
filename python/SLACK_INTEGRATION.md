# Slack Integration for Issue Orchestrator

## Overview
The Issue Orchestrator now supports Slack notifications in addition to Telegram. You can configure one, both, or neither notification system.

## Configuration

Add the following to your `config.json`:

```json
{
  "slack": {
    "bot_token": "xoxb-YOUR-SLACK-BOT-TOKEN",
    "channel_id": "YOUR-CHANNEL-ID"
  }
}
```

### Getting Slack Credentials

1. **Create a Slack App**:
   - Go to https://api.slack.com/apps
   - Click "Create New App" > "From scratch"
   - Name your app (e.g., "Issue Orchestrator")
   - Select your workspace

2. **Configure OAuth & Permissions**:
   - Go to "OAuth & Permissions" in the sidebar
   - Add the following Bot Token Scopes:
     - `chat:write`
     - `chat:write.public` (if posting to public channels)
   
3. **Install to Workspace**:
   - Click "Install to Workspace"
   - Authorize the app
   - Copy the "Bot User OAuth Token" (starts with `xoxb-`)

4. **Get Channel ID**:
   - Right-click on the channel in Slack
   - Select "View channel details"
   - Find the Channel ID at the bottom (starts with `C`)

## Features

The Slack integration provides rich formatted messages for:

- **Issue Start**: Shows issue number, title, and repository
- **Issue Completion**: Shows duration and completion status
- **Needs Input**: Shows when Claude needs user interaction
- **Errors**: Shows error details and last output

## Testing

### Unit Tests
Run the Slack notifier tests:
```bash
venv/bin/pytest tests/test_slack_notifier.py -v
```

### Manual Test
1. Edit `test_slack_manual.py` with your credentials
2. Run: `venv/bin/python test_slack_manual.py`

## Implementation Details

- **Module**: `lib/slack_notifier.py`
- **Dependencies**: `slack-sdk>=3.23.0`
- **Async Support**: Fully async using `AsyncWebClient`
- **Error Handling**: Graceful error handling with logging
- **Message Formatting**: Rich block-based formatting for better readability

## Multiple Notifications

The orchestrator supports running both Telegram and Slack notifications simultaneously. Simply configure both in your `config.json` and both will receive notifications.

## Backward Compatibility

The integration is fully backward compatible:
- Existing Telegram-only configurations continue to work
- Both notification systems are optional
- Empty or missing Slack configuration is handled gracefully