from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.models.agent_run import AgentRun
from app.models.incident import Incident
from app.schemas.agent_run import AgentRunResponse

router = APIRouter(prefix="/agent-runs", tags=["Agent Runs"])

@router.get("", response_model=List[AgentRunResponse])
@router.get("/", response_model=List[AgentRunResponse])
async def list_agent_runs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(AgentRun)
        .options(selectinload(AgentRun.tool_calls))
        .join(Incident, AgentRun.incident_id == Incident.id)
        .where(Incident.user_id == current_user.id)
        .order_by(AgentRun.created_at.desc())
    )
    return result.scalars().all()

@router.get("/{run_id}", response_model=AgentRunResponse)
async def get_agent_run(
    run_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(AgentRun)
        .options(selectinload(AgentRun.tool_calls))
        .join(Incident, AgentRun.incident_id == Incident.id)
        .where(AgentRun.id == run_id, Incident.user_id == current_user.id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail=f"Agent Run {run_id} not found")
    return run

