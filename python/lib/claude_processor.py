#!/usr/bin/env python3
"""
Claude Code process management for the Issue Orchestrator.

This module handles launching and monitoring Claude Code processes
for issue processing.
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple

from .config import Config
from .models import ProcessStatus
from .repo_manager import RepoManager
from .state_manager import StateManager
from typing import List, Union, TYPE_CHECKING

if TYPE_CHECKING:
    from .telegram_notifier import TelegramNotifier
    from .slack_notifier import SlackNotifier


class ClaudeProcessor:
    """Manages Claude Code process execution"""
    
    def __init__(self, config: Config, notifier, repo_manager: RepoManager):
        self.config = config
        self.notifier = notifier  # Can be single notifier or list of notifiers for compatibility
        self.repo_manager = repo_manager
    
    async def process_issue(
        self,
        issue_number: int,
        agent_index: int,
        state_manager: StateManager,
        repo_name: Optional[str] = None
    ) -> Tuple[ProcessStatus, Optional[str]]:
        """Process a single issue with Claude Code"""
        
        # Ensure repo clone exists for this agent with the specific repo
        repo_path = await self.repo_manager.ensure_repo_clone(agent_index, repo_name)
        
        branch_name = f"issue-{issue_number}"
        
        # Save current directory
        original_dir = os.getcwd()
        
        try:
            # Change to repo directory
            os.chdir(repo_path)
            logging.info(f"Working in repo: {repo_path}")
            
            # Check if branch exists
            result = await self._run_command(f"git show-ref --verify --quiet refs/heads/{branch_name}")
            branch_exists = result[0] == 0
            
            if branch_exists:
                # Checkout existing branch
                logging.info(f"Checking out existing branch {branch_name}")
                result = await self._run_command(f"git checkout {branch_name}")
                if result[0] != 0:
                    raise Exception(f"Failed to checkout branch: {result[2]}")
            else:
                # Create and checkout new branch
                logging.info(f"Creating and checking out new branch {branch_name}")
                result = await self._run_command(f"git checkout -b {branch_name}")
                if result[0] != 0:
                    raise Exception(f"Failed to create branch: {result[2]}")
            
            logging.info(f"Working on branch: {branch_name}")
            
            # Verify we're on the correct branch before launching Claude
            result = await self._run_command("git branch --show-current")
            if result[0] != 0:
                raise Exception(f"Failed to get current branch: {result[2]}")
            
            current_branch = result[1].strip()
            if current_branch != branch_name:
                raise Exception(f"Expected to be on branch {branch_name}, but currently on {current_branch}")
            
            logging.info(f"Verified: currently on branch {current_branch}")
            
            # Validate that the branch is ready for processing
            if not await self.repo_manager.validate_branch_ready(repo_path, branch_name):
                raise Exception(f"Branch {branch_name} is not ready for processing")
            
            # Run Claude Code with stream-json format to capture session_id
            # Use XML format for the command as expected by Claude
            command_prompt = (
                f'<prompt>\n'
                f'# GitHub Issue Workflow for Issue #$ARGUMENT$\n\n'
                f'## Setup Phase\n'
                f'1. Fetch latest branches: `git fetch origin`\n'
                f'2. Get issue details \n'
                f'   - Fetch issue title: `gh issue view $ARGUMENT$ --json title -q .title`\n\n'
                f'## Analysis Phase\n'
                f'1. Read the full issue content and ALL comments using: `gh issue view $ARGUMENT$ --comments`\n'
                f'2. Analyze the requirements and context thoroughly\n'
                f'3. If any clarifications are needed:\n'
                f'   - List all questions clearly\n'
                f'   - Ask me for answers\n'
                f'   - Post both questions and answers as a comment on the github issue $ARGUMENT$\n\n'
                f'## Implementation Phase\n'
                f'1. Execute the plan step by step, remember to build test before the implementation and run the test suite constanly to get quick feedback.\n'
                f'2. Ensure consistency with existing code in the branch\n'
                f'3. Run lint (npm run lint) and tests suite (npm run test) before git commit & push\n'
                f'4. Create the PR\n\n'
                f'## Important Notes\n'
                f'- Always use `gh` CLI for GitHub operations\n'
                f'- Keep detailed records of all actions as PR/issue comments\n'
                f'- Wait for explicit confirmation before proceeding with major changes\n'
                f'</prompt>\n'
                f'<ARGUMENT>{issue_number}</ARGUMENT>'
            )
            
            cmd = [
                self.config.claude_path,
                "--dangerously-skip-permissions",
                "-p",
                command_prompt,
                "--output-format", "stream-json",
                "--verbose"
            ]
            
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=repo_path
            )
        
            # Monitor process and capture session_id from streaming output
            start_time = time.time()
            timeout = self.config.claude_timeout
            session_id = None
            
            # Start async task to read stdout and capture session_id
            async def read_output():
                nonlocal session_id
                while True:
                    line = await process.stdout.readline()
                    if not line:
                        break
                    
                    try:
                        line_str = line.decode().strip()
                        if line_str:
                            data = json.loads(line_str)
                            # Capture session_id from the first message that has it
                            if 'session_id' in data and not session_id:
                                session_id = data['session_id']
                                logging.info(f"Captured session_id {session_id} for issue #{issue_number}")
                                
                                # Update state with session_id immediately
                                state = state_manager.get_state(issue_number)
                                if state:
                                    logging.info(f"Current state before update: {state.to_dict()}")
                                    state.session_id = session_id
                                    state_manager.set_state(issue_number, state)
                                    logging.info(f"State after update: {state.to_dict()}")
                                    
                                    try:
                                        await state_manager.save_states()
                                        logging.info(f"Successfully saved state with session_id {session_id} for issue #{issue_number}")
                                        
                                        # Add small delay to ensure file is written
                                        await asyncio.sleep(0.1)
                                        
                                        # Verify the file was actually written
                                        if state_manager.state_file.exists():
                                            with open(state_manager.state_file, 'r') as f:
                                                saved_data = json.load(f)
                                                if str(issue_number) in saved_data and 'session_id' in saved_data[str(issue_number)]:
                                                    logging.info(f"Verified: session_id is in saved file")
                                                else:
                                                    logging.error(f"ERROR: session_id NOT in saved file! File content: {saved_data}")
                                    except Exception as e:
                                        logging.error(f"Failed to save state: {e}")
                                else:
                                    logging.error(f"Could not get state for issue #{issue_number}")
                    except (json.JSONDecodeError, UnicodeDecodeError) as e:
                        logging.debug(f"Could not parse JSON line: {e}")
            
            # Start reading output
            output_task = asyncio.create_task(read_output())
            
            # Monitor process
            check_interval = self.config.claude_check_interval
            last_output = ""
            
            while True:
                # Check if process completed
                try:
                    # Wait for process to complete or timeout
                    return_code = await asyncio.wait_for(
                        process.wait(),
                        timeout=check_interval
                    )
                    
                    # Process completed
                    await output_task  # Ensure output reading is complete
                    
                    if return_code == 0:
                        logging.info(f"Claude completed successfully for issue #{issue_number}, session_id: {session_id}")
                        return ProcessStatus.COMPLETED, session_id
                    else:
                        stderr_output = await process.stderr.read()
                        error_msg = stderr_output.decode() if stderr_output else "Unknown error"
                        # Send error to all notifiers if it's a list
                        if hasattr(self.notifier, '__iter__') and not isinstance(self.notifier, str):
                            for n in self.notifier:
                                try:
                                    await n.notify_error(issue_number, error_msg, last_output)
                                except Exception as e:
                                    logging.error(f"Failed to send error notification: {e}")
                        elif self.notifier:
                            await self.notifier.notify_error(issue_number, error_msg, last_output)
                        return ProcessStatus.FAILED, session_id
                        
                except asyncio.TimeoutError:
                    # Still running - check for timeout
                    elapsed = time.time() - start_time
                    if elapsed > timeout:
                        process.terminate()
                        # Send timeout error to all notifiers if it's a list
                        error_msg = f"Process timed out after {timeout} seconds"
                        if hasattr(self.notifier, '__iter__') and not isinstance(self.notifier, str):
                            for n in self.notifier:
                                try:
                                    await n.notify_error(issue_number, error_msg, last_output)
                                except Exception as e:
                                    logging.error(f"Failed to send timeout notification: {e}")
                        elif self.notifier:
                            await self.notifier.notify_error(issue_number, error_msg, last_output)
                        return ProcessStatus.FAILED, session_id
                    
                    # Check if needs input (would need to parse output)
                    # For now, continue monitoring
                    continue
                    
        finally:
            # Restore original directory
            os.chdir(original_dir)
            
            # No cleanup needed since we're working directly on branches
            logging.info(f"Completed processing for issue #{issue_number} on branch {branch_name}")
    
    async def _run_command(self, cmd: str) -> Tuple[int, str, str]:
        """Run a shell command and return (returncode, stdout, stderr)"""
        process = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()
        return (process.returncode, stdout.decode(), stderr.decode())
