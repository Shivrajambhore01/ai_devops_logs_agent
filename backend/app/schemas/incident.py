from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field

class IncidentBase(BaseModel):
    title: str
    description: Optional[str] = None
    severity: str = "HIGH"
    service_name: Optional[str] = None
    deployment_id: Optional[str] = None
    commit_sha: Optional[str] = None
    branch: Optional[str] = "main"

class IncidentCreate(IncidentBase):
    repository_id: Optional[int] = None

class IncidentUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    root_cause: Optional[str] = None
    confidence: Optional[float] = None

class EvidenceSchema(BaseModel):
    id: str
    source: str
    label: str
    detail: str
    metadata_json: dict
    timestamp: datetime

    class Config:
        from_attributes = True

class IncidentResponse(IncidentBase):
    id: str
    repository_id: int
    status: str
    root_cause: Optional[str] = None
    confidence: float = 0.0
    created_at: datetime
    resolved_at: Optional[datetime] = None
    evidence_items: List[EvidenceSchema] = []

    class Config:
        from_attributes = True
