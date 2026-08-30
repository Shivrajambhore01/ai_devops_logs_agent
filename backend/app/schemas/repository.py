from datetime import datetime
from typing import Optional
from pydantic import BaseModel

class RepositoryBase(BaseModel):
    name: str
    owner: str
    github_url: str
    default_branch: str = "main"
    language: Optional[str] = "TypeScript"

class RepositoryCreate(RepositoryBase):
    pass

class RepositoryResponse(RepositoryBase):
    id: int
    status: str
    created_at: datetime

    class Config:
        from_attributes = True
