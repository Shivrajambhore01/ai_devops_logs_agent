from typing import List, Dict, Any, Optional, TypedDict

class AgentState(TypedDict):
    incident_id: str
    incident_title: Optional[str]
    repository: str
    service_name: str
    deployment_id: Optional[str]
    commit_sha: Optional[str]
    # Resolved repo fields set by investigator_node
    target_repo_name: Optional[str]
    suspect_file: Optional[str]
    real_commits_info: Optional[List[Dict[str, Any]]]

    # Reasoning & Investigation State
    plan: List[str]
    current_step: str
    observations: List[Dict[str, Any]]
    evidence: List[Dict[str, Any]]
    
    # Diagnostic Output
    root_cause: Optional[str]
    confidence: float
    cited_evidence_ids: List[str]
    
    # Fix & Patch Output
    proposed_patch: Optional[Dict[str, Any]]
    
    # Sandbox Test Results
    test_passed: bool
    test_summary: Optional[Dict[str, Any]]
    
    # Approval Gatekeeping
    approval_status: str  # PENDING, APPROVED, REJECTED
    pr_url: Optional[str]
