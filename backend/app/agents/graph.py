from typing import Dict, Any
import logging

logger = logging.getLogger(__name__)

try:
    from langgraph.graph import StateGraph, END
    LANGGRAPH_AVAILABLE = True
except ImportError:
    StateGraph = None
    END = "__end__"
    LANGGRAPH_AVAILABLE = False
    logger.warning("langgraph module not installed. Falling back to lightweight state graph runner.")

from app.agents.state import AgentState
from app.agents.nodes.planner import planner_node
from app.agents.nodes.investigator import investigator_node
from app.agents.nodes.evidence_analyzer import evidence_analyzer_node
from app.agents.nodes.root_cause import root_cause_node
from app.agents.nodes.fix_generator import fix_generator_node
from app.agents.nodes.test_agent import test_agent_node
from app.agents.nodes.reviewer import reviewer_node

class LightweightStateGraphRunner:
    """Fallback runner for state graph execution when langgraph is not installed."""
    
    def invoke(self, state: AgentState) -> AgentState:
        s1 = {**state, **planner_node(state)}
        s2 = {**s1, **investigator_node(s1)}
        s3 = {**s2, **evidence_analyzer_node(s2)}
        s4 = {**s3, **root_cause_node(s3)}
        s5 = {**s4, **fix_generator_node(s4)}
        s6 = {**s5, **test_agent_node(s5)}
        s7 = {**s6, **reviewer_node(s6)}
        return s7

def build_incident_agent_graph():
    """Build and compile the incident resolution workflow state machine."""
    if not LANGGRAPH_AVAILABLE:
        return LightweightStateGraphRunner()

    workflow = StateGraph(AgentState)

    workflow.add_node("planner", planner_node)
    workflow.add_node("investigator", investigator_node)
    workflow.add_node("evidence_analyzer", evidence_analyzer_node)
    workflow.add_node("root_cause", root_cause_node)
    workflow.add_node("fix_generator", fix_generator_node)
    workflow.add_node("test_agent", test_agent_node)
    workflow.add_node("reviewer", reviewer_node)

    workflow.set_entry_point("planner")

    workflow.add_edge("planner", "investigator")
    workflow.add_edge("investigator", "evidence_analyzer")
    workflow.add_edge("evidence_analyzer", "root_cause")
    workflow.add_edge("root_cause", "fix_generator")
    workflow.add_edge("fix_generator", "test_agent")
    workflow.add_edge("test_agent", "reviewer")
    workflow.add_edge("reviewer", END)

    return workflow.compile()

incident_agent_app = build_incident_agent_graph()
