#!/usr/bin/env python3
"""
State management for the Issue Orchestrator.

This module handles persistent state storage and retrieval for issue processing.
"""

import json
import logging
import sys
from pathlib import Path
from typing import Dict, List, Optional

try:
    import aiofiles
    HAS_AIOFILES = True
except ImportError:
    HAS_AIOFILES = False
    logging.warning("aiofiles not installed. Using synchronous file operations.")

from .models import IssueState


class StateManager:
    """Manages persistent state of issue processing"""
    
    def __init__(self, state_file: str = "processing-state.json"):
        # Always use absolute path to ensure state file is in the orchestrator directory
        if Path(state_file).is_absolute():
            self.state_file = Path(state_file)
        else:
            # Use the script's directory as the base for relative paths
            script_dir = Path(__file__).parent.parent.resolve()
            self.state_file = script_dir / state_file
        
        self.states: Dict[int, IssueState] = {}
        self._load_states()
    
    def _load_states(self):
        """Load states from file"""
        if self.state_file.exists():
            try:
                with open(self.state_file) as f:
                    data = json.load(f)
                    for issue_num, state_data in data.items():
                        self.states[int(issue_num)] = IssueState(**state_data)
            except (json.JSONDecodeError, TypeError) as e:
                logging.error(f"Error loading state file: {e}")
                self.states = {}
    
    async def save_states(self):
        """Save states to file"""
        data = {
            str(issue_num): state.to_dict() 
            for issue_num, state in self.states.items()
        }
        
        if HAS_AIOFILES:
            async with aiofiles.open(self.state_file, 'w') as f:
                await f.write(json.dumps(data, indent=2))
                await f.flush()  # Ensure data is written to disk
        else:
            # Fallback to synchronous file operations
            with open(self.state_file, 'w') as f:
                json.dump(data, f, indent=2)
                f.flush()
    
    def get_state(self, issue_number: int) -> Optional[IssueState]:
        """Get state for an issue"""
        return self.states.get(issue_number)
    
    def set_state(self, issue_number: int, state: IssueState):
        """Set state for an issue"""
        self.states[issue_number] = state
        
    def remove_state(self, issue_number: int):
        """Remove state for an issue"""
        if issue_number in self.states:
            del self.states[issue_number]
    
    def get_active_issues(self) -> List[int]:
        """Get list of issues currently being processed"""
        return [
            issue_num for issue_num, state in self.states.items()
            if state.status in ["running", "needs_input"]
        ]
    
    def get_available_agent_index(self, max_concurrent: int) -> Optional[int]:
        """Get the next available agent index"""
        used_agents = set()
        for state in self.states.values():
            if state.status in ["running", "needs_input"]:
                if state.agent_index is not None:
                    used_agents.add(state.agent_index)
        
        # Find first available agent index
        for i in range(max_concurrent):
            if i not in used_agents:
                return i
        
        return None
    
    def get_agent_issues(self, agent_index: int) -> List[int]:
        """Get list of issues being processed by a specific agent"""
        return [
            issue_num for issue_num, state in self.states.items()
            if state.agent_index == agent_index and 
            state.status in ["running", "needs_input"]
        ]
