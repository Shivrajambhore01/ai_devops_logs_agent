from typing import Dict, Any
from app.agents.state import AgentState
from app.llm import llm

def planner_node(state: AgentState) -> Dict[str, Any]:
    """Formulate systematic investigation plan based on incident metadata."""
    prompt = f"Plan investigation for incident {state['incident_id']} in repository {state['repository']} on service {state['service_name']}."
    plan_steps = [
        f"1. Retrieve workflow logs for deployment {state.get('deployment_id', '#184')}",
        f"2. Inspect recent commits and diff for SHA {state.get('commit_sha', '8a3f1c2')}",
        f"3. Search application runtime logs for service {state['service_name']}",
        "4. Correlate evidence and identify root cause"
    ]
    return {
        "plan": plan_steps,
        "current_step": "investigating"
    }
