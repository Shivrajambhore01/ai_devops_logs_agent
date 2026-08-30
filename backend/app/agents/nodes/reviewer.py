from typing import Dict, Any
from app.agents.state import AgentState

def reviewer_node(state: AgentState) -> Dict[str, Any]:
    """Prepare human approval decision payload and update incident state."""
    return {
        "approval_status": "PENDING",
        "current_step": "completed_awaiting_approval"
    }
