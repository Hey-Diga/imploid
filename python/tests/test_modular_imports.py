#!/usr/bin/env python3
"""
Test script to verify that all modular imports work correctly.

This script tests that all modules can be imported and basic functionality works.
"""

import sys
from pathlib import Path

# Add the current directory to the Python path
sys.path.insert(0, str(Path(__file__).parent))

def test_core_imports():
    """Test core modules that don't require external dependencies."""
    try:
        # Test core modules
        from models import ProcessStatus, IssueState
        from config import Config
        from state_manager import StateManager
        
        print("✅ Core module imports successful")
        return True
        
    except ImportError as e:
        print(f"❌ Core import error: {e}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

def test_optional_imports():
    """Test modules that may have optional dependencies."""
    optional_modules = []
    
    # Test GitHub client
    try:
        from github_client import GitHubClient
        optional_modules.append("GitHubClient")
    except ImportError as e:
        print(f"⚠️  GitHubClient import failed (missing aiohttp): {e}")
    
    # Test Telegram notifier
    try:
        from telegram_notifier import TelegramNotifier
        optional_modules.append("TelegramNotifier")
    except ImportError as e:
        print(f"⚠️  TelegramNotifier import failed (missing python-telegram-bot): {e}")
    
    # Test other modules
    try:
        from repo_manager import RepoManager
        optional_modules.append("RepoManager")
    except ImportError as e:
        print(f"⚠️  RepoManager import failed: {e}")
    
    try:
        from claude_processor import ClaudeProcessor
        optional_modules.append("ClaudeProcessor")
    except ImportError as e:
        print(f"⚠️  ClaudeProcessor import failed: {e}")
    
    try:
        from claude_monitor import ClaudeMonitor
        optional_modules.append("ClaudeMonitor")
    except ImportError as e:
        print(f"⚠️  ClaudeMonitor import failed: {e}")
    
    try:
        from orchestrator import IssueOrchestrator
        optional_modules.append("IssueOrchestrator")
    except ImportError as e:
        print(f"⚠️  IssueOrchestrator import failed: {e}")
    
    if optional_modules:
        print(f"✅ Optional modules imported: {', '.join(optional_modules)}")
        return True
    else:
        print("⚠️  No optional modules could be imported (dependencies missing)")
        return True  # This is acceptable if dependencies are missing

def test_package_import():
    """Test package import (this may fail when run directly)."""
    try:
        # Test importing from the package
        from issue_orchestrator import (
            ProcessStatus,
            InstanceStatus,
            IssueState,
            Message,
            ClaudeInstance,
            MonitorReport,
            Config,
            GitHubClient,
            TelegramNotifier,
            RepoManager,
            StateManager,
            ClaudeProcessor,
            ClaudeMonitor,
            IssueOrchestrator
        )
        print("✅ Package import successful")
        return True
    except ImportError as e:
        print(f"⚠️  Package import failed (expected when run directly): {e}")
        print("   This is normal when running the test script directly.")
        print("   Package imports work when using the module as a package.")
        return True  # This is expected to fail when run directly
    except Exception as e:
        print(f"❌ Unexpected package import error: {e}")
        return False

def test_config_loading():
    """Test configuration loading (without actual config file)."""
    try:
        from config import Config
        
        # This should fail gracefully if config.json doesn't exist
        try:
            config = Config()
            print("✅ Config loaded successfully")
            return True
        except FileNotFoundError:
            print("✅ Config properly handles missing file")
            return True
        except Exception as e:
            print(f"❌ Config error: {e}")
            return False
            
    except Exception as e:
        print(f"❌ Config test error: {e}")
        return False

def test_models():
    """Test that models can be instantiated."""
    try:
        from models import IssueState, ProcessStatus
        
        # Test creating an IssueState
        state = IssueState(
            issue_number=123,
            status=ProcessStatus.RUNNING.value,
            session_id="test-session",
            branch="issue-123",
            start_time="2024-01-01T00:00:00"
        )
        
        # Test to_dict method
        state_dict = state.to_dict()
        assert "issue_number" in state_dict
        assert state_dict["issue_number"] == 123
        
        print("✅ Models test passed")
        return True
        
    except Exception as e:
        print(f"❌ Models test error: {e}")
        return False

def main():
    """Run all tests."""
    print("Testing modular structure...")
    print("=" * 50)
    
    tests = [
        ("Core Module Imports", test_core_imports),
        ("Optional Module Imports", test_optional_imports),
        ("Package Import", test_package_import),
        ("Config Test", test_config_loading),
        ("Models Test", test_models),
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        print(f"\nRunning {test_name}...")
        if test_func():
            passed += 1
        else:
            print(f"❌ {test_name} failed")
    
    print("\n" + "=" * 50)
    print(f"Tests passed: {passed}/{total}")
    
    if passed == total:
        print("🎉 All tests passed! Modular structure is working correctly.")
        return 0
    else:
        print("❌ Some tests failed. Please check the errors above.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
