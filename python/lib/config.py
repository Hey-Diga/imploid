#!/usr/bin/env python3
"""
Configuration management for the GitHub Issue Orchestrator.

This module handles loading and validating configuration from JSON files.
"""

import json
from pathlib import Path
from typing import Dict, List, Optional


class Config:
    """Configuration management"""
    
    def __init__(self, config_path: str = "config.json"):
        self.config_path = Path(config_path)
        self._config = self._load_config()
        
    def _load_config(self) -> Dict:
        """Load configuration from JSON file"""
        if not self.config_path.exists():
            raise FileNotFoundError(
                f"Configuration file not found: {self.config_path}\n"
                "Please create it from config.example.json"
            )
        
        with open(self.config_path) as f:
            config = json.load(f)
            
        # Validate required fields (telegram and slack are optional)
        required = ["github", "claude"]
        for field in required:
            if field not in config:
                raise ValueError(f"Missing required config field: {field}")
                
        return config
    
    @property
    def github_token(self) -> str:
        return self._config["github"]["token"]
    
    @property
    def github_repos(self) -> List[Dict[str, str]]:
        """Get list of configured repositories"""
        repos = self._config["github"].get("repos")
        if repos:
            return repos
        # Backward compatibility: if old single repo format exists
        if "repo" in self._config["github"]:
            return [{
                "name": self._config["github"]["repo"],
                "base_repo_path": self._config["github"]["base_repo_path"]
            }]
        return []
    
    @property
    def github_repo(self) -> str:
        """Legacy property for backward compatibility - returns first repo"""
        repos = self.github_repos
        return repos[0]["name"] if repos else ""
    
    @property
    def base_repo_path(self) -> str:
        """Legacy property for backward compatibility - returns first repo's base path"""
        repos = self.github_repos
        return repos[0]["base_repo_path"] if repos else ""
    
    @property
    def repo_path(self) -> str:
        """Legacy property - use get_repo_path(agent_index, repo_name) instead"""
        return self._config["github"].get("repo_path", "")
    
    def get_repo_config(self, repo_name: str) -> Optional[Dict[str, str]]:
        """Get configuration for a specific repository"""
        for repo in self.github_repos:
            if repo["name"] == repo_name:
                return repo
        return None
    
    def get_repo_path(self, agent_index: int, repo_name: Optional[str] = None) -> Path:
        """Get the repo path for a specific agent index and repository"""
        if repo_name:
            repo_config = self.get_repo_config(repo_name)
            if not repo_config:
                raise ValueError(f"Repository {repo_name} not found in configuration")
            base_path = Path(repo_config["base_repo_path"]).expanduser().resolve()
        else:
            # Backward compatibility: use first repo if not specified
            base_path = Path(self.base_repo_path).expanduser().resolve()
            repo_name = self.github_repo
        
        repo_short_name = repo_name.split('/')[-1]  # Extract repo name from owner/repo
        return base_path / f"{repo_short_name}_agent_{agent_index}"
    
    @property
    def max_concurrent(self) -> int:
        return self._config["github"].get("max_concurrent", 3)
    
    @property
    def telegram_bot_token(self) -> str:
        return self._config.get("telegram", {}).get("bot_token", "")
    
    @property
    def telegram_chat_id(self) -> str:
        return self._config.get("telegram", {}).get("chat_id", "")
    
    @property
    def slack_bot_token(self) -> str:
        return self._config.get("slack", {}).get("bot_token", "")
    
    @property
    def slack_channel_id(self) -> str:
        return self._config.get("slack", {}).get("channel_id", "")
    
    @property
    def claude_timeout(self) -> int:
        return self._config["claude"].get("timeout_seconds", 3600)
    
    @property
    def claude_check_interval(self) -> int:
        return self._config["claude"].get("check_interval", 5)
    
    @property
    def claude_path(self) -> str:
        return self._config["claude"].get("path", "claude")

