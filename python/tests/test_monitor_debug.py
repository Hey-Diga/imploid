#!/usr/bin/env python3
"""Debug why messages aren't showing."""

from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent))

from claude_monitor import ClaudeMonitor

# Create monitor
monitor = ClaudeMonitor(".")

# Get instances from orchestrator state
instances = monitor.get_instances_from_orchestrator_state()

for instance in instances:
    print(f"\nIssue #{instance.issue_number}:")
    print(f"  Repo: {instance.repo_path}")
    print(f"  Branch: {instance.branch}")
    print(f"  Session ID: {instance.session_id}")
    
    # Check encoded path
    encoded = monitor._encode_project_path(instance.repo_path)
    print(f"  Encoded path: {encoded}")
    
    # Check project dir
    project_dir = monitor.projects_dir / encoded
    print(f"  Project dir: {project_dir}")
    print(f"  Project dir exists: {project_dir.exists()}")
    
    if project_dir.exists():
        # List files
        files = list(project_dir.glob("*.jsonl"))
        print(f"  JSONL files: {[f.name for f in files]}")
        
        # Try to read messages
        messages = monitor._read_jsonl_messages(project_dir, instance.session_id)
        print(f"  Messages found: {len(messages)}")
        
        if messages:
            print(f"  First message: {messages[0].content[:100]}...")
    
    print(f"  Instance.messages: {len(instance.messages)}")
    print(f"  Instance.message_count: {instance.message_count}")