#!/usr/bin/env python3
"""
GitHub Issue Orchestrator for Claude Code

Automatically processes GitHub issues labeled 'ready-for-claude' using Claude Code CLI.
Supports concurrent processing, state management, and Telegram notifications.

This is the main entry point that uses the modular orchestrator system.
"""

import asyncio

from lib.orchestrator import main


if __name__ == "__main__":
    asyncio.run(main())