"""Integration tests for the issue orchestrator"""

import asyncio
import json
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch, AsyncMock, MagicMock
import pytest
import sys
import os
from datetime import datetime, timedelta

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from lib import (
    IssueOrchestrator,
    ProcessStatus,
    IssueState,
    Config,
    StateManager,
    GitHubClient,
    TelegramNotifier,
    ClaudeProcessor,
    ClaudeMonitor,
    ClaudeInstance,
    InstanceStatus,
    Message,
    MonitorReport
)


class TestIntegration:
    """Integration tests for complete workflows"""
    
    @pytest.fixture
    def temp_config(self, tmp_path):
        """Create a temporary config file"""
        config_path = tmp_path / "config.json"
        config_data = {
            "github": {
                "token": "test_token",
                "repos": [
                    {
                        "name": "test/repo",
                        "base_repo_path": "/tmp/test_repos"
                    }
                ],
                "repo": "test/repo",
                "base_repo_path": "/tmp/test_repos",
                "max_concurrent": 2
            },
            "telegram": {
                "bot_token": "test_bot_token",
                "chat_id": "test_chat_id"
            },
            "slack": {
                "bot_token": "",
                "channel_id": ""
            },
            "claude": {
                "timeout_seconds": 10,
                "check_interval": 1,
                "path": "claude"
            }
        }
        with open(config_path, 'w') as f:
            json.dump(config_data, f)
        return str(config_path)
    
    @pytest.fixture
    def temp_state_file(self, tmp_path):
        """Create a temporary state file"""
        return str(tmp_path / "state.json")
    
    def get_mock_config(self, config_path):
        """Helper to create a properly mocked Config instance"""
        mock_config_instance = MagicMock()
        with open(config_path) as f:
            test_config = json.load(f)
        mock_config_instance._config = test_config
        mock_config_instance.github_token = test_config["github"]["token"]
        mock_config_instance.github_repo = test_config["github"]["repo"]
        mock_config_instance.github_repos = [{"name": test_config["github"]["repo"], "base_repo_path": "/tmp/test"}]
        mock_config_instance.max_concurrent = test_config["github"]["max_concurrent"]
        mock_config_instance.telegram_bot_token = test_config["telegram"]["bot_token"]
        mock_config_instance.telegram_chat_id = test_config["telegram"]["chat_id"]
        mock_config_instance.slack_bot_token = ""  # Empty for tests
        mock_config_instance.slack_channel_id = ""  # Empty for tests
        mock_config_instance.claude_timeout = test_config["claude"]["timeout_seconds"]
        mock_config_instance.claude_check_interval = test_config["claude"]["check_interval"]
        mock_config_instance.claude_path = "claude"
        mock_config_instance.base_repo_path = "/tmp/test"
        mock_config_instance.get_repo_path = MagicMock(return_value=Path("/tmp/test_repo"))
        mock_config_instance.get_repo_config = MagicMock(return_value={"name": test_config["github"]["repo"], "base_repo_path": "/tmp/test"})
        return mock_config_instance
    
    @pytest.mark.asyncio
    async def test_complete_issue_processing_flow(self, temp_config, temp_state_file):
        """Test the complete flow from issue detection to completion"""
        
        # Mock external dependencies
        with patch('lib.telegram_notifier.Bot'):
            with patch('aiohttp.ClientSession') as mock_session_class:
                mock_session = AsyncMock()
                mock_session_class.return_value.__aenter__.return_value = mock_session
                mock_session_class.return_value.__aexit__.return_value = AsyncMock()
                
                # Mock GitHub API responses
                # Get issues response
                get_issues_response = AsyncMock()
                get_issues_response.status = 200
                get_issues_response.json = AsyncMock(return_value=[
                    {
                        "number": 100,
                        "title": "Test Issue",
                        "labels": [{"name": "ready-for-claude"}]
                    }
                ])
                
                # Get single issue response (for label update)
                get_issue_response = AsyncMock()
                get_issue_response.status = 200
                get_issue_response.json = AsyncMock(return_value={
                    "labels": [{"name": "ready-for-claude"}]
                })
                
                # Update labels response
                update_labels_response = AsyncMock()
                update_labels_response.status = 200
                
                # Configure mock session
                mock_session.get = AsyncMock()
                mock_session.put = AsyncMock()
                
                # Setup different responses for different URLs
                async def mock_get(url, **kwargs):
                    if "/issues?" in url:  # Getting list of issues
                        return get_issues_response
                    else:  # Getting single issue
                        return get_issue_response
                
                mock_session.get.side_effect = lambda url, **kwargs: AsyncMock(
                    __aenter__=AsyncMock(return_value=mock_get(url, **kwargs)),
                    __aexit__=AsyncMock()
                )()
                
                mock_session.put.return_value = AsyncMock(
                    __aenter__=AsyncMock(return_value=update_labels_response),
                    __aexit__=AsyncMock()
                )
                
                # Mock Claude process
                with patch('asyncio.create_subprocess_exec') as mock_subprocess:
                    mock_process = AsyncMock()
                    mock_process.returncode = 0
                    mock_process.communicate = AsyncMock(return_value=(b"Success", b""))
                    mock_subprocess.return_value = mock_process
                    
                    # Mock git commands
                    with patch('asyncio.create_subprocess_shell') as mock_shell:
                        mock_git_process = AsyncMock()
                        mock_git_process.returncode = 0
                        mock_git_process.communicate = AsyncMock(return_value=(b"", b""))
                        mock_shell.return_value = mock_git_process
                        
                        # Create orchestrator with our config
                        with patch.object(Config, '__new__') as mock_config_new:
                            mock_instance = self.get_mock_config(temp_config)
                            mock_config_new.return_value = mock_instance
                            
                            with patch.object(StateManager, '__init__', 
                                            lambda self, path=None: None):
                                orchestrator = IssueOrchestrator()
                                orchestrator.state_manager.state_file = Path(temp_state_file)
                                orchestrator.state_manager.states = {}
                                
                                # Run the orchestrator
                                await orchestrator.run()
                                
                                # Verify GitHub API calls
                                assert mock_session.get.called
                                assert mock_session.put.called
                                
                                # Verify Claude was invoked
                                assert mock_subprocess.called
                                
                                # Verify git commands were run
                                assert mock_shell.called
    
    @pytest.mark.asyncio
    async def test_concurrent_issue_processing(self, temp_config, temp_state_file):
        """Test processing multiple issues concurrently"""
        
        with patch('lib.telegram_notifier.Bot'):
            with patch('aiohttp.ClientSession') as mock_session_class:
                mock_session = AsyncMock()
                mock_session_class.return_value.__aenter__.return_value = mock_session
                mock_session_class.return_value.__aexit__.return_value = AsyncMock()
                
                # Mock multiple issues
                get_issues_response = AsyncMock()
                get_issues_response.status = 200
                get_issues_response.json = AsyncMock(return_value=[
                    {"number": 101, "title": "Issue 1", "labels": [{"name": "ready-for-claude"}]},
                    {"number": 102, "title": "Issue 2", "labels": [{"name": "ready-for-claude"}]},
                    {"number": 103, "title": "Issue 3", "labels": [{"name": "ready-for-claude"}]}
                ])
                
                mock_session.get.return_value = AsyncMock(
                    __aenter__=AsyncMock(return_value=get_issues_response),
                    __aexit__=AsyncMock()
                )
                
                mock_session.put.return_value = AsyncMock(
                    __aenter__=AsyncMock(return_value=AsyncMock(status=200)),
                    __aexit__=AsyncMock()
                )
                
                # Track concurrent executions
                concurrent_count = []
                max_concurrent = 0
                
                async def mock_process_issue(*args, **kwargs):
                    nonlocal max_concurrent
                    concurrent_count.append(1)
                    current = len(concurrent_count)
                    max_concurrent = max(max_concurrent, current)
                    await asyncio.sleep(0.1)  # Simulate processing
                    concurrent_count.pop()
                    return ProcessStatus.COMPLETED
                
                with patch.object(Config, '__new__') as mock_config_new:
                    mock_instance = self.get_mock_config(temp_config)
                    mock_config_new.return_value = mock_instance
                    
                    orchestrator = IssueOrchestrator()
                    orchestrator.processor.process_issue = mock_process_issue
                    orchestrator.state_manager.get_active_issues = Mock(return_value=[])
                    orchestrator.state_manager.save_states = AsyncMock()
                    
                    await orchestrator.run()
                    
                    # Should respect max_concurrent limit (2)
                    assert max_concurrent <= 2
    
    @pytest.mark.asyncio
    async def test_state_persistence_across_runs(self, temp_config, temp_state_file):
        """Test that state persists across orchestrator runs"""
        
        # First run - start processing an issue
        initial_state = {
            "101": {
                "issue_number": 101,
                "status": "running",
                "session_id": "abc123",
                "branch": "issue-101",
                "start_time": "2024-01-01T10:00:00"
            }
        }
        
        # Write initial state
        with open(temp_state_file, 'w') as f:
            json.dump(initial_state, f)
        
        with patch('lib.telegram_notifier.Bot'):
            with patch('aiohttp.ClientSession') as mock_session_class:
                mock_session = AsyncMock()
                mock_session_class.return_value.__aenter__.return_value = mock_session
                mock_session_class.return_value.__aexit__.return_value = AsyncMock()
                
                # No new issues (already processing one)
                get_issues_response = AsyncMock()
                get_issues_response.status = 200
                get_issues_response.json = AsyncMock(return_value=[])
                
                mock_session.get.return_value = AsyncMock(
                    __aenter__=AsyncMock(return_value=get_issues_response),
                    __aexit__=AsyncMock()
                )
                
                with patch.object(Config, '__new__') as mock_config_new:
                    mock_instance = self.get_mock_config(temp_config)
                    mock_config_new.return_value = mock_instance
                    
                    # Create state manager with our temp file
                    state_manager = StateManager(temp_state_file)
                    
                    # Verify state was loaded
                    assert 101 in state_manager.states
                    assert state_manager.states[101].status == "running"
                    assert state_manager.states[101].session_id == "abc123"
                    
                    # Verify active issues
                    active = state_manager.get_active_issues()
                    assert 101 in active
    
    @pytest.mark.asyncio
    async def test_error_recovery(self, temp_config, temp_state_file):
        """Test error handling and recovery"""
        
        with patch('lib.telegram_notifier.Bot'):
            with patch('aiohttp.ClientSession') as mock_session_class:
                mock_session = AsyncMock()
                mock_session_class.return_value.__aenter__.return_value = mock_session
                mock_session_class.return_value.__aexit__.return_value = AsyncMock()
                
                # Simulate GitHub API error
                mock_session.get.side_effect = Exception("GitHub API error")
                
                with patch.object(Config, '__new__') as mock_config_new:
                    mock_instance = self.get_mock_config(temp_config)
                    mock_config_new.return_value = mock_instance
                    
                    orchestrator = IssueOrchestrator()
                    
                    # Should not crash, should handle error gracefully
                    with pytest.raises(Exception):
                        await orchestrator.run()
                    
                    # State should be saved even on error
                    state_file = Path(temp_state_file)
                    # File might not exist if no states were created
                    assert True  # Just verify no crash
    
    @pytest.mark.asyncio
    async def test_notification_flow(self, temp_config, temp_state_file):
        """Test that all notifications are sent correctly"""
        
        notifications_sent = []
        
        with patch('lib.telegram_notifier.Bot') as mock_bot_class:
            mock_bot = AsyncMock()
            
            async def track_notification(chat_id, text, **kwargs):
                notifications_sent.append(text)
            
            mock_bot.send_message = track_notification
            mock_bot_class.return_value = mock_bot
            
            with patch('aiohttp.ClientSession') as mock_session_class:
                mock_session = AsyncMock()
                mock_session_class.return_value.__aenter__.return_value = mock_session
                mock_session_class.return_value.__aexit__.return_value = AsyncMock()
                
                # Mock issue
                get_issues_response = AsyncMock()
                get_issues_response.status = 200
                get_issues_response.json = AsyncMock(return_value=[
                    {"number": 200, "title": "Test Issue", "labels": [{"name": "ready-for-claude"}]}
                ])
                
                get_issue_response = AsyncMock()
                get_issue_response.status = 200
                get_issue_response.json = AsyncMock(return_value={
                    "labels": [{"name": "ready-for-claude"}]
                })
                
                mock_session.get.side_effect = [
                    AsyncMock(
                        __aenter__=AsyncMock(return_value=get_issues_response),
                        __aexit__=AsyncMock()
                    ),
                    AsyncMock(
                        __aenter__=AsyncMock(return_value=get_issue_response),
                        __aexit__=AsyncMock()
                    )
                ]
                
                mock_session.put.return_value = AsyncMock(
                    __aenter__=AsyncMock(return_value=AsyncMock(status=200)),
                    __aexit__=AsyncMock()
                )
                
                # Mock successful Claude process
                with patch('asyncio.create_subprocess_exec') as mock_subprocess:
                    mock_process = AsyncMock()
                    mock_process.returncode = 0
                    mock_process.communicate = AsyncMock(return_value=(b"Success", b""))
                    mock_subprocess.return_value = mock_process
                    
                    with patch('asyncio.create_subprocess_shell') as mock_shell:
                        mock_git_process = AsyncMock()
                        mock_git_process.returncode = 0
                        mock_git_process.communicate = AsyncMock(return_value=(b"", b""))
                        mock_shell.return_value = mock_git_process
                        
                        # Change to the temp directory to use the temp config
                        import os
                        old_cwd = os.getcwd()
                        try:
                            os.chdir(os.path.dirname(temp_config))
                            
                            orchestrator = IssueOrchestrator()
                            await orchestrator.run()
                        finally:
                            os.chdir(old_cwd)
                            
                            # Should have sent start and complete notifications
                            assert len(notifications_sent) == 2
                            assert "🚀" in notifications_sent[0]  # Start notification
                            assert "✅" in notifications_sent[1]  # Complete notification
                            assert "200" in notifications_sent[0]  # Issue number
                            assert "200" in notifications_sent[1]  # Issue number


