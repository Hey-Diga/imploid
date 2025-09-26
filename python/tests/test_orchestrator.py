"""Unit tests for the main orchestrator module"""

import asyncio
import json
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock, patch, AsyncMock, MagicMock
import pytest
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from issue_orchestrator import (
    IssueOrchestrator,
    ProcessStatus,
    IssueState,
    Config,
    StateManager,
    GitHubClient,
    TelegramNotifier,
    ClaudeProcessor
)


@pytest.fixture
def mock_config():
    """Create a mock config"""
    with patch('issue_orchestrator.Path.exists', return_value=True):
        with patch('builtins.open', create=True) as mock_open:
            mock_open.return_value.__enter__.return_value.read.return_value = json.dumps({
                "github": {
                    "token": "test_token",
                    "repo": "test/repo",
                    "max_concurrent": 2
                },
                "telegram": {
                    "bot_token": "test_bot_token",
                    "chat_id": "test_chat_id"
                },
                "claude": {
                    "timeout_seconds": 60,
                    "check_interval": 1
                }
            })
            return Config()


@pytest.fixture
def mock_state_manager(tmp_path):
    """Create a state manager with temp file"""
    state_file = tmp_path / "test-state.json"
    return StateManager(str(state_file))


class TestProcessStatus:
    """Test ProcessStatus enum"""
    
    def test_status_values(self):
        assert ProcessStatus.PENDING.value == "pending"
        assert ProcessStatus.RUNNING.value == "running"
        assert ProcessStatus.NEEDS_INPUT.value == "needs_input"
        assert ProcessStatus.COMPLETED.value == "completed"
        assert ProcessStatus.FAILED.value == "failed"


class TestIssueState:
    """Test IssueState dataclass"""
    
    def test_issue_state_creation(self):
        state = IssueState(
            issue_number=123,
            status="running",
            session_id="abc123",
            branch="issue-123",
            start_time="2024-01-01T10:00:00"
        )
        
        assert state.issue_number == 123
        assert state.status == "running"
        assert state.session_id == "abc123"
        assert state.branch == "issue-123"
        assert state.start_time == "2024-01-01T10:00:00"
        assert state.end_time is None
        assert state.last_output is None
        assert state.error is None
    
    def test_issue_state_to_dict(self):
        state = IssueState(
            issue_number=123,
            status="running",
            session_id="abc123",
            branch="issue-123",
            start_time="2024-01-01T10:00:00"
        )
        
        state_dict = state.to_dict()
        assert state_dict["issue_number"] == 123
        assert state_dict["status"] == "running"
        assert state_dict["session_id"] == "abc123"
        assert state_dict["branch"] == "issue-123"
        assert state_dict["start_time"] == "2024-01-01T10:00:00"
        assert "end_time" not in state_dict  # None values should be excluded
        assert "last_output" not in state_dict
        assert "error" not in state_dict


class TestConfig:
    """Test Config class"""
    
    def test_config_loading(self, mock_config):
        assert mock_config.github_token == "test_token"
        assert mock_config.github_repo == "test/repo"
        assert mock_config.max_concurrent == 2
        assert mock_config.telegram_bot_token == "test_bot_token"
        assert mock_config.telegram_chat_id == "test_chat_id"
        assert mock_config.claude_timeout == 60
        assert mock_config.claude_check_interval == 1
    
    def test_config_file_not_found(self):
        with pytest.raises(FileNotFoundError):
            Config("nonexistent.json")
    
    def test_config_missing_required_field(self):
        with patch('issue_orchestrator.Path.exists', return_value=True):
            with patch('builtins.open', create=True) as mock_open:
                mock_open.return_value.__enter__.return_value.read.return_value = json.dumps({
                    "github": {"token": "test"},
                    "telegram": {"bot_token": "test"}
                    # Missing 'claude' field
                })
                with pytest.raises(ValueError, match="Missing required config field: claude"):
                    Config()


