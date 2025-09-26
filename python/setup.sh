#!/bin/bash

# Setup script for GitHub Issue Orchestrator

set -e

echo "Setting up GitHub Issue Orchestrator..."

# Check Python version
if ! python3 --version | grep -E "3\.(8|9|10|11|12)" > /dev/null; then
    echo "Error: Python 3.8+ is required"
    exit 1
fi

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "Error: GitHub CLI (gh) is not installed"
    echo "Please install it from: https://cli.github.com/"
    exit 1
fi

# Check if Claude Code is installed
if ! command -v claude &> /dev/null; then
    echo "Error: Claude Code CLI is not installed"
    echo "Please install it first"
    exit 1
fi

# Create virtual environment
echo "Creating virtual environment..."
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install dependencies
echo "Installing Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Create config from example if it doesn't exist
if [ ! -f config.json ]; then
    echo "Creating config.json from example..."
    cp config.example.json config.json
    echo ""
    echo "IMPORTANT: Please edit config.json with your credentials:"
    echo "  - GitHub personal access token"
    echo "  - GitHub repository (owner/repo format)"
    echo "  - Telegram bot token"
    echo "  - Telegram chat ID"
fi

# Add to .gitignore if not present
if [ -f ../../.gitignore ]; then
    if ! grep -q "scripts/issue-orchestrator/config.json" ../../.gitignore; then
        echo "" >> ../../.gitignore
        echo "# Issue Orchestrator" >> ../../.gitignore
        echo "scripts/issue-orchestrator/config.json" >> ../../.gitignore
        echo "scripts/issue-orchestrator/processing-state.json" >> ../../.gitignore
        echo "scripts/issue-orchestrator/orchestrator.log" >> ../../.gitignore
        echo "scripts/issue-orchestrator/venv/" >> ../../.gitignore
        echo "scripts/issue-orchestrator/__pycache__/" >> ../../.gitignore
        echo "scripts/issue-orchestrator/.pytest_cache/" >> ../../.gitignore
        echo "scripts/issue-orchestrator/.coverage" >> ../../.gitignore
    fi
fi

# Make the main script executable
chmod +x issue_orchestrator.py

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit config.json with your credentials"
echo "2. Test the orchestrator: ./venv/bin/python issue_orchestrator.py"
echo "3. Add to crontab for automatic execution:"
echo "   */5 * * * * cd $(pwd) && ./venv/bin/python issue_orchestrator.py >> orchestrator.log 2>&1"
echo ""
echo "To run tests: ./venv/bin/pytest tests/"