from typing import List, Dict, Any, Optional
from app.tools.git.client import controlled_git

def get_git_log(repo_path: Optional[str] = None, max_count: int = 5) -> str:
    """Retrieve git log output for local repository."""
    client = controlled_git if not repo_path else controlled_git.__class__(repo_path)
    return client.run_git_cmd(["log", f"-n{max_count}", "--oneline"])

def get_git_diff(commit_sha: str = "HEAD~1", repo_path: Optional[str] = None) -> str:
    """Retrieve git diff for specified commit."""
    client = controlled_git if not repo_path else controlled_git.__class__(repo_path)
    return client.run_git_cmd(["diff", commit_sha])

def get_git_status(repo_path: Optional[str] = None) -> str:
    """Retrieve current repository git status."""
    client = controlled_git if not repo_path else controlled_git.__class__(repo_path)
    return client.run_git_cmd(["status", "--short"])