class TestStateManager:
    """Test StateManager class"""
    
    def test_state_manager_init(self, mock_state_manager):
        assert mock_state_manager.states == {}
        assert mock_state_manager.state_file.exists() == False
    
    @pytest.mark.asyncio
    async def test_save_and_load_states(self, mock_state_manager):
        # Add a state
        state = IssueState(
            issue_number=123,
            status="running",
            session_id="abc",
            branch="issue-123",
            start_time="2024-01-01T10:00:00"
        )
        mock_state_manager.set_state(123, state)
        
        # Save states
        await mock_state_manager.save_states()
        assert mock_state_manager.state_file.exists()
        
        # Create new manager and load states
        new_manager = StateManager(str(mock_state_manager.state_file))
        loaded_state = new_manager.get_state(123)
        
        assert loaded_state is not None
        assert loaded_state.issue_number == 123
        assert loaded_state.status == "running"
        assert loaded_state.session_id == "abc"
    
    def test_get_active_issues(self, mock_state_manager):
        # Add various states
        mock_state_manager.set_state(1, IssueState(1, "running", None, "b1", "t1"))
        mock_state_manager.set_state(2, IssueState(2, "completed", None, "b2", "t2"))
        mock_state_manager.set_state(3, IssueState(3, "needs_input", None, "b3", "t3"))
        mock_state_manager.set_state(4, IssueState(4, "failed", None, "b4", "t4"))
        
        active = mock_state_manager.get_active_issues()
        assert set(active) == {1, 3}  # Only running and needs_input
    
    def test_remove_state(self, mock_state_manager):
        state = IssueState(123, "running", None, "b", "t")
        mock_state_manager.set_state(123, state)
        assert mock_state_manager.get_state(123) is not None
        
        mock_state_manager.remove_state(123)
        assert mock_state_manager.get_state(123) is None


class TestGitHubClient:
    """Test GitHubClient class"""
    
    @pytest.mark.asyncio
    async def test_get_ready_issues(self):
        client = GitHubClient("test_token", "test/repo")
        
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value=[
            {"number": 1, "title": "Issue 1"},
            {"number": 2, "title": "Issue 2"}
        ])
        
        mock_session = MagicMock()
        mock_context = AsyncMock()
        mock_context.__aenter__ = AsyncMock(return_value=mock_response)
        mock_context.__aexit__ = AsyncMock(return_value=None)
        mock_session.get.return_value = mock_context
        
        issues = await client.get_ready_issues(mock_session)
        
        assert len(issues) == 2
        assert issues[0]["number"] == 1
        assert issues[1]["number"] == 2
        
        # Verify API call
        mock_session.get.assert_called_once()
        call_args = mock_session.get.call_args
        assert "labels" in call_args[1]["params"]
        assert call_args[1]["params"]["labels"] == "ready-for-claude"
    
    @pytest.mark.asyncio
    async def test_update_issue_labels(self):
        client = GitHubClient("test_token", "test/repo")
        
        # Mock getting current labels
        get_response = MagicMock()
        get_response.status = 200
        get_response.json = AsyncMock(return_value={
            "labels": [
                {"name": "ready-for-claude"},
                {"name": "bug"}
            ]
        })
        
        # Mock updating labels
        put_response = MagicMock()
        put_response.status = 200
        
        mock_session = MagicMock()
        
        # Setup get context manager
        get_context = AsyncMock()
        get_context.__aenter__ = AsyncMock(return_value=get_response)
        get_context.__aexit__ = AsyncMock(return_value=None)
        mock_session.get.return_value = get_context
        
        # Setup put context manager
        put_context = AsyncMock()
        put_context.__aenter__ = AsyncMock(return_value=put_response)
        put_context.__aexit__ = AsyncMock(return_value=None)
        mock_session.put.return_value = put_context
        
        await client.update_issue_labels(
            mock_session,
            123,
            add_labels=["claude-working"],
            remove_labels=["ready-for-claude"]
        )
        
        # Verify the put call
        mock_session.put.assert_called_once()
        call_args = mock_session.put.call_args
        labels = call_args[1]["json"]
        assert "claude-working" in labels
        assert "ready-for-claude" not in labels
        assert "bug" in labels  # Should keep existing label


