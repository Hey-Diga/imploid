#!/usr/bin/env python3
"""
GitHub API client for the Issue Orchestrator.

This module provides GitHub API interactions for issue management,
label updates, and comment creation.
"""

import aiohttp
from typing import Dict, List


class GitHubClient:
    """GitHub API client for issue management"""
    
    def __init__(self, token: str, repo: str = None):
        self.token = token
        self.repo = repo  # Can be None for multi-repo support
        self.headers = {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json"
        }
        self.base_url = f"https://api.github.com/repos/{repo}" if repo else None
    
    async def get_ready_issues(self, session: aiohttp.ClientSession, repo: str = None) -> List[Dict]:
        """Get issues with 'ready-for-claude' label from a specific repo or the default repo"""
        if repo:
            url = f"https://api.github.com/repos/{repo}/issues"
        elif self.base_url:
            url = f"{self.base_url}/issues"
        else:
            raise ValueError("No repository specified")
        
        params = {
            "labels": "ready-for-claude",
            "state": "open"
        }
        
        async with session.get(url, headers=self.headers, params=params) as resp:
            if resp.status != 200:
                raise Exception(f"GitHub API error: {resp.status}")
            issues = await resp.json()
            # Add repo name to each issue for tracking
            for issue in issues:
                issue['repo_name'] = repo or self.repo
            return issues
    
    async def update_issue_labels(
        self, 
        session: aiohttp.ClientSession,
        issue_number: int,
        add_labels: List[str] = None,
        remove_labels: List[str] = None,
        repo: str = None
    ):
        """Update labels on an issue"""
        # Get current labels
        if repo:
            base_url = f"https://api.github.com/repos/{repo}"
        elif self.base_url:
            base_url = self.base_url
        else:
            raise ValueError("No repository specified")
        
        url = f"{base_url}/issues/{issue_number}"
        async with session.get(url, headers=self.headers) as resp:
            if resp.status != 200:
                raise Exception(f"Failed to get issue: {resp.status}")
            issue_data = await resp.json()
            current_labels = [label["name"] for label in issue_data["labels"]]
        
        # Calculate new labels
        new_labels = set(current_labels)
        if remove_labels:
            new_labels -= set(remove_labels)
        if add_labels:
            new_labels |= set(add_labels)
        
        # Update labels
        url = f"{base_url}/issues/{issue_number}/labels"
        async with session.put(url, headers=self.headers, json=list(new_labels)) as resp:
            if resp.status not in [200, 201]:
                raise Exception(f"Failed to update labels: {resp.status}")
    
    async def create_comment(
        self,
        session: aiohttp.ClientSession,
        issue_number: int,
        body: str,
        repo: str = None
    ):
        """Create a comment on an issue"""
        if repo:
            base_url = f"https://api.github.com/repos/{repo}"
        elif self.base_url:
            base_url = self.base_url
        else:
            raise ValueError("No repository specified")
        
        url = f"{base_url}/issues/{issue_number}/comments"
        async with session.post(url, headers=self.headers, json={"body": body}) as resp:
            if resp.status not in [200, 201]:
                raise Exception(f"Failed to create comment: {resp.status}")

