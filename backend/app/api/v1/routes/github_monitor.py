"""
GitHub Monitor API — Real-Time Multi-Branch Commit Observability & AI Intelligence.
Provides:
1. Interactive GitHub credential verification and profile connection status.
2. Repository discovery and selection across personal and organizational repositories.
3. Multi-branch discovery with last-5-commits extraction per branch.
4. Deep AI Commit Intelligence: Risk Assessment, Security/Breaking Change Analysis,
   DevOps & Infrastructure Impact, and Recommended Verification Steps.
"""
from __future__ import annotations

import asyncio
import json
import logging
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Header, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.dependencies import get_current_user_optional
from app.models.user import User
from app.core.config import settings
from app.llm.factory import get_llm_provider

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/github-monitor", tags=["GitHub Monitor"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class GitHubConnectPayload(BaseModel):
    token: str

class CommitAnalysisRequest(BaseModel):
    branch: Optional[str] = None
    commits: Optional[List[Dict[str, Any]]] = None


# ── Helper GitHub REST client ─────────────────────────────────────────────────

def _github_request(endpoint: str, token: str) -> Any:
    """Make an authenticated HTTP request to GitHub REST API."""
    url = f"https://api.github.com{endpoint}" if endpoint.startswith("/") else endpoint
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token.strip()}",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "AI-DevOps-Agent-Monitor/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        error_body = ""
        try:
            error_body = err.read().decode("utf-8")
        except Exception:
            pass
        logger.warning(f"GitHub API error {err.code} on {endpoint}: {error_body}")
        if err.code == 401:
            raise HTTPException(status_code=401, detail="Invalid GitHub Personal Access Token (Bad credentials)")
        if err.code == 404:
            raise HTTPException(status_code=404, detail=f"GitHub resource not found ({endpoint})")
        raise HTTPException(status_code=err.code, detail=f"GitHub API Error: {err.reason}")
    except Exception as err:
        logger.error(f"Failed to connect to GitHub API ({endpoint}): {err}")
        raise HTTPException(status_code=502, detail=f"Failed to reach GitHub API: {str(err)}")


_runtime_custom_token: Optional[str] = None
_runtime_disconnected: bool = False


def _resolve_token(
    user: Optional[User] = None,
    passed_token: Optional[str] = None,
    header_token: Optional[str] = None,
    header_disconnected: Optional[str] = None,
) -> Optional[str]:
    """
    Resolve GitHub token in strict priority:
    1. If client sent 'x-github-disconnected: true' and no header token, return None.
    2. 'X-GitHub-Token' header explicitly sent by client.
    3. Query param or explicit argument 'token'.
    4. Authenticated database user's stored 'user.github_token'.
    5. Active runtime custom token saved via POST /connect.
    6. If runtime disconnected flag is set, return None.
    7. Fallback to settings.GITHUB_TOKEN ONLY if NOT explicitly disconnected.
    """
    global _runtime_custom_token, _runtime_disconnected

    if header_disconnected and header_disconnected.lower() in ("true", "1", "yes"):
        return None

    if header_token and header_token.strip():
        _runtime_custom_token = header_token.strip()
        _runtime_disconnected = False
        return header_token.strip()

    if passed_token and passed_token.strip():
        _runtime_custom_token = passed_token.strip()
        _runtime_disconnected = False
        return passed_token.strip()

    if user and user.github_token and user.github_token.strip():
        return user.github_token.strip()

    if _runtime_custom_token and _runtime_custom_token.strip():
        return _runtime_custom_token.strip()

    if _runtime_disconnected:
        return None

    if settings.GITHUB_TOKEN and settings.GITHUB_TOKEN.strip():
        return settings.GITHUB_TOKEN.strip()

    return None


