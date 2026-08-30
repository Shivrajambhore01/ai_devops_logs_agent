import subprocess
import os
from typing import List, Dict, Any, Optional

class ControlledGitClient:
    """Safe wrapper around local git CLI commands."""
    
    def __init__(self, repo_path: Optional[str] = None):
        self.repo_path = repo_path or os.getcwd()

    def run_git_cmd(self, args: List[str]) -> str:
        """Execute controlled git commands without shell expansion."""
        valid_git_subcommands = {"log", "diff", "show", "status", "branch", "clone"}
        if not args or args[0] not in valid_git_subcommands:
            raise ValueError(f"Unauthorized git command attempted: {args}")

        cmd = ["git"] + args
        try:
            result = subprocess.run(
                cmd,
                cwd=self.repo_path,
                capture_output=True,
                text=True,
                check=True,
                timeout=30
            )
            return result.stdout
        except subprocess.CalledProcessError as e:
            return e.stderr or str(e)
        except Exception as ex:
            return str(ex)

controlled_git = ControlledGitClient()
