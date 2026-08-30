from typing import Dict, Any, Callable
from app.tools.github import get_recent_commits, get_commit_diff, get_workflow_runs, get_workflow_logs, create_pull_request
from app.tools.logs import search_logs, read_log_file
from app.tools.docker import list_containers, get_container_logs
from app.agents.policies.tool_policy import tool_policy

class ToolRegistry:
    """Central registry for permissioned tool execution."""
    
    def __init__(self):
        self._tools: Dict[str, Dict[str, Any]] = {
            "get_recent_commits": {"fn": get_recent_commits, "tier": "READ"},
            "get_commit_diff": {"fn": get_commit_diff, "tier": "READ"},
            "get_workflow_runs": {"fn": get_workflow_runs, "tier": "READ"},
            "get_workflow_logs": {"fn": get_workflow_logs, "tier": "READ"},
            "search_logs": {"fn": search_logs, "tier": "READ"},
            "list_containers": {"fn": list_containers, "tier": "READ"},
            "get_container_logs": {"fn": get_container_logs, "tier": "READ"},
            "create_pull_request": {"fn": create_pull_request, "tier": "HIGH_RISK"}
        }

    def execute_tool(self, tool_name: str, kwargs: Dict[str, Any], call_count: int = 0) -> Any:
        if tool_name not in self._tools:
            raise ValueError(f"Unknown tool requested: {tool_name}")

        tool_meta = self._tools[tool_name]
        tool_policy.check_tool_permission(tool_name, call_count)
        
        fn: Callable = tool_meta["fn"]
        return fn(**kwargs)

tool_registry = ToolRegistry()
