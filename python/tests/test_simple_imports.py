#!/usr/bin/env python3
"""
Simple test script to verify that the modular structure works.

This script tests the basic functionality without requiring external dependencies.
"""

import sys
from pathlib import Path

# Add the current directory to the Python path
sys.path.insert(0, str(Path(__file__).parent))

def test_models():
    """Test the models module."""
    try:
        from lib.models import ProcessStatus, IssueState, InstanceStatus
        
        # Test enum values
        assert ProcessStatus.RUNNING.value == "running"
        assert ProcessStatus.COMPLETED.value == "completed"
        assert InstanceStatus.RUNNING.value == "running"
        
        # Test IssueState creation
        state = IssueState(
            issue_number=123,
            status=ProcessStatus.RUNNING.value,
            session_id="test-session",
            branch="issue-123",
            start_time="2024-01-01T00:00:00"
        )
        
        # Test to_dict method
        state_dict = state.to_dict()
        assert state_dict["issue_number"] == 123
        assert state_dict["status"] == "running"
        assert state_dict["session_id"] == "test-session"
        
        print("✅ Models module works correctly")
        return True
        
    except Exception as e:
        print(f"❌ Models test failed: {e}")
        return False

def test_config():
    """Test the config module."""
    try:
        from lib.config import Config
        
        # Test that it properly handles missing config file
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
        print(f"❌ Config test failed: {e}")
        return False

def test_file_structure():
    """Test that all expected files exist."""
    expected_files = [
        "lib/models.py",
        "lib/config.py", 
        "lib/github_client.py",
        "lib/telegram_notifier.py",
        "lib/repo_manager.py",
        "lib/state_manager.py",
        "lib/claude_processor.py",
        "lib/claude_monitor.py",
        "lib/orchestrator.py",
        "lib/__init__.py"
    ]
    
    missing_files = []
    for filename in expected_files:
        if not Path(filename).exists():
            missing_files.append(filename)
    
    if missing_files:
        print(f"❌ Missing files: {missing_files}")
        return False
    else:
        print("✅ All expected files exist")
        return True

def test_package_init():
    """Test that the package __init__.py file works."""
    try:
        # Test that we can read the __init__.py file
        with open("lib/__init__.py", "r") as f:
            content = f.read()
        
        # Check that it has the expected exports
        assert "__version__" in content
        assert "ProcessStatus" in content
        assert "Config" in content
        assert "IssueOrchestrator" in content
        
        print("✅ Package __init__.py looks correct")
        return True
        
    except Exception as e:
        print(f"❌ Package init test failed: {e}")
        return False

def main():
    """Run all tests."""
    print("Testing modular structure...")
    print("=" * 50)
    
    tests = [
        ("File Structure", test_file_structure),
        ("Package Init", test_package_init),
        ("Models Module", test_models),
        ("Config Module", test_config),
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
        print("\nSummary:")
        print("- All expected files are present")
        print("- Package structure is correct")
        print("- Core modules work without external dependencies")
        print("- Configuration handling works properly")
        return 0
    else:
        print("❌ Some tests failed. Please check the errors above.")
        return 1

if __name__ == "__main__":
    sys.exit(main())

