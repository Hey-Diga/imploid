#!/usr/bin/env python3
"""
Data models for the GitHub Issue Orchestrator.

This module contains all the data classes, enums, and model definitions
used throughout the orchestrator system.
"""

import json
from dataclasses import dataclass, asdict, field
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Any


class ProcessStatus(Enum):
    """Status of issue processing"""
    PENDING = "pending"
    RUNNING = "running"
    NEEDS_INPUT = "needs_input"
    COMPLETED = "completed"
    FAILED = "failed"


class InstanceStatus(Enum):
    """Status of a Claude Code instance."""
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    UNKNOWN = "unknown"
    TIMEOUT = "timeout"


@dataclass
class IssueState:
    """State tracking for an issue being processed"""
    issue_number: int
    status: str
    session_id: Optional[str]
    branch: str
    start_time: str
    agent_index: Optional[int] = None
    repo_name: Optional[str] = None  # Track which repo this issue belongs to
    end_time: Optional[str] = None
    last_output: Optional[str] = None
    error: Optional[str] = None
    
    def to_dict(self) -> Dict:
        """Convert to dictionary for JSON serialization"""
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class Message:
    """Represents a message in a Claude conversation."""
    role: str
    content: str
    timestamp: datetime
    session_id: str
    type: str = "message"
    
    @classmethod
    def from_jsonl(cls, line: str) -> "Message":
        """Parse a message from JSONL format."""
        data = json.loads(line)
        timestamp = datetime.fromisoformat(data["timestamp"].replace("Z", "+00:00"))
        
        # Handle content that might be a string or list of content blocks
        content = data["message"]["content"]
        if isinstance(content, list):
            # Extract text from content blocks
            text_parts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text_parts.append(block.get("text", ""))
            content = " ".join(text_parts)
        
        return cls(
            role=data["message"]["role"],
            content=content,
            timestamp=timestamp,
            session_id=data["sessionId"],
            type=data.get("type", "message")
        )


@dataclass
class ClaudeInstance:
    """Represents a Claude Code instance processing an issue."""
    issue_number: int
    repo_path: str
    branch: str
    pid: Optional[int] = None
    status: InstanceStatus = InstanceStatus.UNKNOWN
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    runtime_seconds: Optional[float] = None
    message_count: int = 0
    last_activity: Optional[datetime] = None
    command_line: str = ""
    session_id: Optional[str] = None
    messages: List[Message] = field(default_factory=list)


@dataclass
class MonitorReport:
    """Comprehensive monitoring report for all Claude instances."""
    active_instances: List[ClaudeInstance] = field(default_factory=list)
    completed_instances: List[ClaudeInstance] = field(default_factory=list)
    total_instances: int = 0
    timestamp: datetime = field(default_factory=datetime.now)
    
    def to_dict(self) -> Dict:
        """Convert report to dictionary format."""
        return {
            "timestamp": self.timestamp.isoformat(),
            "total_instances": self.total_instances,
            "active_count": len(self.active_instances),
            "completed_count": len(self.completed_instances),
            "active_instances": [
                {
                    "issue_number": inst.issue_number,
                    "repo_path": inst.repo_path,
                    "branch": inst.branch,
                    "pid": inst.pid,
                    "status": inst.status.value,
                    "runtime_seconds": inst.runtime_seconds,
                    "message_count": inst.message_count,
                    "last_activity": inst.last_activity.isoformat() if inst.last_activity else None,
                    "session_id": inst.session_id
                }
                for inst in self.active_instances
            ],
            "completed_instances": [
                {
                    "issue_number": inst.issue_number,
                    "repo_path": inst.repo_path,
                    "branch": inst.branch,
                    "status": inst.status.value,
                    "runtime_seconds": inst.runtime_seconds,
                    "message_count": inst.message_count,
                    "session_id": inst.session_id
                }
                for inst in self.completed_instances
            ]
        }
    
    def to_text(self) -> str:
        """Convert report to human-readable text format."""
        lines = [
            f"Claude Code Instance Monitor Report",
            f"Generated: {self.timestamp.strftime('%Y-%m-%d %H:%M:%S')}",
            f"=" * 60,
            f"Total Instances: {self.total_instances}",
            f"Active: {len(self.active_instances)}",
            f"Completed: {len(self.completed_instances)}",
            "",
        ]
        
        if self.active_instances:
            lines.append("ACTIVE INSTANCES:")
            lines.append("-" * 40)
            for inst in self.active_instances:
                runtime = f"{inst.runtime_seconds:.1f}s" if inst.runtime_seconds else "N/A"
                lines.append(f"  Issue #{inst.issue_number}:")
                lines.append(f"    PID: {inst.pid or 'N/A'}")
                lines.append(f"    Status: {inst.status.value}")
                lines.append(f"    Runtime: {runtime}")
                lines.append(f"    Messages: {inst.message_count}")
                if inst.last_activity:
                    lines.append(f"    Last Activity: {inst.last_activity.strftime('%H:%M:%S')}")
                lines.append("")
        
        if self.completed_instances:
            lines.append("COMPLETED INSTANCES:")
            lines.append("-" * 40)
            for inst in self.completed_instances:
                runtime = f"{inst.runtime_seconds:.1f}s" if inst.runtime_seconds else "N/A"
                lines.append(f"  Issue #{inst.issue_number}:")
                lines.append(f"    Status: {inst.status.value}")
                lines.append(f"    Runtime: {runtime}")
                lines.append(f"    Messages: {inst.message_count}")
                lines.append("")
        
        return "\n".join(lines)

