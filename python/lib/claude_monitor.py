#!/usr/bin/env python3
"""
Monitor Claude Code instances for the issue orchestrator.

This module provides monitoring capabilities for Claude Code instances that are
processing GitHub issues in git branches. It combines process monitoring with
filesystem-based conversation history to provide comprehensive status tracking.
"""

import json
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Union

try:
    import psutil
except ImportError:
    psutil = None
    print("Warning: psutil not installed. Process monitoring will be limited.")

from .models import Message, ClaudeInstance, MonitorReport, InstanceStatus


class ClaudeMonitor:
    """Monitor Claude Code instances for the issue orchestrator."""
    
    def __init__(self, repo_path: str, output_format: str = "text"):
        """
        Initialize the Claude monitor.
        
        Args:
            repo_path: Base repository path
            output_format: Output format ("text" or "json")
        """
        self.repo_path = Path(repo_path).resolve()
        self.output_format = output_format
        self.claude_home = Path.home() / ".claude"
        self.projects_dir = self.claude_home / "projects"
        # State file should be in the orchestrator directory
        script_dir = Path(__file__).parent.parent.resolve()
        self.state_file = script_dir / "processing-state.json"
        
    def _read_orchestrator_state(self) -> Dict[int, Dict]:
        """
        Read the orchestrator's processing state file.
        
        Returns:
            Dictionary mapping issue numbers to their state data
        """
        if not self.state_file.exists():
            return {}
        
        try:
            with open(self.state_file, 'r') as f:
                data = json.load(f)
                # Convert string keys to integers
                return {int(k): v for k, v in data.items()}
        except (json.JSONDecodeError, ValueError, IOError):
            return {}
    
    def _encode_project_path(self, path: Path) -> str:
        """
        Encode a worktree path to match Claude's project directory naming.
        
        Claude encodes paths by replacing /\\:. with -
        """
        path_str = str(path.resolve())
        encoded = re.sub(r'[/\\:.]', '-', path_str)
        # Claude keeps the leading dash, don't remove it
        return encoded
    
    def _get_issue_number_from_branch(self, branch_name: str) -> Optional[int]:
        """Extract issue number from branch name."""
        match = re.search(r'issue-(\d+)$', branch_name)
        if match:
            return int(match.group(1))
        return None
    
    def _get_process_info(self, repo_path: Path) -> Optional[Dict]:
        """
        Get process information for a Claude instance in a repository.
        
        Returns dict with pid, create_time, cmdline if found, None otherwise.
        """
        if psutil:
            # Use psutil for cross-platform process monitoring
            for proc in psutil.process_iter(['pid', 'create_time', 'cmdline', 'cwd']):
                try:
                    cmdline = ' '.join(proc.info['cmdline'] or [])
                    # Check if this is a Claude process for our repo
                    if 'claude' in cmdline.lower() and str(repo_path) in cmdline:
                        return {
                            'pid': proc.info['pid'],
                            'create_time': datetime.fromtimestamp(proc.info['create_time']),
                            'cmdline': cmdline
                        }
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
        else:
            # Fallback to ps command
            try:
                result = subprocess.run(
                    ['ps', 'aux'],
                    capture_output=True,
                    text=True,
                    check=False
                )
                for line in result.stdout.splitlines():
                    if 'claude' in line.lower() and str(repo_path) in line:
                        parts = line.split(None, 10)
                        if len(parts) > 10:
                            return {
                                'pid': int(parts[1]),
                                'create_time': None,
                                'cmdline': parts[10]
                            }
            except (subprocess.SubprocessError, ValueError):
                pass
        
        return None
    
    def _read_jsonl_messages(self, project_dir: Path, session_id: Optional[str] = None) -> List[Message]:
        """Read all messages from JSONL files in a project directory.
        
        Args:
            project_dir: Directory containing JSONL files
            session_id: If provided, only read from file with this session_id in name
        """
        messages = []
        
        if not project_dir.exists():
            return messages
        
        # Find JSONL files - if session_id provided, look for specific file
        if session_id:
            # Claude stores files with session_id in the filename
            jsonl_files = list(project_dir.glob(f"{session_id}.jsonl"))
            if not jsonl_files:
                # Fallback to all JSONL files if specific session not found
                jsonl_files = list(project_dir.glob("*.jsonl"))
        else:
            jsonl_files = list(project_dir.glob("*.jsonl"))
        
        for jsonl_file in jsonl_files:
            try:
                with open(jsonl_file, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            try:
                                msg = Message.from_jsonl(line)
                                # If session_id specified, filter messages
                                if not session_id or msg.session_id == session_id:
                                    messages.append(msg)
                            except (json.JSONDecodeError, KeyError) as e:
                                # Skip malformed lines
                                continue
            except (OSError, IOError):
                continue
        
        # Sort by timestamp
        messages.sort(key=lambda m: m.timestamp)
        return messages
    
    def get_active_instances(self) -> List[ClaudeInstance]:
        """
        Find all running Claude Code processes.
        
        Returns list of ClaudeInstance objects for active processes.
        """
        active_instances = []
        
        # Read orchestrator state to get active issues
        orchestrator_states = self._read_orchestrator_state()
        
        for issue_number, state_data in orchestrator_states.items():
            # Only check issues that are currently running
            if state_data.get('status') in ['running', 'needs_input']:
                # Get repo path and branch from state
                agent_index = state_data.get('agent_index')
                if agent_index is not None:
                    # Calculate repo path based on agent index
                    repo_name = self.repo_path.name
                    repo_path = self.repo_path.parent / f"{repo_name}_agent_{agent_index}"
                else:
                    # Fallback to main repo path
                    repo_path = self.repo_path
                
                branch = state_data.get('branch', f'issue-{issue_number}')
                
                # Check for running process
                proc_info = self._get_process_info(repo_path)
                
                if proc_info:
                    instance = ClaudeInstance(
                        issue_number=issue_number,
                        repo_path=str(repo_path),
                        branch=branch,
                        pid=proc_info['pid'],
                        status=InstanceStatus.RUNNING,
                        start_time=proc_info.get('create_time'),
                        command_line=proc_info.get('cmdline', ''),
                        session_id=state_data.get('session_id')
                    )
                    
                    # Calculate runtime
                    if instance.start_time:
                        instance.runtime_seconds = (datetime.now() - instance.start_time).total_seconds()
                    
                    # Get message count and last activity from filesystem
                    encoded_path = self._encode_project_path(repo_path)
                    project_dir = self.projects_dir / encoded_path
                    messages = self._read_jsonl_messages(project_dir)
                    
                    if messages:
                        instance.message_count = len(messages)
                        instance.last_activity = messages[-1].timestamp
                        if not instance.session_id:
                            instance.session_id = messages[0].session_id
                    
                    active_instances.append(instance)
        
        return active_instances
    
    def get_conversation_history(self, issue_or_repo: Union[str, int, Path], session_id: Optional[str] = None) -> List[Message]:
        """
        Get conversation history for a specific issue or repository.
        
        Args:
            issue_or_repo: Issue number, repo path, or repo name
            session_id: Optional session_id to filter messages
            
        Returns:
            List of Message objects in chronological order
        """
        # Determine the repo path
        if isinstance(issue_or_repo, int):
            # Check orchestrator state first for actual repo path
            orchestrator_states = self._read_orchestrator_state()
            if issue_or_repo in orchestrator_states:
                state_data = orchestrator_states[issue_or_repo]
                agent_index = state_data.get('agent_index')
                if agent_index is not None:
                    # Calculate repo path based on agent index
                    repo_name = self.repo_path.name
                    repo_path = self.repo_path.parent / f"{repo_name}_agent_{agent_index}"
                else:
                    # Fallback to main repo path
                    repo_path = self.repo_path
                # Also get session_id from state if not provided
                if not session_id and state_data.get('session_id'):
                    session_id = state_data['session_id']
            else:
                repo_path = self.repo_path
        elif isinstance(issue_or_repo, Path):
            repo_path = issue_or_repo
        else:
            # String - could be issue number or path
            if issue_or_repo.isdigit():
                issue_num = int(issue_or_repo)
                # Check orchestrator state first
                orchestrator_states = self._read_orchestrator_state()
                if issue_num in orchestrator_states:
                    state_data = orchestrator_states[issue_num]
                    agent_index = state_data.get('agent_index')
                    if agent_index is not None:
                        # Calculate repo path based on agent index
                        repo_name = self.repo_path.name
                        repo_path = self.repo_path.parent / f"{repo_name}_agent_{agent_index}"
                    else:
                        repo_path = self.repo_path
                    # Also get session_id from state if not provided
                    if not session_id and state_data.get('session_id'):
                        session_id = state_data['session_id']
                else:
                    repo_path = self.repo_path
            else:
                repo_path = Path(issue_or_repo)
        
        # Encode the path and find the project directory
        encoded_path = self._encode_project_path(repo_path)
        project_dir = self.projects_dir / encoded_path
        
        return self._read_jsonl_messages(project_dir, session_id)
    
    def get_instance_status(self, issue_number: int) -> Optional[ClaudeInstance]:
        """
        Get comprehensive status for a specific issue.
        
        Combines process and filesystem data to provide full status.
        """
        # Check orchestrator state first for actual repo path
        orchestrator_states = self._read_orchestrator_state()
        session_id = None
        
        if issue_number in orchestrator_states:
            state_data = orchestrator_states[issue_number]
            agent_index = state_data.get('agent_index')
            if agent_index is not None:
                # Calculate repo path based on agent index
                repo_name = self.repo_path.name
                repo_path = self.repo_path.parent / f"{repo_name}_agent_{agent_index}"
            else:
                repo_path = self.repo_path
            session_id = state_data.get('session_id')
        else:
            repo_path = self.repo_path
        
        if not repo_path.exists():
            return None
        
        branch = f"issue-{issue_number}"
        instance = ClaudeInstance(
            issue_number=issue_number,
            repo_path=str(repo_path),
            branch=branch,
            session_id=session_id
        )
        
        # Check for running process
        proc_info = self._get_process_info(repo_path)
        
        if proc_info:
            instance.pid = proc_info['pid']
            instance.status = InstanceStatus.RUNNING
            instance.start_time = proc_info.get('create_time')
            instance.command_line = proc_info.get('cmdline', '')
            
            if instance.start_time:
                instance.runtime_seconds = (datetime.now() - instance.start_time).total_seconds()
        
        # Get conversation history (session_id will be used from orchestrator state if available)
        messages = self.get_conversation_history(issue_number, session_id)
        
        if messages:
            instance.message_count = len(messages)
            if not instance.session_id:
                instance.session_id = messages[0].session_id
            
            # Determine timestamps
            if not instance.start_time:
                instance.start_time = messages[0].timestamp
            
            instance.last_activity = messages[-1].timestamp
            
            # If no process running, determine if completed or failed
            if not proc_info:
                # Check if last message indicates completion
                last_content = messages[-1].content.lower()
                if "error" in last_content or "failed" in last_content:
                    instance.status = InstanceStatus.FAILED
                elif messages[-1].role == "assistant":
                    # Assume completed if last message was from assistant
                    instance.status = InstanceStatus.COMPLETED
                    instance.end_time = messages[-1].timestamp
                else:
                    instance.status = InstanceStatus.UNKNOWN
                
                # Calculate runtime from messages
                if instance.start_time and instance.end_time:
                    instance.runtime_seconds = (instance.end_time - instance.start_time).total_seconds()
                elif instance.start_time and instance.last_activity:
                    instance.runtime_seconds = (instance.last_activity - instance.start_time).total_seconds()
        
        return instance
    
    def get_instances_from_orchestrator_state(self) -> List[ClaudeInstance]:
        """
        Get Claude instances based on orchestrator's state file.
        
        Returns:
            List of ClaudeInstance objects from orchestrator state
        """
        instances = []
        orchestrator_states = self._read_orchestrator_state()
        
        for issue_number, state_data in orchestrator_states.items():
            # Check if this issue is actively being processed
            if state_data.get('status') in ['running', 'needs_input']:
                # Get repo path and branch from state
                agent_index = state_data.get('agent_index')
                if agent_index is not None:
                    # Calculate repo path based on agent index
                    repo_name = self.repo_path.name
                    repo_path = self.repo_path.parent / f"{repo_name}_agent_{agent_index}"
                else:
                    # Fallback to main repo path
                    repo_path = self.repo_path
                
                branch = state_data.get('branch', f'issue-{issue_number}')
                
                instance = ClaudeInstance(
                    issue_number=issue_number,
                    repo_path=str(repo_path),
                    branch=branch,
                    session_id=state_data.get('session_id')
                )
                
                # Map orchestrator status to our status
                if state_data['status'] == 'running':
                    instance.status = InstanceStatus.RUNNING
                elif state_data['status'] == 'needs_input':
                    instance.status = InstanceStatus.RUNNING  # Still running, just needs input
                    
                # Parse timestamps
                if state_data.get('start_time'):
                    try:
                        instance.start_time = datetime.fromisoformat(state_data['start_time'])
                        instance.runtime_seconds = (datetime.now() - instance.start_time).total_seconds()
                    except (ValueError, TypeError):
                        pass
                
                # Check for actual process
                proc_info = self._get_process_info(repo_path)
                if proc_info:
                    instance.pid = proc_info['pid']
                    instance.command_line = proc_info.get('cmdline', '')
                
                # Get messages using session_id if available
                encoded_path = self._encode_project_path(repo_path)
                project_dir = self.projects_dir / encoded_path
                
                # Use session_id to find the right JSONL file
                messages = self._read_jsonl_messages(project_dir, instance.session_id)
                if messages:
                    instance.messages = messages
                    instance.message_count = len(messages)
                    instance.last_activity = messages[-1].timestamp
                
                instances.append(instance)
        
        return instances
    
    def monitor_all(self) -> MonitorReport:
        """
        Get comprehensive monitoring report for all Claude instances.
        
        Returns MonitorReport with active and completed instances.
        """
        report = MonitorReport()
        
        # Get active instances from process monitoring
        active_instances = self.get_active_instances()
        active_issue_numbers = {inst.issue_number for inst in active_instances}
        
        # Check orchestrator state for completed instances
        orchestrator_states = self._read_orchestrator_state()
        for issue_number, state_data in orchestrator_states.items():
            if issue_number not in active_issue_numbers:
                # Check if this issue has completed status
                if state_data.get('status') in ['completed', 'failed']:
                    # Get repo path and branch from state
                    agent_index = state_data.get('agent_index')
                    if agent_index is not None:
                        # Calculate repo path based on agent index
                        repo_name = self.repo_path.name
                        repo_path = self.repo_path.parent / f"{repo_name}_agent_{agent_index}"
                    else:
                        repo_path = self.repo_path
                    
                    branch = state_data.get('branch', f'issue-{issue_number}')
                    
                    instance = ClaudeInstance(
                        issue_number=issue_number,
                        repo_path=str(repo_path),
                        branch=branch,
                        session_id=state_data.get('session_id')
                    )
                    
                    # Map status
                    if state_data['status'] == 'completed':
                        instance.status = InstanceStatus.COMPLETED
                    elif state_data['status'] == 'failed':
                        instance.status = InstanceStatus.FAILED
                    
                    # Parse timestamps
                    if state_data.get('start_time'):
                        try:
                            instance.start_time = datetime.fromisoformat(state_data['start_time'])
                        except (ValueError, TypeError):
                            pass
                    
                    if state_data.get('end_time'):
                        try:
                            instance.end_time = datetime.fromisoformat(state_data['end_time'])
                        except (ValueError, TypeError):
                            pass
                    
                    # Calculate runtime
                    if instance.start_time and instance.end_time:
                        instance.runtime_seconds = (instance.end_time - instance.start_time).total_seconds()
                    elif instance.start_time:
                        instance.runtime_seconds = (datetime.now() - instance.start_time).total_seconds()
                    
                    # Get message count
                    messages = self.get_conversation_history(issue_number, instance.session_id)
                    if messages:
                        instance.message_count = len(messages)
                        instance.last_activity = messages[-1].timestamp
                    
                    report.completed_instances.append(instance)
        
        report.active_instances = active_instances
        report.total_instances = len(report.active_instances) + len(report.completed_instances)
        
        return report
    
    def format_output(self, data: Union[MonitorReport, List[Message], ClaudeInstance]) -> str:
        """
        Format output based on configured format.
        
        Args:
            data: Data to format (report, messages, or instance)
            
        Returns:
            Formatted string output
        """
        if self.output_format == "json":
            if isinstance(data, MonitorReport):
                return json.dumps(data.to_dict(), indent=2)
            elif isinstance(data, list) and all(isinstance(m, Message) for m in data):
                # Format messages as JSON
                messages_dict = [
                    {
                        "role": m.role,
                        "content": m.content,
                        "timestamp": m.timestamp.isoformat(),
                        "session_id": m.session_id,
                    }
                    for m in data
                ]
                return json.dumps(messages_dict, indent=2)
            elif isinstance(data, ClaudeInstance):
                # Format instance as JSON
                instance_dict = {
                    "issue_number": data.issue_number,
                    "repo_path": data.repo_path,
                    "pid": data.pid,
                    "status": data.status.value,
                    "start_time": data.start_time.isoformat() if data.start_time else None,
                    "end_time": data.end_time.isoformat() if data.end_time else None,
                    "runtime_seconds": data.runtime_seconds,
                    "message_count": data.message_count,
                    "last_activity": data.last_activity.isoformat() if data.last_activity else None,
                }
                return json.dumps(instance_dict, indent=2)
        else:
            # Text format
            if isinstance(data, MonitorReport):
                return data.to_text()
            elif isinstance(data, list) and all(isinstance(m, Message) for m in data):
                # Format messages as text
                lines = []
                for m in data:
                    timestamp = m.timestamp.strftime("%H:%M:%S")
                    role = m.role.upper()
                    lines.append(f"[{timestamp}] {role}:")
                    lines.append(f"  {m.content[:200]}..." if len(m.content) > 200 else f"  {m.content}")
                    lines.append("")
                return "\n".join(lines)
            elif isinstance(data, ClaudeInstance):
                # Format instance as text
                lines = [
                    f"Issue #{data.issue_number}",
                    f"  Status: {data.status.value}",
                    f"  Repo: {data.repo_path}",
                    f"  Branch: {data.branch}",
                ]
                if data.pid:
                    lines.append(f"  PID: {data.pid}")
                if data.runtime_seconds:
                    lines.append(f"  Runtime: {data.runtime_seconds:.1f}s")
                if data.message_count:
                    lines.append(f"  Messages: {data.message_count}")
                if data.last_activity:
                    lines.append(f"  Last Activity: {data.last_activity.strftime('%Y-%m-%d %H:%M:%S')}")
                
                # Include conversation messages if available
                if data.messages:
                    lines.append("\n  Conversation:")
                    lines.append("  " + "-" * 40)
                    # Show last 5 messages or all if less than 5
                    recent_messages = data.messages[-5:] if len(data.messages) > 5 else data.messages
                    if len(data.messages) > 5:
                        lines.append(f"  (Showing last 5 of {len(data.messages)} messages)")
                    
                    for msg in recent_messages:
                        timestamp = msg.timestamp.strftime("%H:%M:%S")
                        role = "USER" if msg.role == "user" else "CLAUDE"
                        # Truncate long messages
                        content = msg.content[:200] + "..." if len(msg.content) > 200 else msg.content
                        # Replace newlines for cleaner display
                        content = content.replace('\n', ' ')
                        lines.append(f"  [{timestamp}] {role}: {content}")
                
                return "\n".join(lines)
        
        return str(data)


def main():
    """Command-line interface for the Claude monitor."""
    import argparse
    import sys
    
    parser = argparse.ArgumentParser(
        description="Monitor Claude Code instances for the issue orchestrator"
    )
    parser.add_argument(
        "command",
        choices=["status", "history", "monitor"],
        nargs='?',  # Make command optional
        help="Command to execute (if omitted, shows current work or recent history)"
    )
    parser.add_argument(
        "--repo",
        default=".",
        help="Repository path (default: current directory)"
    )
    parser.add_argument(
        "--issue",
        type=int,
        help="Issue number for status or history commands"
    )
    parser.add_argument(
        "--format",
        choices=["text", "json"],
        default="text",
        help="Output format (default: text)"
    )
    
    args = parser.parse_args()
    
    # If no command provided, show orchestrator state or history
    if args.command is None:
        monitor = ClaudeMonitor(args.repo, args.format)
        
        # First check orchestrator state for active work
        active_instances = monitor.get_instances_from_orchestrator_state()
        
        if active_instances:
            # Show active work from orchestrator state
            print("Active Claude Code instances (from orchestrator state):")
            print("=" * 60)
            for instance in active_instances:
                print(monitor.format_output(instance))
                print()
        else:
            # No active work, show recent history
            print("No active instances. Recent completed work:")
            print("=" * 60)
            
            # Get all completed instances
            report = monitor.monitor_all()
            if report.completed_instances:
                # Show the most recent completed instances (up to 5)
                recent = sorted(
                    report.completed_instances,
                    key=lambda x: x.end_time or x.last_activity or datetime.min,
                    reverse=True
                )[:5]
                
                for instance in recent:
                    print(monitor.format_output(instance))
                    print()
            else:
                print("No recent completed work found.")
        
        return
    
    monitor = ClaudeMonitor(args.repo, args.format)
    
    if args.command == "status":
        if args.issue:
            instance = monitor.get_instance_status(args.issue)
            if instance:
                print(monitor.format_output(instance))
            else:
                print(f"No instance found for issue #{args.issue}")
        else:
            # Show all active instances
            instances = monitor.get_active_instances()
            for instance in instances:
                print(monitor.format_output(instance))
                print()
    
    elif args.command == "history":
        if not args.issue:
            print("Error: --issue required for history command")
            return
        
        messages = monitor.get_conversation_history(args.issue)
        if messages:
            print(monitor.format_output(messages))
        else:
            print(f"No conversation history found for issue #{args.issue}")
    
    elif args.command == "monitor":
        report = monitor.monitor_all()
        print(monitor.format_output(report))


if __name__ == "__main__":
    main()