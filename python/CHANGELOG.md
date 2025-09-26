# Changelog

## [2.3.0] - 2025-08-26

### Added
- **Slack Integration**: Support for Slack notifications alongside Telegram
- **Multiple Notifiers**: Can now use Telegram, Slack, or both simultaneously
- **Rich Slack Messages**: Block-based formatting for better readability in Slack
- **Flexible Configuration**: Both notification systems are now optional

### Changed
- **Updated Dependencies**: Added `slack-sdk>=3.23.0` to requirements
- **Refactored Notifiers**: Orchestrator now supports multiple notification backends
- **Configuration Structure**: Added optional `slack` section to config

### Benefits
- **More Notification Options**: Choose the notification platform that works best for your team
- **Better Team Visibility**: Send notifications to Slack channels for broader team awareness
- **Backward Compatible**: Existing Telegram-only configurations continue to work unchanged

## [2.2.0] - 2024-01-15

### Added
- **Branch Validation**: Comprehensive validation to ensure repository is on correct branch before launching Claude
- **Repository State Management**: Automatic detection and recovery from detached HEAD states
- **Pre-Processing Checks**: Validation of branch existence, current branch, and uncommitted changes
- **Clean State Assurance**: Ensures repository is in clean state before processing

### Changed
- **Enhanced Error Handling**: More detailed error messages for branch-related issues
- **Improved Logging**: Better logging of branch validation steps and results
- **Safer Processing**: Claude only launches after all branch validations pass

### Benefits
- **Reliability**: Ensures Claude always works on the correct branch
- **Error Prevention**: Catches branch-related issues before they cause problems
- **Debugging**: Clear feedback when branch validation fails
- **State Recovery**: Automatic recovery from problematic git states

## [2.1.0] - 2024-01-15

### Changed
- **Removed Worktree Strategy**: Now works directly on branches instead of using git worktrees
- **Simplified Workflow**: Each agent creates and checks out issue branches directly in their repo clone
- **Updated Monitoring**: Claude monitor now tracks repo paths and branches instead of worktree paths
- **Cleaner State**: Removed worktree_path from IssueState, now only tracks repo path and branch

### Benefits
- **Simpler Architecture**: No need to manage worktree creation/cleanup
- **Better Performance**: Direct branch operations are faster than worktree management
- **Easier Debugging**: Simpler to understand and debug branch-based workflow
- **Reduced Complexity**: Fewer moving parts and potential failure points

## [2.0.0] - 2024-01-15

### Added
- **Concurrent Repository Cloning**: Each concurrent agent now uses its own repository clone to avoid conflicts
- **RepoManager Class**: New class to manage repository cloning, pulling, and setup
- **Agent Index Tracking**: Issues are now assigned to specific agent indices (0 to max_concurrent-1)
- **Automatic Setup**: Each repo clone automatically runs `setup.sh` if present
- **Base Repository Path**: New configuration option `base_repo_path` for storing repo clones

### Changed
- **Configuration**: Added `base_repo_path` field to specify where repo clones are stored
- **IssueState**: Added `agent_index` field to track which agent is processing each issue
- **StateManager**: Added methods to track agent assignments and find available agents
- **ClaudeProcessor**: Modified to accept `agent_index` parameter and use agent-specific repos
- **Workflow**: Updated to clone/pull repos and run setup.sh before processing

### Configuration Changes
The `config.json` now requires a new field:
```json
{
  "github": {
    "base_repo_path": "/path/to/base/directory/for/repo/clones",
    // ... other fields
  }
}
```

### Repository Structure
With `max_concurrent: 3` and repo `owner/myproject`, the system creates:
- `/path/to/base/directory/for/repo/clones/myproject_agent_0`
- `/path/to/base/directory/for/repo/clones/myproject_agent_1`
- `/path/to/base/directory/for/repo/clones/myproject_agent_2`

### Backward Compatibility
- The old `repo_path` field is still supported for backward compatibility
- Existing state files will continue to work (agent_index will be None for old entries)

### Benefits
- **No Conflicts**: Each agent works in its own repository clone
- **Parallel Processing**: True concurrent processing without git conflicts
- **Automatic Setup**: Each clone runs setup.sh automatically
- **Fresh Code**: Each run pulls the latest changes
- **Scalability**: Easy to increase max_concurrent without conflicts
