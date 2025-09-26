# GitHub Issue Orchestrator for Claude Code

Automated orchestration system for processing GitHub issues with Claude Code. Monitors issues labeled `ready-for-claude`, processes them concurrently using separate repository clones, and provides real-time notifications via Telegram and/or Slack.

## Features

- 🤖 **Automated Processing**: Automatically picks up and processes issues labeled `ready-for-claude`
- 🚀 **Concurrent Execution**: Process multiple issues simultaneously with configurable concurrency limits
- 🏗️ **Separate Repo Clones**: Each concurrent agent uses its own repository clone to avoid conflicts
- 🔄 **Auto Setup**: Automatically runs `setup.sh` in each repo clone before processing
- 📱 **Real-time Notifications**: Telegram and Slack notifications for start, completion, errors, and when input is needed
- 💾 **Persistent State**: Maintains processing state across restarts
- 🔄 **Cron Integration**: Designed to run periodically via cron for hands-free operation
- 🏷️ **Label Management**: Automatically updates issue labels to reflect processing status
- 🏗️ **Modular Architecture**: Clean, maintainable code structure with separated concerns

## Quick Start

### Running the Orchestrator

```bash
# Using the simple runner
./venv/bin/python run_orchestrator.py

# Using the package directly
./venv/bin/python -m lib.orchestrator

# Using the legacy entry point
./venv/bin/python issue_orchestrator.py
```

### Using Individual Components

```python
from lib import (
    Config, GitHubClient, TelegramNotifier, SlackNotifier, RepoManager,
    StateManager, ClaudeProcessor, ClaudeMonitor, IssueOrchestrator
)

# Create configuration
config = Config("config.json")

# Initialize components
github_client = GitHubClient(config.github_token, config.github_repo)
notifier = TelegramNotifier(config.telegram_bot_token, config.telegram_chat_id)
repo_manager = RepoManager(config)
state_manager = StateManager()
processor = ClaudeProcessor(config, notifier, repo_manager)

# Use components individually
# ... your custom logic here
```

### Direct Module Imports

```python
# Import specific modules directly
from lib.models import ProcessStatus, IssueState
from lib.config import Config
from lib.github_client import GitHubClient

# Use the modules
state = IssueState(
    issue_number=123,
    status=ProcessStatus.RUNNING.value,
    session_id="test-session",
    branch="issue-123",
    start_time="2024-01-01T00:00:00"
)
```

### Automated Execution (Cron)
Add to your crontab to run every 5 minutes:
```bash
crontab -e
```

Add this line:
```cron
*/5 * * * * cd /path/to/scripts/issue-orchestrator && ./venv/bin/python issue_orchestrator.py >> orchestrator.log 2>&1
```

### Monitoring Claude Instances

The orchestrator includes a monitoring tool to track Claude Code instances:

#### Quick Status (Default - No Arguments)
```bash
./venv/bin/python claude_monitor.py
```
Shows current active work from orchestrator state, or recent history if nothing is active.

#### Check Status of All Instances
```bash
./venv/bin/python claude_monitor.py monitor
```

#### Check Specific Issue Status
```bash
./venv/bin/python claude_monitor.py status --issue 123
```

#### View Conversation History
```bash
./venv/bin/python claude_monitor.py history --issue 123
```

#### JSON Output Format
```bash
./venv/bin/python claude_monitor.py --format json
./venv/bin/python claude_monitor.py monitor --format json
```

#### Using the Monitor Programmatically
```python
from lib import ClaudeMonitor

# Create monitor
monitor = ClaudeMonitor("/path/to/repo", output_format="text")

# Get active instances
active = monitor.get_active_instances()

# Get conversation history
history = monitor.get_conversation_history(issue_number=123)

# Get comprehensive report
report = monitor.monitor_all()
print(report.to_text())
```

## Project Structure

