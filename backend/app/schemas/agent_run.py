from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel

class ToolCallSchema(BaseModel):
    id: int
    tool_name: str
    arguments_json: Dict[str, Any]
    output_summary: Optional[str]
    status: str
    created_at: datetime

    class Config:
        from_attributes = True

class AgentRunResponse(BaseModel):
    id: str
    incident_id: str
    status: str
    current_step: str
    tools_called_count: int
    evidence_count: int
    confidence_score: float
    reasoning_summary: Optional[str]
    created_at: datetime
    completed_at: Optional[datetime]
    tool_calls: List[ToolCallSchema] = []

    class Config:
        from_attributes = True