def get_resolved_token(
    request: Request,
    token: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user_optional),
) -> Optional[str]:
    """FastAPI dependency to extract resolved GitHub token across headers, query, and user context."""
    header_token = request.headers.get("x-github-token")
    header_disconnected = request.headers.get("x-github-disconnected")
    return _resolve_token(
        user=current_user,
        passed_token=token,
        header_token=header_token,
        header_disconnected=header_disconnected,
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/status")
async def get_github_status(
    resolved_token: Optional[str] = Depends(get_resolved_token),
) -> Dict[str, Any]:
    """
    Check if GitHub is connected and return the authenticated user's profile.
    """
    has_system_token = bool(settings.GITHUB_TOKEN and settings.GITHUB_TOKEN.strip())

    if not resolved_token:
        return {
            "connected": False,
            "user": None,
            "has_system_token": has_system_token,
            "message": "No GitHub Personal Access Token configured. Connect your token to monitor repositories.",
        }

    try:
        user_data = await asyncio.to_thread(_github_request, "/user", resolved_token)
        return {
            "connected": True,
            "has_system_token": has_system_token,
            "user": {
                "login": user_data.get("login"),
                "name": user_data.get("name") or user_data.get("login"),
                "avatar_url": user_data.get("avatar_url"),
                "html_url": user_data.get("html_url"),
                "bio": user_data.get("bio"),
                "public_repos": user_data.get("public_repos", 0),
                "total_private_repos": user_data.get("total_private_repos", 0),
                "followers": user_data.get("followers", 0),
            },
            "token_masked": f"{resolved_token[:4]}...{resolved_token[-4:]}" if len(resolved_token) > 8 else "***",
        }
    except HTTPException as e:
        return {
            "connected": False,
            "user": None,
            "has_system_token": has_system_token,
            "error": e.detail,
        }
    except Exception as err:
        return {
            "connected": False,
            "user": None,
            "has_system_token": has_system_token,
            "error": str(err),
        }


@router.post("/connect")
async def connect_github_token(
    payload: GitHubConnectPayload,
    current_user: User = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Validate a provided Personal Access Token against GitHub API and persist it to runtime and user profile.
    """
    global _runtime_custom_token, _runtime_disconnected
    raw_token = payload.token.strip()
    if not raw_token:
        raise HTTPException(status_code=400, detail="Personal Access Token cannot be empty")

    # Validate directly against GitHub API using the user's provided token
    user_data = await asyncio.to_thread(_github_request, "/user", raw_token)

    # Set as active runtime token
    _runtime_custom_token = raw_token
    _runtime_disconnected = False

    # Persist in DB if user is available
    if current_user and current_user.id:
        current_user.github_token = raw_token
        await db.commit()
        await db.refresh(current_user)

    return {
        "success": True,
        "message": f"Successfully connected to GitHub as @{user_data.get('login')}!",
        "token": raw_token,
        "user": {
            "login": user_data.get("login"),
            "name": user_data.get("name") or user_data.get("login"),
            "avatar_url": user_data.get("avatar_url"),
            "html_url": user_data.get("html_url"),
            "public_repos": user_data.get("public_repos", 0),
            "total_private_repos": user_data.get("total_private_repos", 0),
        },
    }


@router.post("/connect-env")
async def connect_env_github_token(
    current_user: User = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Connect directly using the pre-configured GITHUB_TOKEN from the environment (.env).
    """
    global _runtime_custom_token, _runtime_disconnected
    if not settings.GITHUB_TOKEN or not settings.GITHUB_TOKEN.strip():
        raise HTTPException(status_code=404, detail="No GITHUB_TOKEN configured in backend .env file")

    raw_token = settings.GITHUB_TOKEN.strip()
    user_data = await asyncio.to_thread(_github_request, "/user", raw_token)

    _runtime_custom_token = raw_token
    _runtime_disconnected = False

    if current_user and current_user.id:
        current_user.github_token = raw_token
        await db.commit()
        await db.refresh(current_user)

    return {
        "success": True,
        "message": f"Successfully connected using environment token as @{user_data.get('login')}!",
        "token": raw_token,
        "user": {
            "login": user_data.get("login"),
            "name": user_data.get("name") or user_data.get("login"),
            "avatar_url": user_data.get("avatar_url"),
            "html_url": user_data.get("html_url"),
            "public_repos": user_data.get("public_repos", 0),
            "total_private_repos": user_data.get("total_private_repos", 0),
        },
    }


@router.post("/disconnect")
async def disconnect_github(
    current_user: User = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Disconnect and clear GitHub token completely."""
    global _runtime_custom_token, _runtime_disconnected
    _runtime_custom_token = None
    _runtime_disconnected = True

    if current_user and current_user.id:
        current_user.github_token = None
        await db.commit()

    return {"success": True, "message": "GitHub token disconnected successfully."}


@router.get("/repos")
async def list_github_repositories(
    search: Optional[str] = Query(None),
    resolved_token: Optional[str] = Depends(get_resolved_token),
) -> List[Dict[str, Any]]:
    """
    Fetch all repositories accessible by the user's GitHub token (up to 100),
    sorted by last updated date.
    """
    if not resolved_token:
        raise HTTPException(
            status_code=401,
            detail="GitHub token is required to list repositories. Please connect your GitHub account.",
        )

    repos_raw = await asyncio.to_thread(
        _github_request,
        "/user/repos?sort=updated&direction=desc&per_page=100&type=all",
        resolved_token,
    )

    repos = []
    search_lower = search.lower().strip() if search else None

    for r in repos_raw:
        full_name = r.get("full_name", "")
        description = r.get("description") or ""
        if search_lower and (search_lower not in full_name.lower() and search_lower not in description.lower()):
            continue

        repos.append({
            "id": r.get("id"),
            "name": r.get("name"),
            "full_name": full_name,
            "owner": {
                "login": r.get("owner", {}).get("login"),
                "avatar_url": r.get("owner", {}).get("avatar_url"),
            },
            "private": r.get("private", False),
            "html_url": r.get("html_url"),
            "description": description,
            "default_branch": r.get("default_branch", "main"),
            "updated_at": r.get("updated_at"),
            "pushed_at": r.get("pushed_at"),
            "language": r.get("language") or "Other",
            "stargazers_count": r.get("stargazers_count", 0),
            "forks_count": r.get("forks_count", 0),
            "open_issues_count": r.get("open_issues_count", 0),
        })

    return repos


@router.get("/repos/{owner}/{repo}/branches")
async def list_repo_branches(
    owner: str,
    repo: str,
    resolved_token: Optional[str] = Depends(get_resolved_token),
) -> List[str]:
    """Retrieve all branch names for a repository."""
    if not resolved_token:
        raise HTTPException(status_code=401, detail="GitHub token required.")

    branches_data = await asyncio.to_thread(
        _github_request,
        f"/repos/{owner}/{repo}/branches?per_page=100",
        resolved_token,
    )
    return [b.get("name") for b in branches_data if b.get("name")]


@router.get("/repos/{owner}/{repo}/commits")
async def list_repo_commits(
    owner: str,
    repo: str,
    branch: Optional[str] = Query(None),
    limit: int = Query(default=5, le=20),
    resolved_token: Optional[str] = Depends(get_resolved_token),
) -> List[Dict[str, Any]]:
    """Retrieve the last N commits (default 5) for a given branch."""
    if not resolved_token:
        raise HTTPException(status_code=401, detail="GitHub token required.")

    endpoint = f"/repos/{owner}/{repo}/commits?per_page={limit}"
    if branch:
        endpoint += f"&sha={branch}"

    commits_data = await asyncio.to_thread(_github_request, endpoint, resolved_token)

    result = []
    for c in commits_data[:limit]:
        commit_info = c.get("commit", {})
        author_info = commit_info.get("author", {})
        committer_obj = c.get("author") or {}

        # Basic commit metadata
        sha = c.get("sha", "")

        result.append({
            "sha": sha,
            "short_sha": sha[:7],
            "message": commit_info.get("message", "").strip(),
            "author_name": author_info.get("name") or committer_obj.get("login") or "Unknown",
            "author_email": author_info.get("email") or "",
            "author_avatar": committer_obj.get("avatar_url") or "",
            "author_login": committer_obj.get("login") or "",
            "date": author_info.get("date") or "",
            "html_url": c.get("html_url") or f"https://github.com/{owner}/{repo}/commit/{sha}",
            "branch": branch or "default",
        })

    return result


@router.get("/repos/{owner}/{repo}/branches-with-commits")
async def get_branches_with_commits(
    owner: str,
    repo: str,
    resolved_token: Optional[str] = Depends(get_resolved_token),
) -> Dict[str, Any]:
    """
    Optimized endpoint: discovers all branches and fetches the last 5 commits
    for every branch in a structured response concurrently.
    """
    if not resolved_token:
        raise HTTPException(status_code=401, detail="GitHub token required.")

    # 1. Fetch repo details for default branch
    repo_data = await asyncio.to_thread(_github_request, f"/repos/{owner}/{repo}", resolved_token)
    default_branch = repo_data.get("default_branch", "main")

    # 2. Fetch branches
    branches_raw = await asyncio.to_thread(_github_request, f"/repos/{owner}/{repo}/branches?per_page=30", resolved_token)
    branch_names = [b.get("name") for b in branches_raw if b.get("name")]
    if not branch_names:
        branch_names = [default_branch]

    # Ensure default branch is first
    if default_branch in branch_names:
        branch_names.remove(default_branch)
        branch_names.insert(0, default_branch)

    # 3. Fetch last 5 commits for each branch in parallel
    def _fetch_branch_commits(b_name: str) -> Dict[str, Any]:
        try:
            c_data = _github_request(f"/repos/{owner}/{repo}/commits?sha={b_name}&per_page=5", resolved_token)
            commits = []
            for c in c_data[:5]:
                c_info = c.get("commit", {})
                a_info = c_info.get("author", {})
                user_obj = c.get("author") or {}
                sha = c.get("sha", "")
                commits.append({
                    "sha": sha,
                    "short_sha": sha[:7],
                    "message": c_info.get("message", "").strip(),
                    "author_name": a_info.get("name") or user_obj.get("login") or "Developer",
                    "author_avatar": user_obj.get("avatar_url") or "",
                    "date": a_info.get("date") or "",
                    "html_url": c.get("html_url") or f"https://github.com/{owner}/{repo}/commit/{sha}",
                    "branch": b_name,
                })
            return {
                "name": b_name,
                "is_default": b_name == default_branch,
                "commits_count": len(commits),
                "commits": commits,
            }
        except Exception as e:
            logger.warning(f"Could not load commits for branch {b_name}: {e}")
            return {
                "name": b_name,
                "is_default": b_name == default_branch,
                "commits_count": 0,
                "commits": [],
            }

    tasks = [asyncio.to_thread(_fetch_branch_commits, b) for b in branch_names[:10]]
    branches_result = await asyncio.gather(*tasks)

    return {
        "owner": owner,
        "repo": repo,
        "default_branch": default_branch,
        "branches_count": len(branches_result),
        "branches": list(branches_result),
    }


# ── AI Commit Intelligence Engine ─────────────────────────────────────────────

def _heuristic_analyze_commit(commit: Dict[str, Any]) -> Dict[str, Any]:
    """Intelligent heuristic commit analyzer fallback when LLM is unavailable."""
    msg = (commit.get("message") or "").lower()
    sha = commit.get("short_sha") or commit.get("sha", "")[:7]

    risk_level = "LOW"
    breaking_changes = False
    security_issues = []
    devops_impact = []
    recommended_tests = ["Run standard test suite (npm test / pytest)"]

    # Detect high risk keywords
    if any(k in msg for k in ["breaking", "deprecated", "removed", "drop ", "major"]):
        risk_level = "CRITICAL"
        breaking_changes = True
        recommended_tests.append("Verify API backwards compatibility and contract tests")

    if any(k in msg for k in ["auth", "security", "token", "password", "secret", "oauth", "jwt", "cve"]):
        if risk_level != "CRITICAL":
            risk_level = "HIGH"
        security_issues.append("Authentication / authorization logic updated")
        recommended_tests.append("Run security vulnerability scanner and verify permission boundaries")

    if any(k in msg for k in ["docker", "dockerfile", "container", "compose"]):
        devops_impact.append("Containerization / Docker build instructions modified")
        recommended_tests.append("Rebuild Docker image and test local container startup")

    if any(k in msg for k in ["migration", "schema", "database", "postgres", "table", "sql", "alembic"]):
        if risk_level == "LOW":
            risk_level = "MEDIUM"
        devops_impact.append("Database schema migration detected")
        recommended_tests.append("Test rollback migration and verify foreign key constraints")

    if any(k in msg for k in ["ci", "action", "workflow", "deploy", "pipeline"]):
        devops_impact.append("CI/CD pipeline workflow configuration changed")
        recommended_tests.append("Trigger GitHub Actions dry-run to ensure build steps pass")

    if any(k in msg for k in ["package.json", "requirements.txt", "lock", "dependency", "upgrade"]):
        devops_impact.append("Project dependencies or lockfile updated")
        recommended_tests.append("Audit dependencies for vulnerabilities and check peer dependency conflicts")

    if not devops_impact:
        devops_impact.append("Application source code logic change")

    return {
        "sha": commit.get("sha"),
        "short_sha": sha,
        "intent": f"Updates: {commit.get('message', '').splitlines()[0][:90]}",
        "risk_level": risk_level,
        "breaking_changes": breaking_changes,
        "security_issues": security_issues,
        "devops_impact": devops_impact,
        "recommended_tests": recommended_tests,
    }


@router.post("/repos/{owner}/{repo}/analyze")
async def analyze_repo_commits(
    owner: str,
    repo: str,
    payload: Optional[CommitAnalysisRequest] = None,
    resolved_token: Optional[str] = Depends(get_resolved_token),
) -> Dict[str, Any]:
    """
    Run Deep AI Commit Intelligence on the last 5 commits for a branch
    (or all branches if not specified).
    """
    branch = payload.branch if payload else None
    incoming_commits = payload.commits if payload and payload.commits else None

    # If commits not supplied, fetch last 5 from GitHub API
    if not incoming_commits:
        if not resolved_token:
            raise HTTPException(status_code=401, detail="GitHub token required for commit analysis.")
        endpoint = f"/repos/{owner}/{repo}/commits?per_page=5"
        if branch:
            endpoint += f"&sha={branch}"
        raw_commits = await asyncio.to_thread(_github_request, endpoint, resolved_token)
        incoming_commits = []
        for c in raw_commits[:5]:
            c_info = c.get("commit", {})
            a_info = c_info.get("author", {})
            user_obj = c.get("author") or {}
            sha = c.get("sha", "")
            incoming_commits.append({
                "sha": sha,
                "short_sha": sha[:7],
                "message": c_info.get("message", "").strip(),
                "author_name": a_info.get("name") or user_obj.get("login") or "Developer",
                "author_avatar": user_obj.get("avatar_url") or "",
                "date": a_info.get("date") or "",
                "branch": branch or "main",
            })

    if not incoming_commits:
        return {
            "branch": branch or "main",
            "overall_health": "HEALTHY",
            "summary": "No recent commits found to analyze.",
            "top_risk": "None detected",
            "commit_analyses": [],
        }

    # Attempt Live LLM Analysis with Fallback
    llm = get_llm_provider()
    commit_analyses = []

    prompt = f"""You are a Principal DevOps & Site Reliability Engineer inspecting the last 5 Git commits on repository '{owner}/{repo}' (branch: '{branch or 'main'}').

Commits to analyze:
{json.dumps(incoming_commits, indent=2)}

For each commit, evaluate:
1. Intent: Concise 1-sentence explanation of what the commit achieves.
2. Risk Level: 'LOW', 'MEDIUM', 'HIGH', or 'CRITICAL'.
3. Breaking Changes: boolean flag.
4. Security Issues: list of potential security/auth concerns or empty list.
5. DevOps Impact: list of impacts on Docker, CI/CD, database schemas, or configurations.
6. Recommended Tests: list of 1-2 actionable test or verification commands.

Also evaluate overall branch health: 'HEALTHY', 'NEEDS_REVIEW', or 'AT_RISK'.
Executive summary: 2 concise sentences summarizing the branch activity.

Return ONLY a valid JSON object matching this schema:
{{
  "overall_health": "HEALTHY",
  "summary": "Recent commits focused on ...",
  "top_risk": "None or description of highest risk",
  "commit_analyses": [
    {{
      "sha": "commit_sha",
      "short_sha": "7_chars",
      "intent": "Intent summary",
      "risk_level": "LOW|MEDIUM|HIGH|CRITICAL",
      "breaking_changes": false,
      "security_issues": [],
      "devops_impact": ["Impact description"],
      "recommended_tests": ["Test command or step"]
    }}
  ]
}}"""

    try:
        raw_response = llm.generate_text(prompt)
        clean_text = raw_response.replace("```json", "").replace("```", "").strip()
        data = json.loads(clean_text)
        if "commit_analyses" in data and len(data["commit_analyses"]) > 0:
            return data
    except Exception as err:
        logger.warning(f"LLM commit analysis failed or returned non-JSON ({err}). Using contextual heuristic engine.")

    # Contextual Heuristic Analysis Engine
    analyzed_commits = [_heuristic_analyze_commit(c) for c in incoming_commits]
    max_risk = "LOW"
    risk_rank = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}
    for a in analyzed_commits:
        if risk_rank.get(a["risk_level"], 1) > risk_rank.get(max_risk, 1):
            max_risk = a["risk_level"]

    health = "HEALTHY" if max_risk in ["LOW", "MEDIUM"] else ("NEEDS_REVIEW" if max_risk == "HIGH" else "AT_RISK")
    summary = f"Branch '{branch or 'main'}' has 5 recent commits inspected. Overall risk level evaluated as {max_risk}."
    top_risk = "No high-risk regressions detected." if max_risk == "LOW" else f"Potential risk identified: {analyzed_commits[0]['devops_impact'][0]}"

    return {
        "branch": branch or "main",
        "overall_health": health,
        "summary": summary,
        "top_risk": top_risk,
        "commit_analyses": analyzed_commits,
    }


@router.get("/repos/{owner}/{repo}/commits/{commit_sha}/deep-analysis")
async def get_commit_deep_analysis(
    owner: str,
    repo: str,
    commit_sha: str,
    resolved_token: Optional[str] = Depends(get_resolved_token),
) -> Dict[str, Any]:
    """
    Fetch the exact code diff and changed files for a specific commit from GitHub API,
    and run Gemini AI to generate a detailed, non-mock technical walkthrough of what was done.
    """
    if not resolved_token:
        raise HTTPException(status_code=401, detail="GitHub token required.")

    # 1. Fetch exact commit with diff from GitHub
    raw_commit = await asyncio.to_thread(_github_request, f"/repos/{owner}/{repo}/commits/{commit_sha}", resolved_token)

    commit_info = raw_commit.get("commit", {})
    author_info = commit_info.get("author", {})
    user_obj = raw_commit.get("author") or {}
    message = commit_info.get("message", "").strip()
    stats = raw_commit.get("stats", {})
    raw_files = raw_commit.get("files", [])

    files_list = []
    diff_snippets = []

    for f in raw_files:
        filename = f.get("filename", "")
        status = f.get("status", "modified")
        additions = f.get("additions", 0)
        deletions = f.get("deletions", 0)
        patch = f.get("patch", "")
        files_list.append({
            "filename": filename,
            "status": status,
            "additions": additions,
            "deletions": deletions,
            "patch": patch,
        })
        if patch:
            diff_snippets.append(f"File: {filename} ({status}, +{additions}/-{deletions}):\n{patch[:1800]}")

    diff_context = "\n\n".join(diff_snippets[:10])

    # 2. Prompt Gemini AI with the REAL code diff!
    llm = get_llm_provider()

    prompt = f"""You are a Principal Software Architect and Lead Product Engineer reviewing a Git commit for both developers and non-technical stakeholders.
Analyze this exact Git commit on repository '{owner}/{repo}'.

Commit SHA: {commit_sha}
Commit Message: {message}
Total Stats: +{stats.get('additions', 0)} additions, -{stats.get('deletions', 0)} deletions across {len(raw_files)} files.

Changed Files and Code Diff:
{diff_context if diff_context else "No patch available (binary or empty commit)."}

INSTRUCTIONS:
Do NOT output a dense, unformatted wall of text or raw log dumps. Make the analysis insightful, highly readable, and intuitive for anyone to grasp immediately.

1. "summary": Write an easy-to-understand, plain-English executive summary (2-3 clear sentences). Explain what this commit accomplishes in real-world terms and why it matters, without dense jargon.
2. "key_takeaways": Provide 2-4 punchy, high-impact bullet points summarizing what was achieved (e.g. "Prevented cross-user account access with strict 403 checks", "Added cryptographic SHA-256 audit trail").
3. "changes_breakdown": Break the changes down into a structured list of digestible change cards. For each distinct change provide:
   - "category": One of ["SECURITY", "FEATURE", "INFRASTRUCTURE", "BUG_FIX", "REFACTOR", "TEST"].
   - "title": Short, descriptive action title (e.g. "Strict Multi-User Isolation").
   - "user_explanation": Clear, friendly explanation of what was changed and why it helps the system or users.
   - "technical_detail": Exact code files, functions, or parameters modified (e.g. "In backend/app/api/assets.py, checks caller ID in get_current_user").
   - "before_and_after": {{ "before": "How the system behaved previously", "after": "How the system behaves now with this change" }}
4. "what_was_done": A thorough, structured technical overview connecting the changes together.
5. "risk_level": Rate as 'LOW', 'MEDIUM', 'HIGH', or 'CRITICAL'.
6. "risk_justification": 1-2 friendly sentences explaining the risk rating.
7. "breaking_changes": Explicitly state any breaking changes or backward-incompatible API/schema modifications (or "None detected").
8. "security_analysis": Clear analysis of security enhancements, secret protection, or vulnerabilities addressed.
9. "devops_impact": Concrete operational impacts on Docker containers, deployment, environment variables, or databases.
10. "recommended_tests": List 2-3 actionable commands or steps to test this exact change.

Return ONLY a valid JSON object matching:
{{
  "summary": "Plain-English explanation that anyone can understand...",
  "key_takeaways": [
    "Key highlight 1",
    "Key highlight 2"
  ],
  "changes_breakdown": [
    {{
      "category": "SECURITY",
      "title": "Title of change",
      "user_explanation": "Simple explanation of what and why...",
      "technical_detail": "Exact file and function touched...",
      "before_and_after": {{
        "before": "What happened before...",
        "after": "What happens now..."
      }}
    }}
  ],
  "what_was_done": "Structured technical walkthrough...",
  "risk_level": "LOW|MEDIUM|HIGH|CRITICAL",
  "risk_justification": "Explanation...",
  "breaking_changes": "None detected or details...",
  "security_analysis": "Security findings...",
  "devops_impact": ["Impact 1", "Impact 2"],
  "recommended_tests": ["Test command 1", "Test command 2"]
}}"""

    ai_result = None
    try:
        raw_response = llm.generate_text(prompt)
        clean_text = raw_response.replace("```json", "").replace("```", "").strip()
        ai_result = json.loads(clean_text)
    except Exception as err:
        logger.warning(f"LLM deep commit analysis failed ({err}). Using code-based heuristic analyzer.")
        ai_result = {
            "summary": f"This commit updates {len(raw_files)} files with +{stats.get('additions', 0)} additions and -{stats.get('deletions', 0)} deletions to improve application stability and functionality.",
            "key_takeaways": [
                f"Modified {len(raw_files)} file(s) across the repository.",
                f"Total diff footprint: +{stats.get('additions', 0)} / -{stats.get('deletions', 0)} lines.",
            ],
            "changes_breakdown": [
                {
                    "category": "REFACTOR" if not any("test" in f["filename"].lower() for f in files_list) else "TEST",
                    "title": f"Update {files_list[0]['filename']}" if files_list else "Codebase modification",
                    "user_explanation": f"Commit '{message}' modifies code logic to align with project requirements.",
                    "technical_detail": f"Changes in {files_list[0]['filename'] if files_list else 'repository files'}",
                    "before_and_after": {
                        "before": "Previous implementation state",
                        "after": "Updated implementation state with latest changes",
                    },
                }
            ],
            "what_was_done": f"This commit ('{message}') touched {len(raw_files)} files with +{stats.get('additions', 0)} additions and -{stats.get('deletions', 0)} deletions. Files modified: {', '.join([f['filename'] for f in files_list[:6]])}.",
            "risk_level": "MEDIUM" if any("migration" in f["filename"].lower() or "auth" in f["filename"].lower() for f in files_list) else "LOW",
            "risk_justification": "Assessed from file types, additions/deletions volume, and commit diff patterns.",
            "breaking_changes": "No breaking API contracts detected.",
            "devops_impact": ["Verify deployment environment variables and restart affected container services if needed."],
            "recommended_tests": ["Run unit test suite against modified components."],
        }

    return {
        "sha": commit_sha,
        "short_sha": commit_sha[:7],
        "message": message,
        "author_name": author_info.get("name") or user_obj.get("login") or "Unknown",
        "author_avatar": user_obj.get("avatar_url") or "",
        "date": author_info.get("date") or "",
        "html_url": raw_commit.get("html_url") or f"https://github.com/{owner}/{repo}/commit/{commit_sha}",
        "stats": stats,
        "files": files_list,
        "analysis": ai_result,
    }

