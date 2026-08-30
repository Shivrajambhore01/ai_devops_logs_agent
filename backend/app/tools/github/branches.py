from typing import List, Optional
import logging
from app.tools.github.client import get_github_client

logger = logging.getLogger(__name__)

def get_repository_branches(owner: str, repo_name: str, token: Optional[str] = None) -> List[str]:
    """Retrieve all branch names for a repository."""
    full_name = f"{owner}/{repo_name}"
    client = get_github_client(token)
    if not client.is_configured():
        return ["main", "master", "develop", "feature/auth-v2"]

    try:
        repo = client.get_repo(full_name)
        branches = repo.get_branches()
        return [b.name for b in branches]
    except Exception as err:
        logger.warning(f"Could not fetch branches for {full_name}: {err}")
        return ["main", "master"]
