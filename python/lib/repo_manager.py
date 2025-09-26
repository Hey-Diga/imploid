#!/usr/bin/env python3
"""
Repository management for the Issue Orchestrator.

This module handles cloning, updating, and managing repository clones
for concurrent agent processing.
"""

import asyncio
import logging
import os
from pathlib import Path
from typing import Optional

from .config import Config


class RepoManager:
    """Manages repository clones for concurrent agents"""
    
    def __init__(self, config: Config):
        self.config = config
        
    async def ensure_repo_clone(self, agent_index: int, repo_name: Optional[str] = None) -> Path:
        """Ensure a repo clone exists for the given agent index and repository"""
        repo_path = self.config.get_repo_path(agent_index, repo_name)
        
        # Get the actual repo name to clone
        if not repo_name:
            repo_name = self.config.github_repo  # Fallback to default
        
        if repo_path.exists():
            # Repo exists, pull latest changes
            logging.info(f"Pulling latest changes for agent {agent_index} at {repo_path}")
            await self._pull_latest(repo_path)
        else:
            # Clone the repo
            logging.info(f"Cloning repo for agent {agent_index} to {repo_path}")
            await self._clone_repo(repo_path, repo_name)
        
        # Ensure clean state before processing
        await self.ensure_clean_state(repo_path)
        
        # Run setup.sh if it exists
        await self._run_setup(repo_path)
        
        return repo_path
    
    async def _clone_repo(self, repo_path: Path, repo_name: str):
        """Clone the repository to the specified path"""
        # Ensure parent directory exists
        repo_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Clone the repository using SSH instead of HTTPS
        cmd = f"git clone git@github.com:{repo_name}.git {repo_path}"
        result = await self._run_command(cmd)
        
        if result[0] != 0:
            raise Exception(f"Failed to clone repository: {result[2]}")
        
        logging.info(f"Successfully cloned repository to {repo_path}")
    
    async def _pull_latest(self, repo_path: Path):
        """Pull latest changes from the repository"""
        # Save current directory
        original_dir = os.getcwd()
        
        try:
            # Change to repo directory
            os.chdir(repo_path)

            # Fetch and pull latest changes
            fetch_cmd = "git checkout main"
            result = await self._run_command(fetch_cmd)
            if result[0] != 0:
                raise Exception(f"Failed to checkout main branch: {result[2]}")

            # Fetch and pull latest changes
            fetch_cmd = "git fetch origin"
            result = await self._run_command(fetch_cmd)
            if result[0] != 0:
                raise Exception(f"Failed to fetch latest changes: {result[2]}")
            
            pull_cmd = "git pull origin main"
            result = await self._run_command(pull_cmd)
            if result[0] != 0:
                raise Exception(f"Failed to pull latest changes: {result[2]}")
            
            logging.info(f"Successfully pulled latest changes for {repo_path}")
            
        finally:
            # Restore original directory
            os.chdir(original_dir)
    
    async def _run_setup(self, repo_path: Path):
        """Run setup.sh script if it exists"""
        setup_script = repo_path / "setup.sh"
        
        if setup_script.exists():
            logging.info(f"Running setup.sh for {repo_path}")
            
            # Save current directory
            original_dir = os.getcwd()
            
            try:
                # Change to repo directory
                os.chdir(repo_path)
                
                # Make setup.sh executable and run it
                chmod_cmd = "chmod +x setup.sh"
                result = await self._run_command(chmod_cmd)
                if result[0] != 0:
                    logging.warning(f"Failed to make setup.sh executable: {result[2]}")
                
                setup_cmd = "./setup.sh"
                result = await self._run_command(setup_cmd)
                if result[0] != 0:
                    logging.warning(f"setup.sh failed: {result[2]}")
                else:
                    logging.info(f"Successfully ran setup.sh for {repo_path}")
                    
            finally:
                # Restore original directory
                os.chdir(original_dir)
        else:
            logging.info(f"No setup.sh found in {repo_path}")
    
    async def ensure_clean_state(self, repo_path: Path):
        """Ensure the repository is in a clean state before processing"""
        # Save current directory
        original_dir = os.getcwd()
        
        try:
            # Change to repo directory
            os.chdir(repo_path)
            
            # Check if there are uncommitted changes
            result = await self._run_command("git status --porcelain")
            if result[0] != 0:
                raise Exception(f"Failed to check git status: {result[2]}")
            
            if result[1].strip():
                logging.warning(f"Repository has uncommitted changes: {result[1].strip()}")
                # Optionally, we could stash or reset here, but for now just warn
                # This ensures we don't accidentally commit changes from previous runs
            
            # Check if we're on a detached HEAD
            result = await self._run_command("git branch --show-current")
            if result[0] != 0:
                raise Exception(f"Failed to get current branch: {result[2]}")
            
            current_branch = result[1].strip()
            if not current_branch:
                logging.warning("Repository is in detached HEAD state")
                # Switch to main branch, fallback to master for legacy repositories
                result = await self._run_command("git checkout main")
                if result[0] != 0:
                    result = await self._run_command("git checkout master")
                    if result[0] != 0:
                        raise Exception("Failed to checkout main or master branch")
                    logging.info("Switched to master branch (legacy)")
                else:
                    logging.info("Switched to main branch")
            
            logging.info(f"Repository is in clean state on branch: {current_branch}")
            
        finally:
            # Restore original directory
            os.chdir(original_dir)
    
    async def _run_command(self, cmd: str) -> tuple:
        """Run a shell command and return (returncode, stdout, stderr)"""
        process = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()
        return (process.returncode, stdout.decode(), stderr.decode())
    
    async def validate_branch_ready(self, repo_path: Path, branch_name: str) -> bool:
        """Validate that the branch is ready for processing"""
        # Save current directory
        original_dir = os.getcwd()
        
        try:
            # Change to repo directory
            os.chdir(repo_path)
            
            # Check if branch exists
            result = await self._run_command(f"git show-ref --verify --quiet refs/heads/{branch_name}")
            if result[0] != 0:
                logging.error(f"Branch {branch_name} does not exist")
                return False
            
            # Check if we're on the correct branch
            result = await self._run_command("git branch --show-current")
            if result[0] != 0:
                logging.error(f"Failed to get current branch: {result[2]}")
                return False
            
            current_branch = result[1].strip()
            if current_branch != branch_name:
                logging.error(f"Expected to be on branch {branch_name}, but currently on {current_branch}")
                return False
            
            # Check if there are any uncommitted changes that might interfere
            result = await self._run_command("git status --porcelain")
            if result[0] != 0:
                logging.error(f"Failed to check git status: {result[2]}")
                return False
            
            if result[1].strip():
                logging.warning(f"Branch has uncommitted changes: {result[1].strip()}")
                # This is just a warning, not a failure
            
            logging.info(f"Branch {branch_name} is ready for processing")
            return True
            
        finally:
            # Restore original directory
            os.chdir(original_dir)

