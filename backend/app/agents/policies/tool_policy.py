from typing import Dict, Any, List

class ToolPolicyEnforcer:
    def __init__(self, max_tool_calls: int = 30, max_timeout_seconds: int = 300):
        self.max_tool_calls = max_tool_calls
        self.max_timeout_seconds = max_timeout_seconds

    def check_tool_permission(self, tool_name: str, total_calls: int) -> bool:
        """Check if tool call is within execution safety budgets."""
        if total_calls >= self.max_tool_calls:
            raise ValueError(f"Safety limit reached: Tool execution exceeded max calls budget ({self.max_tool_calls}).")
        return True

    def is_repeating_loop(self, call_history: List[str], current_tool: str, threshold: int = 3) -> bool:
        """Detect infinite repetition of identical tool calls."""
        if len(call_history) >= threshold:
            recent = call_history[-threshold:]
            if all(t == current_tool for t in recent):
                return True
        return False

tool_policy = ToolPolicyEnforcer()