```
scripts/issue-orchestrator/
├── lib/                          # Core library modules
│   ├── __init__.py               # Package initialization with lazy imports
│   ├── models.py                 # Data classes and enums
│   ├── config.py                 # Configuration management
│   ├── github_client.py          # GitHub API interactions
│   ├── telegram_notifier.py      # Telegram notifications
│   ├── repo_manager.py           # Repository management
│   ├── state_manager.py          # State persistence
│   ├── claude_processor.py       # Claude Code process management
│   ├── claude_monitor.py         # Monitoring capabilities
│   └── orchestrator.py           # Main orchestrator logic
├── issue_orchestrator.py         # Legacy entry point
├── run_orchestrator.py           # Simple CLI runner
├── config.json                   # Configuration (gitignored)
├── config.example.json           # Configuration template
├── requirements.txt              # Python dependencies
├── setup.sh                      # Setup script
├── venv/                         # Virtual environment (gitignored)
├── processing-state.json         # State file (gitignored)
├── orchestrator.log              # Logs (gitignored)
└── tests/                        # Test suite
    ├── test_orchestrator.py
    ├── test_github_client.py
    ├── test_state_manager.py
    ├── test_claude_monitor.py
    └── test_integration.py
```

## Module Descriptions

### Core Models (`lib/models.py`)
- **ProcessStatus**: Enum for issue processing states
- **InstanceStatus**: Enum for Claude instance states
- **IssueState**: Data class for tracking issue processing state
- **Message**: Data class for Claude conversation messages
- **ClaudeInstance**: Data class for monitoring Claude instances
- **MonitorReport**: Data class for monitoring reports

### Configuration (`lib/config.py`)
- **Config**: Manages loading and validation of configuration from JSON files
- Handles GitHub, Telegram, and Claude settings
- Provides repository path management for concurrent agents

### External Integrations

#### GitHub Client (`lib/github_client.py`)
- **GitHubClient**: Handles all GitHub API interactions
- Fetches issues with 'ready-for-claude' label
- Updates issue labels and creates comments
- Manages authentication and API requests

#### Telegram Notifier (`lib/telegram_notifier.py`)
- **TelegramNotifier**: Manages Telegram notifications
- Sends start, completion, error, and input-needed notifications
- Handles message truncation and error handling

### Repository Management (`lib/repo_manager.py`)
- **RepoManager**: Manages repository clones for concurrent agents
- Clones repositories for each agent index
- Pulls latest changes and ensures clean state
- Runs setup scripts and validates branches

### State Management (`lib/state_manager.py`)
- **StateManager**: Handles persistent state storage
- Manages issue processing states across restarts
- Tracks agent assignments and availability
- Provides JSON serialization/deserialization

### Process Management

#### Claude Processor (`lib/claude_processor.py`)
- **ClaudeProcessor**: Manages Claude Code process execution
- Launches Claude processes with proper command formatting
- Monitors process output and captures session IDs
- Handles timeouts and error conditions

#### Claude Monitor (`lib/claude_monitor.py`)
- **ClaudeMonitor**: Provides monitoring capabilities
- Tracks running Claude processes
- Reads conversation history from filesystem
- Generates status reports and conversation summaries

### Main Orchestrator (`lib/orchestrator.py`)
- **IssueOrchestrator**: Main coordination logic
- Orchestrates all components
- Manages concurrent issue processing
- Handles the main processing loop

### Package Initialization (`lib/__init__.py`)
- Package initialization with lazy imports
- Provides clean import interface
- Defines package metadata
- Avoids dependency issues through lazy loading

## Installation

### Prerequisites

- Python 3.8 or higher
- GitHub CLI (`gh`) installed and authenticated
- Claude Code CLI installed and configured
- GitHub personal access token with repo permissions
- Telegram bot token and chat ID

### Setup

1. Navigate to the scripts directory:
```bash
cd scripts/issue-orchestrator
```

2. Run the setup script:
```bash
./setup.sh
```

3. Edit `config.json` with your credentials:
```json
{
  "github": {
    "token": "ghp_YOUR_GITHUB_TOKEN",
    "repo": "owner/repository",
    "base_repo_path": "/path/to/base/directory/for/repo/clones",
    "repo_path": "/path/to/your/repository",
    "max_concurrent": 3
  },
  "telegram": {
    "bot_token": "YOUR_BOT_TOKEN",
    "chat_id": "YOUR_CHAT_ID"
  },
  "claude": {
    "timeout_seconds": 3600,
    "check_interval": 5
  }
}
```

## Configuration

