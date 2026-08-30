from datetime import datetime
from typing import Optional
from pydantic import BaseModel

class FixResponse(BaseModel):
    id: str
    incident_id: str
    title: str
    description: str
    file_path: str
    patch_diff: str
    tests_passed: bool
    total_tests: int
    passed_tests: int
    test_output_log: Optional[str]
    risk_level: str
    status: str
    pull_request_url: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True

class ApprovalRequest(BaseModel):
    decision: str  # APPROVED, REJECTED
    comments: Optional[str] = None
    user_id: int = 1
