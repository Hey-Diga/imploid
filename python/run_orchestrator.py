#!/usr/bin/env python3
"""
Simple script to run the GitHub Issue Orchestrator.

This script provides a command-line interface to run the orchestrator
with proper error handling and logging.
"""

import asyncio
import logging
import sys
from pathlib import Path

# Add the current directory to the Python path
sys.path.insert(0, str(Path(__file__).parent))

from lib.orchestrator import main


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("Orchestrator stopped by user")
        sys.exit(0)
    except Exception as e:
        logging.error(f"Orchestrator failed: {e}")
        sys.exit(1)

