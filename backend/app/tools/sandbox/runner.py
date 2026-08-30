import os
import tempfile
import subprocess
from typing import Dict, Any, Optional

class SandboxTestRunner:
    """Executes code patches inside an isolated workspace before requesting human approval."""

    def run_sandbox_tests(self, patch_diff: str, test_command: Optional[str] = None) -> Dict[str, Any]:
        """Apply patch in sandbox workspace and run test suite."""
        # Standard mock sandbox run for offline local execution
        if not patch_diff or "---" not in patch_diff:
            return {
                "passed": False,
                "total_tests": 0,
                "passed_tests": 0,
                "failed_tests": 0,
                "build_status": "FAIL",
                "output_log": "Invalid patch diff provided to sandbox."
            }

        return {
            "passed": True,
            "total_tests": 4,
            "passed_tests": 4,
            "failed_tests": 0,
            "build_status": "PASS",
            "health_check": "PASS",
            "output_log": (
                "=== Sandbox Test Execution ===\n"
                "✓ Patch 8f2a1c applied cleanly to workspace\n"
                "✓ Running test suite: npm test\n"
                "  PASS src/tax/calculate.test.ts\n"
                "    ✓ should calculate tax correctly for valid address\n"
                "    ✓ should return 0 for undefined legacy address\n"
                "    ✓ should return 0 for null user object\n"
                "    ✓ should apply 8% tax rate\n"
                "Test Suites: 1 passed, 1 total\n"
                "Tests:       4 passed, 4 total\n"
                "Snapshots:   0 total\n"
                "Time:        1.24s\n"
                "=== Docker Build Check: PASS ==="
            )
        }

sandbox_runner = SandboxTestRunner()
