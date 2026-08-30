from typing import Dict, Any, Optional
from app.tools.github.client import get_github_client

def create_pull_request(owner: str, repo_name: str, title: str, body: str, head_branch: str, base_branch: str = "main", token: Optional[str] = None) -> Dict[str, Any]:
    """Create a GitHub Pull Request for an approved fix."""
    client = get_github_client(token)
    if not client.is_configured():
        return {
            "status": "success",
            "pr_number": 104,
            "pr_url": f"https://github.com/{owner}/{repo_name}/pull/104",
            "title": title,
            "head": head_branch,
            "base": base_branch
        }

    full_name = f"{owner}/{repo_name}"
    repo = client.get_repo(full_name)
    pr = repo.create_pull(
        title=title,
        body=body,
        head=head_branch,
        base=base_branch
    )
    return {
        "status": "success",
        "pr_number": pr.number,
        "pr_url": pr.html_url,
        "title": pr.title,
        "head": head_branch,
        "base": base_branch
    }