### GitHub Configuration
- `token`: Personal access token with repo permissions
- `repo`: Repository in `owner/name` format
- `base_repo_path`: Base directory where repository clones will be stored (e.g., `/home/user/repos`)
- `repo_path`: Legacy field - kept for backward compatibility
- `max_concurrent`: Maximum number of issues to process simultaneously (default: 3)

**Repository Cloning**: The orchestrator will create clones named `{repo_name}_{index}` in the `base_repo_path` directory. For example, if your repo is `owner/myproject` and `max_concurrent` is 3, it will create:
- `/path/to/base/directory/for/repo/clones/myproject_0`
- `/path/to/base/directory/for/repo/clones/myproject_1`
- `/path/to/base/directory/for/repo/clones/myproject_2`

### Telegram Configuration (Optional)
- `bot_token`: Telegram bot token from @BotFather
- `chat_id`: Your Telegram chat ID (can be personal or group)

### Slack Configuration (Optional)
- `bot_token`: Slack bot token (starts with xoxb-)
- `channel_id`: Slack channel ID where notifications will be sent

**Note**: Both Telegram and Slack notifications are optional. You can configure one, both, or neither.

### Claude Configuration
- `timeout_seconds`: Maximum time for Claude to process an issue (default: 3600)
- `check_interval`: Seconds between process status checks (default: 5)



## Workflow

1. **Issue Labeling**: Add the `ready-for-claude` label to issues you want processed
2. **Automatic Detection**: The orchestrator picks up labeled issues on its next run
3. **Agent Assignment**: Each issue is assigned to an available agent index (0 to max_concurrent-1)
4. **Repository Setup**: 
   - If the agent's repo clone doesn't exist, it's cloned from GitHub
   - If it exists, latest changes are pulled
   - `setup.sh` is automatically executed if present
5. **Processing**: 
   - Removes `ready-for-claude` label
   - Adds `claude-working` label
   - Creates and checks out branch `issue-ISSUE_NUMBER` in the agent's repo clone
   - Validates branch readiness before launching Claude
   - Runs Claude Code with the issue number
6. **Completion**:
   - On success: Adds `claude-completed` label
   - On failure: Adds `claude-failed` label
   - Removes `claude-working` label
7. **Notifications**: Sends Telegram updates throughout the process

## Label States

- `ready-for-claude`: Issue is queued for processing
- `claude-working`: Issue is currently being processed
- `claude-completed`: Issue was successfully processed
- `claude-failed`: Issue processing failed
- Issues needing input remain in `claude-working` state with notifications

## Telegram Notifications

The orchestrator sends various notifications:

- 🚀 **Started**: When processing begins on an issue
- ✅ **Completed**: When an issue is successfully processed
- ⏳ **Needs Input**: When Claude requires user input
- ❌ **Error**: When processing fails with error details

## State Management

Processing state is maintained in `processing-state.json`:
```json
{
  "123": {
    "issue_number": 123,
    "status": "running",
    "branch": "issue-123",
    "start_time": "2024-01-15T10:30:00",
    "session_id": "abc123",
    "agent_index": 0
  }
}
```

This allows the orchestrator to:
- Resume processing after restarts
- Avoid duplicate processing
- Track processing duration
- Maintain session information
- Assign issues to specific agent repositories
- Track which agent is processing each issue

## Branch Validation and Repository State

The orchestrator includes comprehensive branch validation to ensure reliable processing:

### Pre-Processing Validation
- **Repository Clean State**: Ensures the repository is in a clean state before processing
- **Branch Existence**: Verifies the issue branch exists or creates it
- **Current Branch**: Confirms the repository is on the correct branch before launching Claude
- **Uncommitted Changes**: Warns about any uncommitted changes that might interfere

### Validation Steps
1. **Repository Setup**: Clone/pull repository and run setup.sh
2. **Clean State Check**: Ensure repository is not in detached HEAD state
3. **Branch Creation**: Create or checkout the issue branch
4. **Branch Validation**: Verify branch exists and is currently checked out
5. **State Verification**: Check for any uncommitted changes
6. **Claude Launch**: Only launch Claude after all validations pass