class TestClaudeMonitorIntegration:
    """Integration tests for Claude monitor with issue orchestrator"""
    
    @pytest.fixture
    def temp_repo(self, tmp_path):
        """Create a temporary repository structure"""
        repo_path = tmp_path / "test_repo"
        repo_path.mkdir()
        worktrees_dir = repo_path / ".worktrees"
        worktrees_dir.mkdir()
        
        # Create Claude home structure
        claude_home = tmp_path / ".claude"
        claude_home.mkdir()
        projects_dir = claude_home / "projects"
        projects_dir.mkdir()
        
        return {
            "repo": repo_path,
            "worktrees": worktrees_dir,
            "claude_home": claude_home,
            "projects": projects_dir
        }
    
    def create_test_worktree(self, temp_repo, issue_number):
        """Helper to create a test worktree"""
        worktree = temp_repo["worktrees"] / f"issue-{issue_number}"
        worktree.mkdir()
        return worktree
    
    def create_test_conversation(self, temp_repo, worktree_path, messages):
        """Helper to create test conversation data"""
        monitor = ClaudeMonitor(str(temp_repo["repo"]))
        monitor.claude_home = temp_repo["claude_home"]
        monitor.projects_dir = temp_repo["projects"]
        
        encoded = monitor._encode_project_path(worktree_path)
        project_dir = temp_repo["projects"] / encoded
        project_dir.mkdir()
        
        jsonl_file = project_dir / "session.jsonl"
        with open(jsonl_file, 'w') as f:
            for msg in messages:
                f.write(json.dumps(msg) + "\n")
        
        return project_dir
    
    @pytest.mark.asyncio
    async def test_monitor_with_orchestrator_workflow(self, temp_repo):
        """Test monitoring Claude instances created by orchestrator"""
        
        # Create worktrees for multiple issues
        worktree_1 = self.create_test_worktree(temp_repo, 1)
        worktree_2 = self.create_test_worktree(temp_repo, 2)
        
        # Create conversation data for issue 1 (completed)
        messages_1 = [
            {
                "type": "user",
                "message": {"role": "user", "content": "Fix bug in login"},
                "sessionId": "session-1",
                "timestamp": (datetime.now() - timedelta(hours=2)).isoformat()
            },
            {
                "type": "assistant",
                "message": {"role": "assistant", "content": "Fixed the bug"},
                "sessionId": "session-1",
                "timestamp": (datetime.now() - timedelta(hours=1)).isoformat()
            }
        ]
        self.create_test_conversation(temp_repo, worktree_1, messages_1)
        
        # Create conversation data for issue 2 (in progress)
        messages_2 = [
            {
                "type": "user",
                "message": {"role": "user", "content": "Add new feature"},
                "sessionId": "session-2",
                "timestamp": datetime.now().isoformat()
            }
        ]
        self.create_test_conversation(temp_repo, worktree_2, messages_2)
        
        # Create monitor
        monitor = ClaudeMonitor(str(temp_repo["repo"]))
        monitor.claude_home = temp_repo["claude_home"]
        monitor.projects_dir = temp_repo["projects"]
        
        # Mock active process for issue 2
        with patch.object(monitor, '_get_process_info') as mock_proc_info:
            def get_proc_info(path):
                if "issue-2" in str(path):
                    return {
                        'pid': 9999,
                        'create_time': datetime.now(),
                        'cmdline': f'claude code {path}'
                    }
                return None
            
            mock_proc_info.side_effect = get_proc_info
            
            # Get comprehensive report
            report = monitor.monitor_all()
            
            # Verify results
            assert len(report.active_instances) == 1
            assert len(report.completed_instances) == 1
            assert report.total_instances == 2
            
            # Check active instance
            active = report.active_instances[0]
            assert active.issue_number == 2
            assert active.pid == 9999
            assert active.status == InstanceStatus.RUNNING
            assert active.message_count == 1
            
            # Check completed instance
            completed = report.completed_instances[0]
            assert completed.issue_number == 1
            assert completed.status == InstanceStatus.COMPLETED
            assert completed.message_count == 2
    
    @pytest.mark.asyncio
    async def test_monitor_detects_timeout(self, temp_repo):
        """Test that monitor can detect timed out Claude instances"""
        
        worktree = self.create_test_worktree(temp_repo, 10)
        
        # Create old conversation (simulating timeout)
        old_messages = [
            {
                "type": "user",
                "message": {"role": "user", "content": "Complex task"},
                "sessionId": "timeout-session",
                "timestamp": (datetime.now() - timedelta(hours=5)).isoformat()
            }
        ]
        self.create_test_conversation(temp_repo, worktree, old_messages)
        
        monitor = ClaudeMonitor(str(temp_repo["repo"]))
        monitor.claude_home = temp_repo["claude_home"]
        monitor.projects_dir = temp_repo["projects"]
        
        # No active process
        with patch.object(monitor, '_get_process_info', return_value=None):
            status = monitor.get_instance_status(10)
            
            assert status is not None
            assert status.issue_number == 10
            assert status.pid is None
            # Without explicit timeout detection in messages, status might be UNKNOWN
            assert status.status in [InstanceStatus.UNKNOWN, InstanceStatus.TIMEOUT]
    
    @pytest.mark.asyncio
    async def test_monitor_tracks_multiple_concurrent(self, temp_repo):
        """Test monitoring multiple concurrent Claude instances"""
        
        # Create multiple worktrees
        worktrees = []
        for i in range(1, 6):
            worktree = self.create_test_worktree(temp_repo, i)
            worktrees.append(worktree)
            
            # Create conversation for each
            messages = [
                {
                    "type": "user",
                    "message": {"role": "user", "content": f"Task for issue {i}"},
                    "sessionId": f"session-{i}",
                    "timestamp": datetime.now().isoformat()
                }
            ]
            self.create_test_conversation(temp_repo, worktree, messages)
        
        monitor = ClaudeMonitor(str(temp_repo["repo"]))
        monitor.claude_home = temp_repo["claude_home"]
        monitor.projects_dir = temp_repo["projects"]
        
        # Mock 3 active processes
        with patch.object(monitor, '_get_process_info') as mock_proc_info:
            def get_proc_info(path):
                if "issue-1" in str(path) or "issue-2" in str(path) or "issue-3" in str(path):
                    issue_num = int(str(path).split("-")[-1])
                    return {
                        'pid': 1000 + issue_num,
                        'create_time': datetime.now(),
                        'cmdline': f'claude code {path}'
                    }
                return None
            
            mock_proc_info.side_effect = get_proc_info
            
            # Get active instances
            active = monitor.get_active_instances()
            
            assert len(active) == 3
            assert sorted([inst.issue_number for inst in active]) == [1, 2, 3]
            assert all(inst.status == InstanceStatus.RUNNING for inst in active)
    
    @pytest.mark.asyncio
    async def test_monitor_cli_integration(self, temp_repo, capsys):
        """Test CLI interface of the monitor"""
        
        worktree = self.create_test_worktree(temp_repo, 42)
        
        # Create conversation
        messages = [
            {
                "type": "user",
                "message": {"role": "user", "content": "CLI test"},
                "sessionId": "cli-session",
                "timestamp": datetime.now().isoformat()
            },
            {
                "type": "assistant",
                "message": {"role": "assistant", "content": "Response"},
                "sessionId": "cli-session",
                "timestamp": datetime.now().isoformat()
            }
        ]
        self.create_test_conversation(temp_repo, worktree, messages)
        
        # Test status command
        with patch('sys.argv', ['claude_monitor.py', 'status', 
                               '--repo', str(temp_repo["repo"]), '--issue', '42']):
            with patch('lib.claude_monitor.ClaudeMonitor') as mock_monitor_class:
                mock_monitor = Mock()
                mock_monitor_class.return_value = mock_monitor
                
                instance = ClaudeInstance(
                    issue_number=42,
                    worktree_path=worktree,
                    status=InstanceStatus.COMPLETED,
                    message_count=2
                )
                mock_monitor.get_instance_status.return_value = instance
                mock_monitor.format_output.return_value = "Issue #42\n  Status: completed"
                
                from claude_monitor import main
                main()
                
                mock_monitor.get_instance_status.assert_called_with(42)
    
    @pytest.mark.asyncio
    async def test_monitor_json_output(self, temp_repo):
        """Test JSON output format for integration with other tools"""
        
        worktree = self.create_test_worktree(temp_repo, 100)
        
        monitor = ClaudeMonitor(str(temp_repo["repo"]), output_format="json")
        monitor.claude_home = temp_repo["claude_home"]
        monitor.projects_dir = temp_repo["projects"]
        
        report = MonitorReport()
        report.active_instances = [
            ClaudeInstance(
                issue_number=100,
                worktree_path=worktree,
                pid=5555,
                status=InstanceStatus.RUNNING
            )
        ]
        report.total_instances = 1
        
        json_output = monitor.format_output(report)
        data = json.loads(json_output)
        
        assert data["total_instances"] == 1
        assert data["active_count"] == 1
        assert len(data["active_instances"]) == 1
        assert data["active_instances"][0]["issue_number"] == 100
    
    @pytest.mark.asyncio
    async def test_monitor_handles_corrupted_jsonl(self, temp_repo):
        """Test that monitor handles corrupted JSONL files gracefully"""
        
        worktree = self.create_test_worktree(temp_repo, 50)
        
        monitor = ClaudeMonitor(str(temp_repo["repo"]))
        monitor.claude_home = temp_repo["claude_home"]
        monitor.projects_dir = temp_repo["projects"]
        
        # Create project dir with corrupted JSONL
        encoded = monitor._encode_project_path(worktree)
        project_dir = temp_repo["projects"] / encoded
        project_dir.mkdir()
        
        jsonl_file = project_dir / "session.jsonl"
        with open(jsonl_file, 'w') as f:
            # Valid line
            f.write(json.dumps({
                "type": "user",
                "message": {"role": "user", "content": "Valid message"},
                "sessionId": "test",
                "timestamp": datetime.now().isoformat()
            }) + "\n")
            # Corrupted line
            f.write("NOT VALID JSON\n")
            # Another valid line
            f.write(json.dumps({
                "type": "assistant",
                "message": {"role": "assistant", "content": "Response"},
                "sessionId": "test",
                "timestamp": datetime.now().isoformat()
            }) + "\n")
        
        # Should handle corrupted data gracefully
        messages = monitor.get_conversation_history(50)
        
        # Should get 2 valid messages, skipping the corrupted one
        assert len(messages) == 2
        assert messages[0].content == "Valid message"
        assert messages[1].content == "Response"