#!/usr/bin/env python3
"""
Main orchestrator for the GitHub Issue Orchestrator.

This module coordinates all the components to process GitHub issues
with Claude Code in a concurrent, stateful manner.
"""

import asyncio
import logging
from datetime import datetime
from pathlib import Path

import aiohttp

from .config import Config
from .github_client import GitHubClient
from .models import IssueState, ProcessStatus
from .repo_manager import RepoManager
from .state_manager import StateManager
from .telegram_notifier import TelegramNotifier
from .slack_notifier import SlackNotifier
from .claude_processor import ClaudeProcessor


class IssueOrchestrator:
    """Main orchestrator for processing GitHub issues"""
    
    def __init__(self):
        self.config = Config()
        self.state_manager = StateManager()
        # Create a generic GitHub client without a specific repo
        self.github_client = GitHubClient(
            self.config.github_token
        )
        # Initialize notifiers list
        self.notifiers = []
        
        # Add Telegram notifier if configured
        if self.config.telegram_bot_token and self.config.telegram_chat_id:
            self.notifiers.append(TelegramNotifier(
                self.config.telegram_bot_token,
                self.config.telegram_chat_id
            ))
        
        # Add Slack notifier if configured
        if self.config.slack_bot_token and self.config.slack_channel_id:
            self.notifiers.append(SlackNotifier(
                self.config.slack_bot_token,
                self.config.slack_channel_id
            ))
        
        # For backward compatibility, keep single notifier reference
        self.notifier = self.notifiers[0] if self.notifiers else None
        self.repo_manager = RepoManager(self.config)
        self.processor = ClaudeProcessor(self.config, self.notifiers, self.repo_manager)
        
        # Setup logging
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('orchestrator.log'),
                logging.StreamHandler()
            ]
        )
    
    async def run(self):
        """Main orchestration loop"""
        logging.info("Starting Issue Orchestrator")
        
        # Validate base repo paths exist for all repos
        for repo_config in self.config.github_repos:
            base_path = Path(repo_config["base_repo_path"]).expanduser().resolve()
            if not base_path.exists():
                logging.info(f"Creating base repo path: {base_path}")
                base_path.mkdir(parents=True, exist_ok=True)
            
            if not base_path.is_dir():
                logging.error(f"Base repo path is not a directory: {base_path}")
                raise NotADirectoryError(f"Base repo path is not a directory: {base_path}")
            
            logging.info(f"Using base repo path for {repo_config['name']}: {base_path}")
        
        async with aiohttp.ClientSession() as session:
            try:
                # Get ready issues from all configured repos
                all_issues = []
                for repo_config in self.config.github_repos:
                    repo_name = repo_config["name"]
                    try:
                        repo_issues = await self.github_client.get_ready_issues(session, repo_name)
                        logging.info(f"Found {len(repo_issues)} ready issues in {repo_name}")
                        all_issues.extend(repo_issues)
                    except Exception as e:
                        logging.error(f"Failed to get issues from {repo_name}: {e}")
                        continue
                
                issues = all_issues
                logging.info(f"Found {len(issues)} total ready issues across all repos")
                
                # Filter out already processing issues
                active_issues = self.state_manager.get_active_issues()
                new_issues = [
                    issue for issue in issues 
                    if issue["number"] not in active_issues
                ]
                
                # Process issues up to max concurrent limit
                current_processing = len(active_issues)
                available_slots = self.config.max_concurrent - current_processing
                
                if available_slots > 0 and new_issues:
                    issues_to_process = new_issues[:available_slots]
                    
                    # Create tasks for concurrent processing
                    tasks = []
                    for issue in issues_to_process:
                        # Get an available agent index
                        agent_index = self.state_manager.get_available_agent_index(self.config.max_concurrent)
                        if agent_index is None:
                            logging.warning(f"No available agent slots for issue #{issue['number']}. Skipping.")
                            continue
                        
                        # Reserve the agent index immediately by creating a placeholder state
                        # This prevents race conditions where multiple issues get the same agent
                        placeholder_state = IssueState(
                            issue_number=issue["number"],
                            status=ProcessStatus.RUNNING.value,
                            session_id=None,
                            branch=f"issue-{issue['number']}",
                            start_time=datetime.now().isoformat(),
                            agent_index=agent_index,
                            repo_name=issue.get('repo_name')  # Store repo name
                        )
                        self.state_manager.set_state(issue["number"], placeholder_state)
                        
                        task = asyncio.create_task(
                            self._process_issue(session, issue, agent_index)
                        )
                        tasks.append(task)
                    
                    # Wait for all tasks to complete
                    await asyncio.gather(*tasks, return_exceptions=True)
                
                # Save state
                await self.state_manager.save_states()
                
            except Exception as e:
                logging.error(f"Orchestrator error: {e}")
                raise
    
    async def _process_issue(self, session: aiohttp.ClientSession, issue: dict, agent_index: int):
        """Process a single issue"""
        issue_number = issue["number"]
        issue_title = issue["title"]
        repo_name = issue.get('repo_name')
        
        try:
            logging.info(f"Starting to process issue #{issue_number} from {repo_name} with agent {agent_index}")
            
            # Update labels: remove 'ready-for-claude', add 'claude-working'
            await self.github_client.update_issue_labels(
                session,
                issue_number,
                add_labels=["claude-working"],
                remove_labels=["ready-for-claude"],
                repo=repo_name
            )
            
            # Update the placeholder state with additional information
            # The state was already created in the main loop to reserve the agent index
            repo_path = self.config.get_repo_path(agent_index, repo_name)
            
            state = self.state_manager.get_state(issue_number)
            if not state:
                # Fallback: create state if it doesn't exist (shouldn't happen normally)
                state = IssueState(
                    issue_number=issue_number,
                    status=ProcessStatus.RUNNING.value,
                    session_id=None,
                    branch=f"issue-{issue_number}",
                    start_time=datetime.now().isoformat(),
                    agent_index=agent_index,
                    repo_name=repo_name
                )
                self.state_manager.set_state(issue_number, state)
            
            await self.state_manager.save_states()
            
            # Send start notification to all notifiers
            for notifier in self.notifiers:
                try:
                    if isinstance(notifier, SlackNotifier):
                        await notifier.notify_start(issue_number, issue_title, repo_name)
                    else:
                        await notifier.notify_start(issue_number, issue_title)
                except Exception as e:
                    logging.error(f"Failed to send start notification: {e}")
            
            # Process with Claude
            result, session_id = await self.processor.process_issue(issue_number, agent_index, self.state_manager, repo_name)
            
            # Update state based on result (session_id already updated in read_output)
            state = self.state_manager.get_state(issue_number)  # Get latest state with session_id
            if state:
                state.status = result.value
                state.end_time = datetime.now().isoformat()
                
                # Save updated state
                self.state_manager.set_state(issue_number, state)
                await self.state_manager.save_states()
            
            if result == ProcessStatus.COMPLETED:
                # Calculate duration
                start = datetime.fromisoformat(state.start_time)
                end = datetime.fromisoformat(state.end_time)
                duration = str(end - start).split('.')[0]
                
                # Send completion notification to all notifiers
                for notifier in self.notifiers:
                    try:
                        if isinstance(notifier, SlackNotifier):
                            await notifier.notify_complete(issue_number, duration, repo_name)
                        else:
                            await notifier.notify_complete(issue_number, duration)
                    except Exception as e:
                        logging.error(f"Failed to send completion notification: {e}")
                
                # Update labels: remove 'claude-working', add 'claude-completed'
                await self.github_client.update_issue_labels(
                    session,
                    issue_number,
                    add_labels=["claude-completed"],
                    remove_labels=["claude-working"],
                    repo=repo_name
                )
                
                # Remove from state manager
                self.state_manager.remove_state(issue_number)
                
            elif result == ProcessStatus.NEEDS_INPUT:
                # Keep in state, notify user
                for notifier in self.notifiers:
                    try:
                        if isinstance(notifier, SlackNotifier):
                            await notifier.notify_needs_input(
                                issue_number,
                                state.last_output or "No output available",
                                repo_name
                            )
                        else:
                            await notifier.notify_needs_input(
                                issue_number,
                                state.last_output or "No output available"
                            )
                    except Exception as e:
                        logging.error(f"Failed to send needs input notification: {e}")
                
            elif result == ProcessStatus.FAILED:
                # Update labels: remove 'claude-working', add 'claude-failed'
                await self.github_client.update_issue_labels(
                    session,
                    issue_number,
                    add_labels=["claude-failed"],
                    remove_labels=["claude-working"],
                    repo=repo_name
                )
                
                # Remove from state manager
                self.state_manager.remove_state(issue_number)
            
            await self.state_manager.save_states()
            
        except Exception as e:
            logging.error(f"Error processing issue #{issue_number} with agent {agent_index}: {e}")
            for notifier in self.notifiers:
                try:
                    if isinstance(notifier, SlackNotifier):
                        await notifier.notify_error(issue_number, str(e), None, repo_name)
                    else:
                        await notifier.notify_error(issue_number, str(e))
                except Exception as notify_error:
                    logging.error(f"Failed to send error notification: {notify_error}")
            
            # Try to update labels to indicate failure
            try:
                await self.github_client.update_issue_labels(
                    session,
                    issue_number,
                    add_labels=["claude-failed"],
                    remove_labels=["claude-working", "ready-for-claude"],
                    repo=repo_name
                )
            except:
                pass
            
            # Remove from state manager
            self.state_manager.remove_state(issue_number)
            await self.state_manager.save_states()


async def main():
    """Main entry point"""
    orchestrator = IssueOrchestrator()
    await orchestrator.run()


if __name__ == "__main__":
    asyncio.run(main())

