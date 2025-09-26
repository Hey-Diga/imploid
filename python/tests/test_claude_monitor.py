#!/usr/bin/env python3
"""
Unit tests for the Claude monitor module.
"""

import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from claude_monitor import (
    ClaudeInstance,
    ClaudeMonitor,
    InstanceStatus,
    Message,
    MonitorReport,
)


class TestMessage(unittest.TestCase):
    """Test the Message class."""
    
    def test_from_jsonl(self):
        """Test parsing a message from JSONL format."""
        jsonl_line = json.dumps({
            "type": "user",
            "message": {
                "role": "user",
                "content": "Test message"
            },
            "sessionId": "test-session-123",
            "timestamp": "2024-01-15T10:30:00Z"
        })
        
        message = Message.from_jsonl(jsonl_line)
        
        self.assertEqual(message.role, "user")
        self.assertEqual(message.content, "Test message")
        self.assertEqual(message.session_id, "test-session-123")
        self.assertEqual(message.type, "user")
        self.assertIsInstance(message.timestamp, datetime)
    
    def test_from_jsonl_with_malformed_data(self):
        """Test that malformed JSONL raises appropriate errors."""
        with self.assertRaises(json.JSONDecodeError):
            Message.from_jsonl("not valid json")
        
        with self.assertRaises(KeyError):
            Message.from_jsonl(json.dumps({"invalid": "data"}))


class TestClaudeInstance(unittest.TestCase):
    """Test the ClaudeInstance dataclass."""
    
    def test_instance_creation(self):
        """Test creating a ClaudeInstance."""
        instance = ClaudeInstance(
            issue_number=42,
            worktree_path=Path("/test/worktree"),
            pid=1234,
            status=InstanceStatus.RUNNING
        )
        
        self.assertEqual(instance.issue_number, 42)
        self.assertEqual(instance.worktree_path, Path("/test/worktree"))
        self.assertEqual(instance.pid, 1234)
        self.assertEqual(instance.status, InstanceStatus.RUNNING)
        self.assertEqual(instance.message_count, 0)


class TestMonitorReport(unittest.TestCase):
    """Test the MonitorReport class."""
    
    def test_to_dict(self):
        """Test converting report to dictionary."""
        report = MonitorReport()
        instance = ClaudeInstance(
            issue_number=1,
            worktree_path=Path("/test"),
            status=InstanceStatus.RUNNING,
            start_time=datetime.now()
        )
        report.active_instances.append(instance)
        report.total_instances = 1
        
        result = report.to_dict()
        
        self.assertIn("timestamp", result)
        self.assertEqual(result["total_instances"], 1)
        self.assertEqual(result["active_count"], 1)
        self.assertEqual(result["completed_count"], 0)
        self.assertEqual(len(result["active_instances"]), 1)
    
    def test_to_text(self):
        """Test converting report to text format."""
        report = MonitorReport()
        instance = ClaudeInstance(
            issue_number=1,
            worktree_path=Path("/test"),
            status=InstanceStatus.RUNNING,
            pid=1234,
            message_count=5
        )
        report.active_instances.append(instance)
        report.total_instances = 1
        
        result = report.to_text()
        
        self.assertIn("Claude Code Instance Monitor Report", result)
        self.assertIn("Total Instances: 1", result)
        self.assertIn("Issue #1:", result)
        self.assertIn("PID: 1234", result)
        self.assertIn("Messages: 5", result)


