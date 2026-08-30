from typing import List, Dict, Any, Optional
from app.tools.github.client import get_github_client

def get_recent_commits(owner: str, repo_name: str, branch: Optional[str] = None, limit: int = 5, token: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieve recent commits for a repository and optional branch."""
    full_name = f"{owner}/{repo_name}"
    client = get_github_client(token)
    if not client.is_configured():
        # Fallback structured mock data for local demo mode
        return [
            {
                "commit": "8a3f1c2",
                "full_sha": "8a3f1c2b5e9a4f3d1e2c4b5a6f7e8d9c0b1a2f3e",
                "message": "Update database configuration and tax calculator",
                "author": "Maya Chen",
                "date": "2026-08-23T12:00:00Z",
                "branch": branch or "main",
                "files_changed": ["backend/config.py", "src/tax/calculate.ts"]
            },
            {
                "commit": "4b2e9d1",
                "full_sha": "4b2e9d1a3c5e7f9b1d3f5a7c9e1b3d5f7a9c1e3b",
                "message": "Add user authentication middleware",
                "author": "Shivraj",
                "date": "2026-08-23T10:30:00Z",
                "branch": branch or "main",
                "files_changed": ["backend/middleware.py"]
            },
            {
                "commit": "7f9c2a1",
                "full_sha": "7f9c2a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b",
                "message": "Fix CORS middleware header credentials",
                "author": "Alex Dev",
                "date": "2026-08-23T09:15:00Z",
                "branch": branch or "main",
                "files_changed": ["app/main.py"]
            },
            {
                "commit": "3d5e1f9",
                "full_sha": "3d5e1f9a7c3b5d1e9f7a3c5b1d9e7f3a5c1b9d7e",
                "message": "Add async session handler for Postgres",
                "author": "Maya Chen",
                "date": "2026-08-22T16:45:00Z",
                "branch": branch or "main",
                "files_changed": ["app/core/database.py"]
            },
            {
                "commit": "1a2b3c4",
                "full_sha": "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
                "message": "Initial repository setup with Docker compose",
                "author": "Shivraj",
                "date": "2026-08-22T14:00:00Z",
                "branch": branch or "main",
                "files_changed": ["docker-compose.yml", "README.md"]
            }
        ]

    try:
        repo = client.get_repo(full_name)
        commits_iter = repo.get_commits(sha=branch) if branch else repo.get_commits()
        commits = list(commits_iter[:limit])
        result = []
        for c in commits:
            result.append({
                "commit": c.sha[:7],
                "full_sha": c.sha,
                "message": c.commit.message.split("\n")[0],
                "author": c.commit.author.name if c.commit and c.commit.author else "Unknown",
                "date": c.commit.author.date.isoformat() if c.commit and c.commit.author else "",
                "branch": branch or repo.default_branch or "main",
                "files_changed": [f.filename for f in c.files] if c.files else []
            })
        return result
    except Exception as err:
        logger.warning(f"Failed to fetch commits for {full_name} ({branch}): {err}")
        return []

def get_commit_diff(owner: str, repo_name: str, commit_sha: str, token: Optional[str] = None) -> Dict[str, Any]:
    """Retrieve exact diff and changed files for a commit."""
    full_name = f"{owner}/{repo_name}"
    client = get_github_client(token)
    if not client.is_configured():
        return {
            "commit": commit_sha,
            "files": [
                {
                    "filename": "src/tax/calculate.ts",
                    "patch": "@@ -12,4 +12,6 @@ export function calculateTax(user) {\n-  return user.address.zipCode * 0.08\n+  if (!user || !user.address) {\n+    throw new Error('Missing address for tax calculation');\n+  }\n+  return user.address.zipCode * 0.08;"
                }
            ]
        }

    repo = client.get_repo(full_name)

    c = repo.get_commit(commit_sha)
    files_data = []
    for f in c.files:
        files_data.append({
            "filename": f.filename,
            "status": f.status,
            "additions": f.additions,
            "deletions": f.deletions,
            "patch": f.patch or ""
        })
    return {
        "commit": commit_sha,
        "author": c.commit.author.name if c.commit.author else "",
        "message": c.commit.message,
        "files": files_data
    }