### Error Handling
- **Branch Creation Failures**: Detailed error messages for branch creation issues
- **Validation Failures**: Clear feedback when branch validation fails
- **State Recovery**: Automatic recovery from detached HEAD states
- **Warning System**: Non-blocking warnings for uncommitted changes

## Monitoring Claude Instances

The orchestrator includes a monitoring tool to track Claude Code instances with these features:

### Claude Monitor Features
- 🔍 **Process Monitoring**: Track active Claude Code processes
- 📝 **Conversation History**: View complete message history for each issue
- 📊 **Status Tracking**: Monitor running, completed, and failed instances
- 🔄 **Real-time Updates**: Get current status of all concurrent processes
- 📈 **Comprehensive Reports**: Generate detailed monitoring reports

### Monitor Output Examples

#### Text Format (Default)
```
Claude Code Instance Monitor Report
Generated: 2024-01-15 10:30:00
============================================================
Total Instances: 3
Active: 2
Completed: 1

ACTIVE INSTANCES:
----------------------------------------
  Issue #101:
    PID: 12345
    Status: running
    Runtime: 120.5s
    Messages: 8
    Last Activity: 10:29:45

  Issue #102:
    PID: 12346
    Status: running
    Runtime: 45.2s
    Messages: 3
    Last Activity: 10:30:00

COMPLETED INSTANCES:
----------------------------------------
  Issue #100:
    Status: completed
    Runtime: 300.0s
    Messages: 15
```

#### JSON Format
```json
{
  "timestamp": "2024-01-15T10:30:00",
  "total_instances": 3,
  "active_count": 2,
  "completed_count": 1,
  "active_instances": [
    {
      "issue_number": 101,
      "pid": 12345,
      "status": "running",
      "runtime_seconds": 120.5,
      "message_count": 8
    }
  ],
  "completed_instances": [...]
}
```

## Testing

### Run All Tests
```bash
./venv/bin/pytest tests/
```

### Run with Coverage
```bash
./venv/bin/pytest tests/ --cov=. --cov-report=html
```

### Test Categories
- **Unit Tests**: Test individual components in isolation
- **Integration Tests**: Test interactions between components
- **End-to-End Tests**: Test complete workflow with mocked services

### Testing the Lib Structure
```bash
# Test the lib structure
python test_lib_structure.py

# Test individual modules
python -m pytest tests/test_config.py
python -m pytest tests/test_github_client.py
python -m pytest tests/test_repo_manager.py

# Test integration
python -m pytest tests/test_integration.py
```

## Benefits of Modular Architecture

1. **Clean Separation**: Library code is separated from entry points
2. **Lazy Loading**: Dependencies are loaded only when needed
3. **Maintainability**: Each module has a single responsibility
4. **Testability**: Individual components can be tested in isolation
5. **Reusability**: Components can be used independently
6. **Readability**: Smaller, focused files are easier to understand
7. **Extensibility**: New features can be added as new modules
8. **Debugging**: Issues can be isolated to specific modules

## Lazy Import System

The `lib/__init__.py` file uses a lazy import system that:

- Avoids importing all modules at once
- Prevents dependency issues when modules are missing
- Provides a clean interface for importing components
- Only loads modules when they're actually used

This means you can import the lib package without having all external dependencies installed, and modules are only loaded when you actually use them.

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Verify GitHub token has repo permissions
   - Ensure `gh` CLI is authenticated
   - Check Telegram bot token is valid

2. **Claude Code Not Found**
   - Ensure Claude Code CLI is installed
   - Verify it's available in PATH
   - Check permissions with `claude --version`

3. **Branch Creation Fails**
   - Ensure you have write access to the repository
   - Check if branch already exists
   - Verify git is configured correctly

4. **No Issues Processed**
   - Verify issues have `ready-for-claude` label
   - Check GitHub API rate limits
   - Review orchestrator.log for errors

### Logs

Check `orchestrator.log` for detailed execution logs:
```bash
tail -f orchestrator.log
```

## Development

### Adding Features

1. Fork and clone the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## Security Considerations

- **Never commit** `config.json` with real credentials
- Store sensitive tokens in environment variables for production
- Use read-only tokens where possible
- Regularly rotate access tokens
- Monitor orchestrator.log for suspicious activity

## License

This project is part of the Claude Code ecosystem and follows the same licensing terms.