class TestTelegramNotifier:
    """Test TelegramNotifier class"""
    
    @pytest.mark.asyncio
    async def test_notify_start(self):
        with patch('issue_orchestrator.Bot') as mock_bot_class:
            mock_bot = AsyncMock()
            mock_bot_class.return_value = mock_bot
            
            notifier = TelegramNotifier("test_token", "test_chat")
            await notifier.notify_start(123, "Test Issue")
            
            mock_bot.send_message.assert_called_once()
            call_args = mock_bot.send_message.call_args
            assert "123" in call_args[1]["text"]
            assert "Test Issue" in call_args[1]["text"]
            assert "🚀" in call_args[1]["text"]
    
    @pytest.mark.asyncio
    async def test_notify_complete(self):
        with patch('issue_orchestrator.Bot') as mock_bot_class:
            mock_bot = AsyncMock()
            mock_bot_class.return_value = mock_bot
            
            notifier = TelegramNotifier("test_token", "test_chat")
            await notifier.notify_complete(123, "1:23:45")
            
            mock_bot.send_message.assert_called_once()
            call_args = mock_bot.send_message.call_args
            assert "123" in call_args[1]["text"]
            assert "1:23:45" in call_args[1]["text"]
            assert "✅" in call_args[1]["text"]
    
    @pytest.mark.asyncio
    async def test_message_truncation(self):
        with patch('issue_orchestrator.Bot') as mock_bot_class:
            mock_bot = AsyncMock()
            mock_bot_class.return_value = mock_bot
            
            notifier = TelegramNotifier("test_token", "test_chat")
            
            # Create a very long message
            long_message = "x" * 5000
            await notifier.send_message(long_message)
            
            mock_bot.send_message.assert_called_once()
            call_args = mock_bot.send_message.call_args
            sent_text = call_args[1]["text"]
            assert len(sent_text) <= 4100  # Should be truncated
            assert "truncated" in sent_text


class TestClaudeProcessor:
    """Test ClaudeProcessor class"""
    
    @pytest.mark.asyncio
    async def test_process_issue_success(self, mock_config):
        with patch('issue_orchestrator.Bot'):
            notifier = TelegramNotifier("test", "test")
            processor = ClaudeProcessor(mock_config, notifier)
            
            # Mock git commands
            processor._run_command = AsyncMock(return_value=(0, "", ""))
            
            # Mock subprocess for Claude
            mock_process = AsyncMock()
            mock_process.returncode = 0
            mock_process.communicate = AsyncMock(return_value=(b"Success", b""))
            
            with patch('asyncio.create_subprocess_exec', return_value=mock_process):
                state_manager = AsyncMock()
                result = await processor.process_issue(123, state_manager)
                
                assert result == ProcessStatus.COMPLETED
    
    @pytest.mark.asyncio
    async def test_process_issue_failure(self, mock_config):
        with patch('issue_orchestrator.Bot'):
            notifier = TelegramNotifier("test", "test")
            notifier.notify_error = AsyncMock()
            processor = ClaudeProcessor(mock_config, notifier)
            
            # Mock git commands
            processor._run_command = AsyncMock(return_value=(0, "", ""))
            
            # Mock subprocess for Claude with failure
            mock_process = AsyncMock()
            mock_process.returncode = 1
            mock_process.communicate = AsyncMock(return_value=(b"", b"Error occurred"))
            
            with patch('asyncio.create_subprocess_exec', return_value=mock_process):
                state_manager = AsyncMock()
                result = await processor.process_issue(123, state_manager)
                
                assert result == ProcessStatus.FAILED
                notifier.notify_error.assert_called_once()


