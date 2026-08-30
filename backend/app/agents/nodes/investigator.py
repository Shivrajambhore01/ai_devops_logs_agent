from typing import Dict, Any
import logging
from app.agents.state import AgentState
from app.tools.github.client import github_client
from app.tools.logs import search_logs
from app.tools.docker import list_containers

logger = logging.getLogger(__name__)

def investigator_node(state: AgentState) -> Dict[str, Any]:
    """Execute controlled tools against real GitHub API and fetch real commit code diffs."""
    obs = state.get("observations", [])
    repo_input = state.get("repository") or state.get("service_name") or "Shivrajambhore01/Secure_Vault"
    
    # Extract owner and repo name
    if "/" in repo_input:
        owner, repo_name = repo_input.split("/", 1)
    else:
        owner, repo_name = "Shivrajambhore01", repo_input

    target_full_repo = f"{owner}/{repo_name}"
    
    # 1. Fetch Real Commits & Actual File Diffs from GitHub API
    commit_info_list = []
    suspect_sha = state.get("commit_sha", "latest")
    suspect_file = "src/index.ts"

    if github_client.is_configured():
        try:
            gh_repo = github_client.get_repo(target_full_repo)
            commits = list(gh_repo.get_commits()[:3])
            for c in commits:
                files_list = []
                try:
                    full_commit = gh_repo.get_commit(c.sha)
                    if full_commit.files:
                        # Ignore junk/binary/compiled files (.pyc, __pycache__, lockfiles, images)
                        ignored_exts = ('.pyc', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.DS_Store', 'lock')
                        source_files = [
                            f for f in full_commit.files
                            if not any(f.filename.endswith(ext) or '__pycache__' in f.filename for ext in ignored_exts)
                        ]
                        target_files = source_files if source_files else full_commit.files

                        for f in target_files[:3]:
                            files_list.append({
                                "filename": f.filename,
                                "additions": f.additions,
                                "deletions": f.deletions,
                                "patch": f.patch[:400] if f.patch else "No patch diff available"
                            })
                            if not suspect_file or suspect_file == "src/index.ts":
                                suspect_file = f.filename
                except Exception as fe:
                    logger.debug(f"Could not fetch file diffs for {c.sha}: {fe}")

                commit_info_list.append({
                    "sha": c.sha[:7],
                    "message": c.commit.message if c.commit else "Update codebase",
                    "author": c.commit.author.name if (c.commit and c.commit.author) else "DevOps Contributor",
                    "files": files_list
                })
            if commits:
                suspect_sha = commits[0].sha[:7]
            obs.append({"tool": "get_recent_commits", "status": "success", "output": commit_info_list})
        except Exception as e:
            logger.warning(f"Failed to query PyGithub for {target_full_repo}: {e}")
            obs.append({"tool": "get_recent_commits", "status": "fallback", "output": f"Inspected recent commits on {target_full_repo}."})
    else:
        obs.append({"tool": "get_recent_commits", "status": "simulated", "output": f"Inspected repository {target_full_repo}."})

    # 2. Fetch Runtime Logs & Container Status
    app_logs = search_logs(repo_name, keyword="error")
    obs.append({"tool": "search_logs", "status": "success", "output": app_logs})

    containers = list_containers()
    obs.append({"tool": "list_containers", "status": "success", "output": containers})

    return {
        "observations": obs,
        "commit_sha": suspect_sha,
        "suspect_file": suspect_file,
        "target_repo_name": target_full_repo,
        "real_commits_info": commit_info_list,
        "current_step": "evidence_correlation"
    }
