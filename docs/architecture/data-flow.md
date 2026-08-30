# Data Flow & Lifecycle Specification — AI DevOps Incident Resolution Agent

## 1. End-to-End Incident Data Flow

```mermaid
sequenceDiagram
    autonumber
    actor Developer as Developer / GitHub Webhook
    participant Webhook as FastAPI Webhook Endpoint
    participant DB as PostgreSQL Database
    participant Agent as LangGraph Orchestrator
    participant Tools as Tool Integrations (Git/Docker/Logs)
    participant Sandbox as Docker Test Sandbox
    participant UI as Next.js Dashboard

    Developer->>Webhook: Push Commit / CI Deployment Fails
    Webhook->>DB: Create Incident Record (status: INVESTIGATING)
    Webhook->>Agent: Trigger Incident Run (incident_id)
    
    loop Investigation Cycle
        Agent->>Tools: Invoke Controlled Tool (e.g. get_recent_commits)
        Tools-->>Agent: Return Structured Observation
        Agent->>DB: Log Agent Step & Tool Call
        Agent->>UI: Stream Event via WebSocket
    end

    Agent->>Agent: Correlate Evidence & Synthesize Root Cause
    Agent->>Agent: Generate Fix Patch (.patch)
    
    Agent->>Sandbox: Spawn Sandbox Container & Apply Patch
    Sandbox->>Sandbox: Execute Test Suite (pytest / npm test)
    Sandbox-->>Agent: Test Results (100% Passed)
    
    Agent->>DB: Save Fix Recommendation & Test Results
    Agent->>UI: Update Incident Status (AWAITING_APPROVAL)

    Developer->>UI: Inspect Root Cause, Evidence & Diff
    Developer->>UI: Click "Approve Fix"
    
    UI->>Webhook: POST /api/v1/fixes/{id}/approve
    Webhook->>Tools: Create GitHub Pull Request
    Webhook->>DB: Update Incident Status (RESOLVED)
    Webhook-->>UI: Return PR Link & Resolution Confirmation
```

---

## 2. Graph State Schema (`AgentState`)

```python
class AgentState(TypedDict):
    incident_id: str
    repository_url: str
    branch: str
    deployment_id: str
    
    # Investigation & Reasoning
    plan: List[str]
    observations: List[Dict[str, Any]]
    evidence: List[Dict[str, Any]]
    
    # RCA & Fix
    root_cause: Optional[str]
    confidence_score: float
    cited_evidence_ids: List[str]
    proposed_patch: Optional[str]
    
    # Sandbox Validation
    test_passed: bool
    test_output: Optional[str]
    risk_level: str  # LOW, MEDIUM, HIGH
    
    # Human Gatekeeping
    approval_status: str  # PENDING, APPROVED, REJECTED
```

---

## 3. Data Retention & Privacy Principles
1. **Sanitization**: All log streams are sanitized for sensitive secrets (API keys, passwords, JWT tokens) before being processed by the LLM or stored in the database.
2. **Auditability**: Every tool call, prompt template, raw response, and user action is recorded with microsecond timestamps in `audit_logs`.
3. **Immutability**: Historical evidence objects and test results associated with resolved incidents are immutable.
