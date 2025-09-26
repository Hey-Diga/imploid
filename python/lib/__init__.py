#!/usr/bin/env python3
"""
GitHub Issue Orchestrator Package

A modular system for automatically processing GitHub issues labeled 'ready-for-claude'
using Claude Code CLI with concurrent processing, state management, and notifications.
"""

__version__ = "1.0.0"
__author__ = "Claude Code Team"

# Define what's available for import
__all__ = [
    # Models
    "ProcessStatus",
    "InstanceStatus", 
    "IssueState",
    "Message",
    "ClaudeInstance",
    "MonitorReport",
    
    # Core components
    "Config",
    "GitHubClient",
    "TelegramNotifier",
    "SlackNotifier",
    "RepoManager",
    "StateManager",
    "ClaudeProcessor",
    "ClaudeMonitor",
    "IssueOrchestrator",
]

# Lazy imports to avoid dependency issues
def _import_models():
    """Import models module."""
    from .models import (
        ProcessStatus,
        InstanceStatus,
        IssueState,
        Message,
        ClaudeInstance,
        MonitorReport
    )
    return ProcessStatus, InstanceStatus, IssueState, Message, ClaudeInstance, MonitorReport

def _import_config():
    """Import config module."""
    from .config import Config
    return Config

def _import_github_client():
    """Import GitHub client module."""
    from .github_client import GitHubClient
    return GitHubClient

def _import_telegram_notifier():
    """Import Telegram notifier module."""
    from .telegram_notifier import TelegramNotifier
    return TelegramNotifier

def _import_slack_notifier():
    """Import Slack notifier module."""
    from .slack_notifier import SlackNotifier
    return SlackNotifier

def _import_repo_manager():
    """Import repo manager module."""
    from .repo_manager import RepoManager
    return RepoManager

def _import_state_manager():
    """Import state manager module."""
    from .state_manager import StateManager
    return StateManager

def _import_claude_processor():
    """Import Claude processor module."""
    from .claude_processor import ClaudeProcessor
    return ClaudeProcessor

def _import_claude_monitor():
    """Import Claude monitor module."""
    from .claude_monitor import ClaudeMonitor
    return ClaudeMonitor

def _import_orchestrator():
    """Import orchestrator module."""
    from .orchestrator import IssueOrchestrator
    return IssueOrchestrator

# Create lazy import proxies
class _LazyImport:
    def __init__(self, import_func, name):
        self._import_func = import_func
        self._name = name
        self._module = None
    
    def __getattr__(self, name):
        if self._module is None:
            self._module = self._import_func()
        return getattr(self._module, name)
    
    def __call__(self, *args, **kwargs):
        if self._module is None:
            self._module = self._import_func()
        return self._module(*args, **kwargs)

# Create lazy import objects
ProcessStatus = _LazyImport(lambda: _import_models()[0], "ProcessStatus")
InstanceStatus = _LazyImport(lambda: _import_models()[1], "InstanceStatus")
IssueState = _LazyImport(lambda: _import_models()[2], "IssueState")
Message = _LazyImport(lambda: _import_models()[3], "Message")
ClaudeInstance = _LazyImport(lambda: _import_models()[4], "ClaudeInstance")
MonitorReport = _LazyImport(lambda: _import_models()[5], "MonitorReport")
Config = _LazyImport(_import_config, "Config")
GitHubClient = _LazyImport(_import_github_client, "GitHubClient")
TelegramNotifier = _LazyImport(_import_telegram_notifier, "TelegramNotifier")
SlackNotifier = _LazyImport(_import_slack_notifier, "SlackNotifier")
RepoManager = _LazyImport(_import_repo_manager, "RepoManager")
StateManager = _LazyImport(_import_state_manager, "StateManager")
ClaudeProcessor = _LazyImport(_import_claude_processor, "ClaudeProcessor")
ClaudeMonitor = _LazyImport(_import_claude_monitor, "ClaudeMonitor")
IssueOrchestrator = _LazyImport(_import_orchestrator, "IssueOrchestrator")

