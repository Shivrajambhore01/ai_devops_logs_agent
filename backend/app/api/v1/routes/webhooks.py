from typing import Dict, Any
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.user import User
from app.models.incident import Incident
from app.models.repository import Repository

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])

@router.post("/github", status_code=status.HTTP_200_OK)
async def github_webhook_handler(
    request: Request,
    x_github_event: str = Header(None),
    db: AsyncSession = Depends(get_db)
):
    payload: Dict[str, Any] = await request.json()
    
    if x_github_event == "workflow_run":
        action = payload.get("action")
        workflow_run = payload.get("workflow_run", {})
        conclusion = workflow_run.get("conclusion")
        
        if action == "completed" and conclusion == "failure":
            repo_data = payload.get("repository", {})
            repo_name = repo_data.get("name", "unknown")
            repo_url = repo_data.get("html_url", "")
            
            # Find or create repository
            result = await db.execute(select(Repository).where(Repository.name == repo_name))
            repo = result.scalar_one_or_none()
            if not repo:
                user_res = await db.execute(select(User.id))
                default_user_id = user_res.scalars().first() or 1
                repo = Repository(
                    user_id=default_user_id,
                    name=repo_name,
                    owner=repo_data.get("owner", {}).get("login", "acme"),
                    github_url=repo_url,
                    status="degraded"
                )
                db.add(repo)
                await db.commit()
                await db.refresh(repo)

            # Auto-create Incident
            count_result = await db.execute(select(Incident))
            count = len(count_result.scalars().all()) + 1024
            incident_id = f"INC-{count}"

            incident = Incident(
                id=incident_id,
                user_id=repo.user_id,
                title=f"Deployment Failure in {repo_name}",
                description=f"Workflow run #{workflow_run.get('id')} failed during deployment step.",
                severity="HIGH",
                repository_id=repo.id,
                service_name=repo_name,
                deployment_id=str(workflow_run.get("id")),
                commit_sha=workflow_run.get("head_sha", "")[:7],
                status="INVESTIGATING"
            )
            db.add(incident)
            await db.commit()
            
            return {
                "status": "incident_created",
                "incident_id": incident_id,
                "message": f"Deployment failure detected. Created incident {incident_id}"
            }
            
    return {"status": "ignored", "event": x_github_event}
