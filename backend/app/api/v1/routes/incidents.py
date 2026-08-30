from typing import List, Optional
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_current_user_optional
from app.models.user import User
from app.models.incident import Incident
from app.models.evidence import Evidence
from app.models.repository import Repository
from app.schemas.incident import IncidentCreate, IncidentResponse
from app.agents import incident_agent_app
from app.tools.github.client import get_github_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/incidents", tags=["Incidents"])


async def _fetch_all_incidents(db: AsyncSession, user_id: int):
    result = await db.execute(
        select(Incident)
        .options(selectinload(Incident.evidence_items))
        .where(Incident.user_id == user_id)
        .order_by(Incident.created_at.desc())
    )
    return result.scalars().all()


# Handle both /incidents and /incidents/ since redirect_slashes=False on the app
@router.get("", response_model=List[IncidentResponse])
@router.get("/", response_model=List[IncidentResponse])
async def list_incidents(
    current_user: User = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db)
):
    return await _fetch_all_incidents(db, current_user.id)


from app.tools.github.commits import get_recent_commits, get_commit_diff

@router.post("", response_model=IncidentResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=IncidentResponse, status_code=status.HTTP_201_CREATED)
async def create_incident(
    payload: IncidentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    repo = None
    gh_client = get_github_client(current_user.github_token)
    target_branch = payload.branch or "main"

    # Step 1 — Find repo by explicit repository_id belonging to current user
    if payload.repository_id:
        repo_res = await db.execute(
            select(Repository).where(
                Repository.id == payload.repository_id,
                Repository.user_id == current_user.id
            )
        )
        repo = repo_res.scalar_one_or_none()

    # Step 2 — Resolve by service_name ("owner/repo" or plain "repo") for current user
    if not repo and payload.service_name:
        service_name = payload.service_name.strip()
        if "/" in service_name:
            owner_part, repo_part = service_name.split("/", 1)
            repo_res = await db.execute(
                select(Repository).where(
                    Repository.owner == owner_part,
                    Repository.name == repo_part,
                    Repository.user_id == current_user.id
                )
            )
            repo = repo_res.scalar_one_or_none()
            if not repo:
                repo_res = await db.execute(
                    select(Repository).where(
                        Repository.name == repo_part,
                        Repository.user_id == current_user.id
                    )
                )
                repo = repo_res.scalar_one_or_none()
        else:
            repo_res = await db.execute(
                select(Repository).where(
                    Repository.name == service_name,
                    Repository.user_id == current_user.id
                )
            )
            repo = repo_res.scalar_one_or_none()

    # Step 3 — Create a new repo entry from service_name for current user
    if not repo:
        if not payload.service_name:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Either a valid repository_id or service_name must be provided."
            )
        service_name = payload.service_name.strip()
        owner_name, repo_name = service_name.split("/", 1) if "/" in service_name else ("unknown", service_name)

        logger.info(f"No existing repo found for '{service_name}' for user {current_user.id} — creating new DB entry.")
        default_branch, language = target_branch, "Unknown"
        if gh_client.is_configured():
            try:
                gh_repo = gh_client.get_repo(f"{owner_name}/{repo_name}")
                default_branch = gh_repo.default_branch or target_branch
                language = gh_repo.language or "Unknown"
            except Exception as err:
                logger.warning(f"GitHub lookup failed for {owner_name}/{repo_name}: {err}")

        repo = Repository(
            user_id=current_user.id,
            name=repo_name,
            owner=owner_name,
            github_url=f"https://github.com/{owner_name}/{repo_name}",
            default_branch=default_branch,
            language=language,
            status="healthy"
        )
        db.add(repo)
        await db.commit()
        await db.refresh(repo)

    target_repo_full = f"{repo.owner}/{repo.name}"
    logger.info(f"Creating incident against repository: {target_repo_full} (branch: {target_branch}) for user: {current_user.email}")

    # Fetch last 5 commits for the selected branch
    recent_5_commits = get_recent_commits(
        owner=repo.owner,
        repo_name=repo.name,
        branch=target_branch,
        limit=5,
        token=current_user.github_token
    )
    commit_sha = payload.commit_sha or (recent_5_commits[0]["commit"] if recent_5_commits else "unknown")

    # Generate unique incident ID (collision-safe)
    count_res = await db.execute(select(func.count()).select_from(Incident))
    count = (count_res.scalar() or 0) + 1024
    incident_id = f"INC-{count}"
    while True:
        existing = await db.execute(select(Incident).where(Incident.id == incident_id))
        if not existing.scalar_one_or_none():
            break
        count += 1
        incident_id = f"INC-{count}"

    # Trigger Agent Workflow
    init_state = {
        "incident_id": incident_id,
        "incident_title": payload.title,
        "repository": target_repo_full,
        "branch": target_branch,
        "service_name": repo.name,
        "deployment_id": payload.deployment_id or "deploy-live",
        "commit_sha": commit_sha,
        "recent_commits": recent_5_commits,
        "user_github_token": current_user.github_token,
        "plan": [],
        "current_step": "start",
        "observations": [],
        "evidence": [],
        "root_cause": None,
        "confidence": 0.0,
        "cited_evidence_ids": [],
        "proposed_patch": None,
        "test_passed": False,
        "test_summary": None,
        "approval_status": "PENDING",
        "pr_url": None
    }

    agent_output = incident_agent_app.invoke(init_state)

    incident = Incident(
        id=incident_id,
        user_id=current_user.id,
        title=payload.title,
        description=f"{payload.description or ''} [Branch: {target_branch}]".strip(),
        severity=payload.severity,
        repository_id=repo.id,
        service_name=target_repo_full,
        deployment_id=payload.deployment_id or "deploy-live",
        commit_sha=agent_output.get("commit_sha", commit_sha),
        status="INVESTIGATING",
        root_cause=agent_output.get("root_cause"),
        confidence=agent_output.get("confidence", 0.94)
    )
    db.add(incident)

    # 1. Add 5-Commit Analysis Report Evidence Item
    commit_summary_str = "\n".join([
        f"• [{c['commit']}] {c['message']} (Author: {c['author']}, Date: {c['date']})"
        for c in recent_5_commits
    ])
    db.add(Evidence(
        id=f"{incident_id}-EV-0",
        incident_id=incident_id,
        source="github_commit_analysis",
        label=f"Last 5 Commits Analysis Report ({target_branch})",
        detail=commit_summary_str or "No commits found on branch.",
        metadata_json={"branch": target_branch, "commits": recent_5_commits}
    ))

    # 2. Add remaining agent output evidence items
    for idx, ev in enumerate(agent_output.get("evidence", []), 1):
        ev_id = f"{incident_id}-EV-{idx}"
        db.add(Evidence(
            id=ev_id,
            incident_id=incident_id,
            source=ev.get("source", "github"),
            label=ev.get("label", "Log Signal"),
            detail=ev.get("detail", "Error trace detected"),
            metadata_json=ev.get("metadata", {})
        ))

    await db.commit()

    res = await db.execute(
        select(Incident).options(selectinload(Incident.evidence_items)).where(
            Incident.id == incident_id,
            Incident.user_id == current_user.id
        )
    )
    return res.scalar_one()