class TestIssueOrchestrator:
    """Test IssueOrchestrator class"""
    
    @pytest.mark.asyncio
    async def test_orchestrator_run(self, mock_config):
        with patch('issue_orchestrator.Config', return_value=mock_config):
            with patch('issue_orchestrator.StateManager') as mock_state_manager_class:
                with patch('issue_orchestrator.GitHubClient') as mock_github_class:
                    with patch('issue_orchestrator.TelegramNotifier') as mock_notifier_class:
                        with patch('issue_orchestrator.ClaudeProcessor') as mock_processor_class:
                            # Setup mocks
                            mock_state_manager = MagicMock()
                            mock_state_manager.get_active_issues = MagicMock(return_value=[])
                            mock_state_manager.save_states = AsyncMock()
                            mock_state_manager_class.return_value = mock_state_manager
                            
                            mock_github = MagicMock()
                            mock_github.get_ready_issues = AsyncMock(return_value=[
                                {"number": 1, "title": "Issue 1"},
                                {"number": 2, "title": "Issue 2"}
                            ])
                            mock_github.update_issue_labels = AsyncMock()
                            mock_github_class.return_value = mock_github
                            
                            mock_notifier = AsyncMock()
                            mock_notifier_class.return_value = mock_notifier
                            
                            mock_processor = AsyncMock()
                            mock_processor.process_issue = AsyncMock(
                                return_value=ProcessStatus.COMPLETED
                            )
                            mock_processor_class.return_value = mock_processor
                            
                            # Run orchestrator
                            orchestrator = IssueOrchestrator()
                            orchestrator._process_issue = AsyncMock()
                            
                            await orchestrator.run()
                            
                            # Verify calls
                            mock_github.get_ready_issues.assert_called_once()
                            assert orchestrator._process_issue.call_count == 2
    
    @pytest.mark.asyncio
    async def test_process_issue_complete_flow(self, mock_config):
        with patch('issue_orchestrator.Config', return_value=mock_config):
            with patch('issue_orchestrator.StateManager') as mock_state_manager_class:
                with patch('issue_orchestrator.GitHubClient') as mock_github_class:
                    with patch('issue_orchestrator.TelegramNotifier') as mock_notifier_class:
                        with patch('issue_orchestrator.ClaudeProcessor') as mock_processor_class:
                            # Setup mocks
                            mock_state_manager = Mock()
                            mock_state_manager.save_states = AsyncMock()
                            mock_state_manager.set_state = Mock()
                            mock_state_manager.remove_state = Mock()
                            mock_state_manager_class.return_value = mock_state_manager
                            
                            mock_github = Mock()
                            mock_github.update_issue_labels = AsyncMock()
                            mock_github_class.return_value = mock_github
                            
                            mock_notifier = Mock()
                            mock_notifier.notify_start = AsyncMock()
                            mock_notifier.notify_complete = AsyncMock()
                            mock_notifier_class.return_value = mock_notifier
                            
                            mock_processor = Mock()
                            mock_processor.process_issue = AsyncMock(
                                return_value=ProcessStatus.COMPLETED
                            )
                            mock_processor_class.return_value = mock_processor
                            
                            # Create orchestrator and process issue
                            orchestrator = IssueOrchestrator()
                            
                            session = AsyncMock()
                            issue = {"number": 123, "title": "Test Issue"}
                            
                            await orchestrator._process_issue(session, issue)
                            
                            # Verify workflow
                            mock_github.update_issue_labels.assert_called()
                            mock_state_manager.set_state.assert_called()
                            mock_notifier.notify_start.assert_called_once()
                            mock_processor.process_issue.assert_called_once()
                            mock_notifier.notify_complete.assert_called_once()
                            mock_state_manager.remove_state.assert_called_with(123)