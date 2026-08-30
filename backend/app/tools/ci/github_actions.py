from typing import Dict, Any, List
from app.tools.github.workflows import get_workflow_logs

def parse_workflow_failure_summary(run_id: str, owner: str = "acme", repo_name: str = "checkout-api") -> Dict[str, Any]:
    """Parse failed workflow run and isolate the exact failing step and error messages."""
    raw_logs = get_workflow_logs(owner, repo_name, run_id)
    
    error_snippet = ""
    error_logs = raw_logs.get("error_logs", [])
    if error_logs:
        error_snippet = "\n".join(error_logs)

    return {
        "run_id": run_id,
        "workflow_name": "CI/CD Deployment Pipeline",
        "conclusion": raw_logs.get("status", "failure"),
        "failed_step": raw_logs.get("failed_step", "Run Tests"),
        "error_snippet": error_snippet,
        "is_dependency_issue": ("npm ERR!" in error_snippet or "pip" in error_snippet),
        "is_db_issue": ("Mongo" in error_snippet or "Postgres" in error_snippet or "DATABASE" in error_snippet),
        "is_type_error": ("TypeError" in error_snippet or "NullPointer" in error_snippet)
    }