class TestClaudeMonitor(unittest.TestCase):
    """Test the ClaudeMonitor class."""
    
    def setUp(self):
        """Set up test fixtures."""
        self.temp_dir = tempfile.mkdtemp()
        self.repo_path = Path(self.temp_dir) / "repo"
        self.repo_path.mkdir()
        self.worktrees_dir = self.repo_path / ".worktrees"
        self.worktrees_dir.mkdir()
        
        # Create mock Claude home directory
        self.claude_home = Path(self.temp_dir) / ".claude"
        self.claude_home.mkdir()
        self.projects_dir = self.claude_home / "projects"
        self.projects_dir.mkdir()
        
        # Create mock state file location
        self.state_file = Path(self.temp_dir) / "processing-state.json"
        
        self.monitor = ClaudeMonitor(str(self.repo_path))
        self.monitor.claude_home = self.claude_home
        self.monitor.projects_dir = self.projects_dir
        self.monitor.state_file = self.state_file
    
    def tearDown(self):
        """Clean up test fixtures."""
        import shutil
        shutil.rmtree(self.temp_dir)
    
    def test_encode_project_path(self):
        """Test path encoding for Claude project directories."""
        path = Path("/home/user/.worktrees/issue-1")
        encoded = self.monitor._encode_project_path(path)
        
        # Should replace special characters with dashes
        self.assertNotIn("/", encoded)
        self.assertNotIn(".", encoded)
        self.assertIn("home-user", encoded)
        self.assertIn("issue-1", encoded)
    
    def test_get_issue_number_from_worktree(self):
        """Test extracting issue number from worktree path."""
        worktree = Path("/test/.worktrees/issue-42")
        issue_num = self.monitor._get_issue_number_from_worktree(worktree)
        self.assertEqual(issue_num, 42)
        
        # Test with non-issue worktree
        worktree = Path("/test/.worktrees/feature-branch")
        issue_num = self.monitor._get_issue_number_from_worktree(worktree)
        self.assertIsNone(issue_num)
    
    def test_read_jsonl_messages(self):
        """Test reading messages from JSONL files."""
        # Create a test project directory
        project_dir = self.projects_dir / "test-project"
        project_dir.mkdir()
        
        # Create a test JSONL file
        jsonl_file = project_dir / "session.jsonl"
        messages_data = [
            {
                "type": "user",
                "message": {"role": "user", "content": "First message"},
                "sessionId": "test-123",
                "timestamp": "2024-01-15T10:00:00Z"
            },
            {
                "type": "assistant",
                "message": {"role": "assistant", "content": "Response"},
                "sessionId": "test-123",
                "timestamp": "2024-01-15T10:00:05Z"
            }
        ]
        
        with open(jsonl_file, 'w') as f:
            for msg in messages_data:
                f.write(json.dumps(msg) + "\n")
        
        messages = self.monitor._read_jsonl_messages(project_dir)
        
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[0].role, "user")
        self.assertEqual(messages[0].content, "First message")
        self.assertEqual(messages[1].role, "assistant")
        self.assertEqual(messages[1].content, "Response")
    
    def test_read_jsonl_messages_empty_dir(self):
        """Test reading messages from empty directory."""
        project_dir = self.projects_dir / "empty-project"
        project_dir.mkdir()
        
        messages = self.monitor._read_jsonl_messages(project_dir)
        self.assertEqual(messages, [])
    
    def test_read_jsonl_messages_nonexistent_dir(self):
        """Test reading messages from non-existent directory."""
        project_dir = self.projects_dir / "nonexistent"
        
        messages = self.monitor._read_jsonl_messages(project_dir)
        self.assertEqual(messages, [])
    
    @patch('claude_monitor.psutil')
    def test_get_process_info_with_psutil(self, mock_psutil):
        """Test getting process info using psutil."""
        worktree_path = Path("/test/worktree")
        
        # Mock process
        mock_proc = Mock()
        mock_proc.info = {
            'pid': 1234,
            'create_time': 1705315200.0,  # Some timestamp
            'cmdline': ['claude', 'code', str(worktree_path)],
            'cwd': str(worktree_path)
        }
        
        mock_psutil.process_iter.return_value = [mock_proc]
        
        result = self.monitor._get_process_info(worktree_path)
        
        self.assertIsNotNone(result)
        self.assertEqual(result['pid'], 1234)
        self.assertIn('claude', result['cmdline'])
        self.assertIn(str(worktree_path), result['cmdline'])
    
    @patch('claude_monitor.psutil', None)
    @patch('subprocess.run')
    def test_get_process_info_fallback(self, mock_run):
        """Test getting process info using ps command fallback."""
        worktree_path = Path("/test/worktree")
        
        # Mock ps output
        mock_run.return_value = Mock(
            stdout=f"user 1234 0.0 0.1 123456 7890 pts/0 S+ 10:00 0:00 claude code {worktree_path}",
            returncode=0
        )
        
        result = self.monitor._get_process_info(worktree_path)
        
        self.assertIsNotNone(result)
        self.assertEqual(result['pid'], 1234)
        self.assertIn('claude', result['cmdline'])
    
    def test_get_conversation_history_by_issue_number(self):
        """Test getting conversation history by issue number."""
        # Create worktree
        worktree = self.worktrees_dir / "issue-10"
        worktree.mkdir()
        
        # Create project directory with messages
        encoded = self.monitor._encode_project_path(worktree)
        project_dir = self.projects_dir / encoded
        project_dir.mkdir()
        
        # Add test message
        jsonl_file = project_dir / "session.jsonl"
        message_data = {
            "type": "user",
            "message": {"role": "user", "content": "Test for issue 10"},
            "sessionId": "test-10",
            "timestamp": "2024-01-15T10:00:00Z"
        }
        
        with open(jsonl_file, 'w') as f:
            f.write(json.dumps(message_data) + "\n")
        
        # Test by issue number
        messages = self.monitor.get_conversation_history(10)
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0].content, "Test for issue 10")
        
        # Test by string issue number
        messages = self.monitor.get_conversation_history("10")
        self.assertEqual(len(messages), 1)
        
        # Test by path
        messages = self.monitor.get_conversation_history(worktree)
        self.assertEqual(len(messages), 1)
    
    @patch.object(ClaudeMonitor, '_get_process_info')
    def test_get_instance_status_running(self, mock_get_process):
        """Test getting status for a running instance."""
        # Create worktree
        worktree = self.worktrees_dir / "issue-20"
        worktree.mkdir()
        
        # Mock running process
        mock_get_process.return_value = {
            'pid': 5678,
            'create_time': datetime.now() - timedelta(minutes=5),
            'cmdline': 'claude code /test/issue-20'
        }
        
        status = self.monitor.get_instance_status(20)
        
        self.assertIsNotNone(status)
        self.assertEqual(status.issue_number, 20)
        self.assertEqual(status.pid, 5678)
        self.assertEqual(status.status, InstanceStatus.RUNNING)
        self.assertIsNotNone(status.runtime_seconds)
    
    @patch.object(ClaudeMonitor, '_get_process_info')
    def test_get_instance_status_completed(self, mock_get_process):
        """Test getting status for a completed instance."""
        # Create worktree
        worktree = self.worktrees_dir / "issue-30"
        worktree.mkdir()
        
        # No running process
        mock_get_process.return_value = None
        
        # Create project directory with messages
        encoded = self.monitor._encode_project_path(worktree)
        project_dir = self.projects_dir / encoded
        project_dir.mkdir()
        
        # Add messages indicating completion
        jsonl_file = project_dir / "session.jsonl"
        messages_data = [
            {
                "type": "user",
                "message": {"role": "user", "content": "Fix the bug"},
                "sessionId": "test-30",
                "timestamp": "2024-01-15T10:00:00Z"
            },
            {
                "type": "assistant",
                "message": {"role": "assistant", "content": "Bug fixed successfully"},
                "sessionId": "test-30",
                "timestamp": "2024-01-15T10:05:00Z"
            }
        ]
        
        with open(jsonl_file, 'w') as f:
            for msg in messages_data:
                f.write(json.dumps(msg) + "\n")
        
        status = self.monitor.get_instance_status(30)
        
        self.assertIsNotNone(status)
        self.assertEqual(status.issue_number, 30)
        self.assertIsNone(status.pid)
        self.assertEqual(status.status, InstanceStatus.COMPLETED)
        self.assertEqual(status.message_count, 2)
    
    @patch.object(ClaudeMonitor, 'get_active_instances')
    @patch.object(ClaudeMonitor, 'get_instance_status')
    def test_monitor_all(self, mock_get_status, mock_get_active):
        """Test getting comprehensive monitoring report."""
        # Mock active instance
        active_instance = ClaudeInstance(
            issue_number=1,
            worktree_path=Path("/test/issue-1"),
            pid=1111,
            status=InstanceStatus.RUNNING
        )
        mock_get_active.return_value = [active_instance]
        
        # Create completed worktree
        completed_worktree = self.worktrees_dir / "issue-2"
        completed_worktree.mkdir()
        
        # Mock completed instance
        completed_instance = ClaudeInstance(
            issue_number=2,
            worktree_path=completed_worktree,
            status=InstanceStatus.COMPLETED,
            message_count=10
        )
        mock_get_status.return_value = completed_instance
        
        report = self.monitor.monitor_all()
        
        self.assertEqual(len(report.active_instances), 1)
        self.assertEqual(len(report.completed_instances), 1)
        self.assertEqual(report.total_instances, 2)
        self.assertEqual(report.active_instances[0].issue_number, 1)
        self.assertEqual(report.completed_instances[0].issue_number, 2)
    
    def test_format_output_json(self):
        """Test JSON output formatting."""
        self.monitor.output_format = "json"
        
        # Test with MonitorReport
        report = MonitorReport()
        report.total_instances = 1
        json_output = self.monitor.format_output(report)
        data = json.loads(json_output)
        self.assertEqual(data["total_instances"], 1)
        
        # Test with Messages
        messages = [
            Message(
                role="user",
                content="Test",
                timestamp=datetime.now(),
                session_id="test-123"
            )
        ]
        json_output = self.monitor.format_output(messages)
        data = json.loads(json_output)
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["role"], "user")
        
        # Test with ClaudeInstance
        instance = ClaudeInstance(
            issue_number=1,
            worktree_path=Path("/test"),
            status=InstanceStatus.RUNNING
        )
        json_output = self.monitor.format_output(instance)
        data = json.loads(json_output)
        self.assertEqual(data["issue_number"], 1)
        self.assertEqual(data["status"], "running")
    
    def test_read_orchestrator_state(self):
        """Test reading orchestrator state file."""
        # Create test state file
        state_data = {
            "1": {
                "issue_number": 1,
                "status": "running",
                "session_id": "test-session-1",
                "branch": "issue-1",
                "start_time": "2024-01-15T10:00:00"
            },
            "2": {
                "issue_number": 2,
                "status": "completed",
                "session_id": "test-session-2",
                "branch": "issue-2",
                "start_time": "2024-01-15T09:00:00",
                "end_time": "2024-01-15T09:30:00"
            }
        }
        
        with open(self.state_file, 'w') as f:
            json.dump(state_data, f)
        
        # Read state
        states = self.monitor._read_orchestrator_state()
        
        self.assertEqual(len(states), 2)
        self.assertIn(1, states)
        self.assertIn(2, states)
        self.assertEqual(states[1]["status"], "running")
        self.assertEqual(states[2]["status"], "completed")
    
    def test_read_orchestrator_state_missing_file(self):
        """Test reading state when file doesn't exist."""
        # Ensure file doesn't exist
        if self.state_file.exists():
            self.state_file.unlink()
        
        states = self.monitor._read_orchestrator_state()
        self.assertEqual(states, {})
    
    def test_get_instances_from_orchestrator_state(self):
        """Test getting instances from orchestrator state."""
        # Create worktrees
        worktree1 = self.worktrees_dir / "issue-10"
        worktree1.mkdir()
        worktree2 = self.worktrees_dir / "issue-11"
        worktree2.mkdir()
        
        # Create state file
        state_data = {
            "10": {
                "issue_number": 10,
                "status": "running",
                "session_id": "session-10",
                "start_time": datetime.now().isoformat()
            },
            "11": {
                "issue_number": 11,
                "status": "needs_input",
                "session_id": "session-11",
                "start_time": (datetime.now() - timedelta(minutes=30)).isoformat()
            },
            "12": {
                "issue_number": 12,
                "status": "completed",  # Should not be included
                "session_id": "session-12"
            }
        }
        
        with open(self.state_file, 'w') as f:
            json.dump(state_data, f)
        
        # Get instances
        instances = self.monitor.get_instances_from_orchestrator_state()
        
        # Should only get running and needs_input instances
        self.assertEqual(len(instances), 2)
        issue_numbers = {inst.issue_number for inst in instances}
        self.assertEqual(issue_numbers, {10, 11})
        
        # Check instance details
        instance_10 = next(inst for inst in instances if inst.issue_number == 10)
        self.assertEqual(instance_10.status, InstanceStatus.RUNNING)
        self.assertEqual(instance_10.session_id, "session-10")
        self.assertIsNotNone(instance_10.start_time)
        
        instance_11 = next(inst for inst in instances if inst.issue_number == 11)
        self.assertEqual(instance_11.status, InstanceStatus.RUNNING)  # needs_input mapped to running
        self.assertIsNotNone(instance_11.runtime_seconds)
    
    def test_format_output_text(self):
        """Test text output formatting."""
        self.monitor.output_format = "text"
        
        # Test with MonitorReport
        report = MonitorReport()
        report.total_instances = 2
        text_output = self.monitor.format_output(report)
        self.assertIn("Total Instances: 2", text_output)
        
        # Test with Messages
        messages = [
            Message(
                role="user",
                content="Test message",
                timestamp=datetime.now(),
                session_id="test-123"
            )
        ]
        text_output = self.monitor.format_output(messages)
        self.assertIn("USER:", text_output)
        self.assertIn("Test message", text_output)
        
        # Test with ClaudeInstance
        instance = ClaudeInstance(
            issue_number=5,
            worktree_path=Path("/test"),
            status=InstanceStatus.COMPLETED,
            message_count=15
        )
        text_output = self.monitor.format_output(instance)
        self.assertIn("Issue #5", text_output)
        self.assertIn("Status: completed", text_output)
        self.assertIn("Messages: 15", text_output)