@router.get("/{incident_id}", response_model=IncidentResponse)
async def get_incident(
    incident_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Incident)
        .options(selectinload(Incident.evidence_items))
        .where(
            Incident.id == incident_id,
            Incident.user_id == current_user.id
        )
    )
    incident = result.scalar_one_or_none()
    if not incident:
        raise HTTPException(status_code=404, detail=f"Incident {incident_id} not found")
    return incident


@router.get("/{incident_id}/logs")
async def get_incident_live_logs(
    incident_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Retrieve real-time live execution logs and evidence for auto-updating UI stream."""
    result = await db.execute(
        select(Incident)
        .options(selectinload(Incident.evidence_items))
        .where(
            Incident.id == incident_id,
            Incident.user_id == current_user.id
        )
    )
    incident = result.scalar_one_or_none()
    if not incident:
        raise HTTPException(status_code=404, detail=f"Incident {incident_id} not found")

    logs = []
    logs.append({
        "timestamp": incident.created_at.isoformat(),
        "level": "INFO",
        "source": "AGENT_RUNNER",
        "message": f"Incident {incident.id} investigation initialized for target repository {incident.service_name}."
    })

    for ev in incident.evidence_items:
        logs.append({
            "timestamp": ev.timestamp.isoformat(),
            "level": "EVIDENCE",
            "source": ev.source,
            "message": f"[{ev.label}] {ev.detail}",
            "metadata": ev.metadata_json
        })

    if incident.root_cause:
        logs.append({
            "timestamp": (incident.resolved_at or incident.created_at).isoformat(),
            "level": "RCA",
            "source": "ROOT_CAUSE_ANALYZER",
            "message": f"Root Cause Analysis Complete: {incident.root_cause} (Confidence: {int(incident.confidence * 100)}%)"
        })

    return {
        "incident_id": incident.id,
        "status": incident.status,
        "logs": logs
    }


@router.delete("/{incident_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_incident(
    incident_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Permanently delete an incident and all its evidence from PostgreSQL."""
    result = await db.execute(
        select(Incident).where(
            Incident.id == incident_id,
            Incident.user_id == current_user.id
        )
    )
    incident = result.scalar_one_or_none()
    if not incident:
        raise HTTPException(status_code=404, detail=f"Incident {incident_id} not found")

    await db.execute(delete(Evidence).where(Evidence.incident_id == incident_id))
    await db.execute(delete(Incident).where(Incident.id == incident_id))
    await db.commit()
    logger.info(f"Deleted incident {incident_id} and its evidence for user {current_user.id}")
    return None


@router.post("/{incident_id}/reinvestigate", response_model=IncidentResponse)
async def reinvestigate_incident(
    incident_id: str,
    branch: Optional[str] = "main",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Re-run the AI agent investigation against the latest repository commits & code diffs."""
    result = await db.execute(
        select(Incident).where(
            Incident.id == incident_id,
            Incident.user_id == current_user.id
        )
    )
    incident = result.scalar_one_or_none()
    if not incident:
        raise HTTPException(status_code=404, detail=f"Incident {incident_id} not found")

    target_repo_full = incident.service_name or "acme/checkout-api"
    owner, repo_name = target_repo_full.split("/", 1) if "/" in target_repo_full else ("acme", target_repo_full)
    target_branch = branch or "main"

    recent_5_commits = get_recent_commits(
        owner=owner,
        repo_name=repo_name,
        branch=target_branch,
        limit=5,
        token=current_user.github_token
    )
    commit_sha = recent_5_commits[0]["commit"] if recent_5_commits else incident.commit_sha or "unknown"

    # Re-trigger Agent Workflow with fresh state
    init_state = {
        "incident_id": incident.id,
        "incident_title": incident.title,
        "repository": target_repo_full,
        "branch": target_branch,
        "service_name": repo_name,
        "deployment_id": incident.deployment_id or "deploy-live",
        "commit_sha": commit_sha,
        "recent_commits": recent_5_commits,
        "user_github_token": current_user.github_token,
        "plan": [],
        "current_step": "start",
        "observations": [],
        "evidence": [],
        "root_cause": None,
        "confidence": 0.0,
        "cited_evidence_ids": [],
        "proposed_patch": None,
        "test_passed": False,
        "test_summary": None,
        "approval_status": "PENDING",
        "pr_url": None
    }

    agent_output = incident_agent_app.invoke(init_state)

    # Update incident fields with new investigation conclusions
    incident.commit_sha = agent_output.get("commit_sha", commit_sha)
    incident.root_cause = agent_output.get("root_cause")
    incident.confidence = agent_output.get("confidence", 0.94)
    incident.status = "INVESTIGATING"

    # Refresh evidence items
    await db.execute(delete(Evidence).where(Evidence.incident_id == incident_id))

    commit_summary_str = "\n".join([
        f"• [{c['commit']}] {c['message']} (Author: {c['author']}, Date: {c['date']})"
        for c in recent_5_commits
    ])
    db.add(Evidence(
        id=f"{incident_id}-EV-0",
        incident_id=incident_id,
        source="github_commit_analysis",
        label=f"Last 5 Commits Analysis Report ({target_branch})",
        detail=commit_summary_str or "No commits found on branch.",
        metadata_json={"branch": target_branch, "commits": recent_5_commits}
    ))

    for idx, ev in enumerate(agent_output.get("evidence", []), 1):
        ev_id = f"{incident_id}-EV-{idx}"
        db.add(Evidence(
            id=ev_id,
            incident_id=incident_id,
            source=ev.get("source", "github"),
            label=ev.get("label", "Log Signal"),
            detail=ev.get("detail", "Error trace detected"),
            metadata_json=ev.get("metadata", {})
        ))

    await db.commit()

    res = await db.execute(
        select(Incident).options(selectinload(Incident.evidence_items)).where(
            Incident.id == incident_id,
            Incident.user_id == current_user.id
        )
    )
    return res.scalar_one()


