from typing import Optional, Dict, Any, List
import logging
from app.core.config import settings

logger = logging.getLogger(__name__)

try:
    from github import Github, Auth
    PYGITHUB_AVAILABLE = True
except ImportError:
    Github = None
    Auth = None
    PYGITHUB_AVAILABLE = False
    logger.warning("PyGithub module not installed. Falling back to HTTP/Mock GitHub driver.")

class GitHubClientWrapper:
    def __init__(self, token: Optional[str] = None):
        self.token = token or settings.GITHUB_TOKEN
        self._gh: Optional[Any] = None
        if self.token and PYGITHUB_AVAILABLE:
            try:
                auth = Auth.Token(self.token)
                self._gh = Github(auth=auth)
            except Exception as err:
                logger.warning(f"Failed to initialize GitHub client with provided token: {err}")

    def is_configured(self) -> bool:
        return self._gh is not None

    def get_repo(self, owner_and_repo: str):
        if not self._gh:
            raise ValueError("GitHub client is not configured or PyGithub is missing.")
        return self._gh.get_repo(owner_and_repo)

github_client = GitHubClientWrapper()

def get_github_client(token: Optional[str] = None) -> GitHubClientWrapper:
    if token and token.strip():
        return GitHubClientWrapper(token=token.strip())
    return github_client

