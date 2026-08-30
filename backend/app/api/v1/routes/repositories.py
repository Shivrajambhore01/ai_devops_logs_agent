from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_current_user_optional
from app.models.user import User
from app.models.repository import Repository
from app.schemas.repository import RepositoryCreate, RepositoryResponse
from app.tools.github.client import get_github_client

router = APIRouter(prefix="/repositories", tags=["Repositories"])

@router.get("", response_model=List[RepositoryResponse])
@router.get("/", response_model=List[RepositoryResponse])
async def list_repositories(
    current_user: User = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Repository)
        .where(Repository.user_id == current_user.id)
        .order_by(Repository.created_at.desc())
    )
    return result.scalars().all()

@router.post("", response_model=RepositoryResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=RepositoryResponse, status_code=status.HTTP_201_CREATED)
async def connect_repository(
    payload: RepositoryCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    owner_and_repo = f"{payload.owner}/{payload.name}"
    gh_client = get_github_client(current_user.github_token)
    
    # 1. Validate repository existence via GitHub API if client is configured
    if gh_client.is_configured():
        try:
            gh_repo = gh_client.get_repo(owner_and_repo)
            payload.default_branch = gh_repo.default_branch
            payload.language = gh_repo.language or payload.language
        except Exception as err:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"GitHub repository '{owner_and_repo}' could not be verified on GitHub: {str(err)}"
            )

    # 2. Check if repository is already connected for this user
    existing = await db.execute(
        select(Repository).where(
            Repository.owner == payload.owner,
            Repository.name == payload.name,
            Repository.user_id == current_user.id
        )
    )
    repo = existing.scalar_one_or_none()
    if repo:
        return repo

    repo = Repository(
        user_id=current_user.id,
        name=payload.name,
        owner=payload.owner,
        github_url=payload.github_url or f"https://github.com/{owner_and_repo}",
        default_branch=payload.default_branch or "main",
        language=payload.language or "TypeScript",
        status="healthy"
    )
    db.add(repo)
    await db.commit()
    await db.refresh(repo)
    return repo

from app.tools.github.branches import get_repository_branches

@router.get("/{repo_id}/branches", response_model=List[str])
async def list_repository_branches(
    repo_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Repository).where(
            Repository.id == repo_id,
            Repository.user_id == current_user.id
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail=f"Repository #{repo_id} not found")
    
    return get_repository_branches(
        owner=repo.owner,
        repo_name=repo.name,
        token=current_user.github_token
    )


