from typing import Dict, Any, List
import logging
from app.agents.state import AgentState

logger = logging.getLogger(__name__)

def evidence_analyzer_node(state: AgentState) -> Dict[str, Any]:
    """Build correlated evidence items from real commit data fetched by investigator_node."""
    repo = state.get("target_repo_name") or state.get("repository") or "unknown/repo"
    real_commits: List[Dict] = state.get("real_commits_info") or []
    observations = state.get("observations") or []
    incident_title = state.get("incident_title") or "Production Issue"

    evidence_list = []

    # --- Evidence from real GitHub commits ---
    if real_commits:
        for idx, commit in enumerate(real_commits[:3], start=1):
            sha = commit.get("sha", "unknown")
            message = commit.get("message", "No commit message").splitlines()[0]  # first line only
            author = commit.get("author", "Unknown contributor")
            files = commit.get("files", [])

            # Build a readable summary of changed files
            if files:
                file_summaries = []
                for f in files[:3]:
                    fname = f.get("filename", "unknown file")
                    adds = f.get("additions", 0)
                    dels = f.get("deletions", 0)
                    patch_snippet = f.get("patch", "")[:200] if f.get("patch") else ""
                    file_summaries.append(f"{fname} (+{adds}/-{dels})")
                files_detail = ", ".join(file_summaries)
                patch_text = ""
                if files and files[0].get("patch"):
                    patch_text = f" Patch excerpt: {files[0]['patch'][:300]}"
            else:
                files_detail = "No file diff available"
                patch_text = ""

            evidence_list.append({
                "id": f"EV-{idx:03d}",
                "source": "github",
                "label": f"Commit {sha} by {author}",
                "detail": (
                    f"Commit {sha}: \"{message}\" — Modified files: {files_detail}.{patch_text}"
                ),
                "metadata": {"sha": sha, "author": author, "repo": repo}
            })
    else:
        # No real commit data (GitHub not configured or API failed) —
        # produce generic but context-accurate evidence based on the actual repo/incident.
        logger.info(f"No real commits available for {repo}; generating context-aware evidence.")
        evidence_list.append({
            "id": "EV-001",
            "source": "github",
            "label": "Recent commit activity",
            "detail": (
                f"GitHub commit history for repository '{repo}' was inspected. "
                f"No live diff data was retrievable (GitHub client not configured). "
                f"Manual inspection of recent commits is recommended for incident: '{incident_title}'."
            ),
            "metadata": {"repo": repo}
        })

    # --- Evidence from log observations ---
    log_obs = next(
        (o for o in observations if o.get("tool") == "search_logs"),
        None
    )
    if log_obs:
        log_output = log_obs.get("output", "No log data")
        # Truncate long log output for display
        log_detail = str(log_output)[:400] if log_output else "No error log signals detected."
        evidence_list.append({
            "id": f"EV-{len(evidence_list)+1:03d}",
            "source": "logs",
            "label": "Runtime log scan",
            "detail": f"Log scan for '{repo}': {log_detail}",
            "metadata": {"repo": repo, "source": "runtime_logs"}
        })

    # --- Evidence from container/infrastructure status ---
    container_obs = next(
        (o for o in observations if o.get("tool") == "list_containers"),
        None
    )
    if container_obs:
        container_output = container_obs.get("output", "")
        evidence_list.append({
            "id": f"EV-{len(evidence_list)+1:03d}",
            "source": "infrastructure",
            "label": "Container / service status",
            "detail": f"Container inspection for '{repo}': {str(container_output)[:300]}",
            "metadata": {"repo": repo, "source": "docker"}
        })

    logger.info(f"Evidence analyzer produced {len(evidence_list)} evidence items for {repo}")

    return {
        "evidence": evidence_list,
        "current_step": "root_cause_analysis"
    }