class TestMainFunction(unittest.TestCase):
    """Test the main CLI function."""
    
    @patch('sys.argv', ['claude_monitor.py'])  # No command
    @patch.object(ClaudeMonitor, 'get_instances_from_orchestrator_state')
    @patch.object(ClaudeMonitor, 'monitor_all')
    def test_main_no_command_with_active(self, mock_monitor_all, mock_get_instances):
        """Test main with no command when there are active instances."""
        # Mock active instances from orchestrator state
        mock_instance = ClaudeInstance(
            issue_number=5,
            worktree_path=Path("/test/issue-5"),
            status=InstanceStatus.RUNNING
        )
        mock_get_instances.return_value = [mock_instance]
        
        with patch('builtins.print') as mock_print:
            from claude_monitor import main
            main()
        
        mock_get_instances.assert_called_once()
        # Should show active instances, not call monitor_all
        mock_monitor_all.assert_not_called()
        # Check that output mentions active instances
        print_calls = [str(call) for call in mock_print.call_args_list]
        self.assertTrue(any("Active Claude Code instances" in str(call) for call in print_calls))
    
    @patch('sys.argv', ['claude_monitor.py'])  # No command
    @patch.object(ClaudeMonitor, 'get_instances_from_orchestrator_state')
    @patch.object(ClaudeMonitor, 'monitor_all')
    def test_main_no_command_with_history(self, mock_monitor_all, mock_get_instances):
        """Test main with no command when there are no active instances."""
        # No active instances
        mock_get_instances.return_value = []
        
        # Mock completed instances
        mock_report = MonitorReport()
        mock_report.completed_instances = [
            ClaudeInstance(
                issue_number=3,
                worktree_path=Path("/test/issue-3"),
                status=InstanceStatus.COMPLETED,
                end_time=datetime.now()
            )
        ]
        mock_monitor_all.return_value = mock_report
        
        with patch('builtins.print') as mock_print:
            from claude_monitor import main
            main()
        
        mock_get_instances.assert_called_once()
        mock_monitor_all.assert_called_once()
        # Check that output mentions recent work
        print_calls = [str(call) for call in mock_print.call_args_list]
        self.assertTrue(any("Recent completed work" in str(call) for call in print_calls))
    
    @patch('sys.argv', ['claude_monitor.py', 'monitor', '--repo', '/test'])
    @patch.object(ClaudeMonitor, 'monitor_all')
    def test_main_monitor_command(self, mock_monitor_all):
        """Test the monitor command."""
        mock_report = MonitorReport()
        mock_monitor_all.return_value = mock_report
        
        with patch('builtins.print') as mock_print:
            from claude_monitor import main
            main()
        
        mock_monitor_all.assert_called_once()
        mock_print.assert_called()
    
    @patch('sys.argv', ['claude_monitor.py', 'status', '--repo', '/test', '--issue', '10'])
    @patch.object(ClaudeMonitor, 'get_instance_status')
    def test_main_status_command_with_issue(self, mock_get_status):
        """Test the status command with specific issue."""
        mock_instance = ClaudeInstance(
            issue_number=10,
            worktree_path=Path("/test"),
            status=InstanceStatus.RUNNING
        )
        mock_get_status.return_value = mock_instance
        
        with patch('builtins.print') as mock_print:
            from claude_monitor import main
            main()
        
        mock_get_status.assert_called_with(10)
        mock_print.assert_called()
    
    @patch('sys.argv', ['claude_monitor.py', 'history', '--repo', '/test', '--issue', '5'])
    @patch.object(ClaudeMonitor, 'get_conversation_history')
    def test_main_history_command(self, mock_get_history):
        """Test the history command."""
        mock_messages = [
            Message(
                role="user",
                content="Test",
                timestamp=datetime.now(),
                session_id="test"
            )
        ]
        mock_get_history.return_value = mock_messages
        
        with patch('builtins.print') as mock_print:
            from claude_monitor import main
            main()
        
        mock_get_history.assert_called_with(5)
        mock_print.assert_called()


if __name__ == '__main__':
    unittest.main()