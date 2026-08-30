from typing import List, Dict, Any
from app.tools.github.client import github_client

def get_workflow_runs(owner: str, repo_name: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Retrieve recent workflow runs for a repository."""
    if not github_client.is_configured():
        return [
            {
                "id": "184",
                "name": "CI/CD Deployment Pipeline",
                "status": "completed",
                "conclusion": "failure",
                "event": "push",
                "head_sha": "8a3f1c2",
                "created_at": "2026-08-23T12:05:00Z"
            }
        ]

    full_name = f"{owner}/{repo_name}"
    repo = github_client.get_repo(full_name)
    runs = repo.get_workflow_runs()[:limit]
    result = []
    for r in runs:
        result.append({
            "id": str(r.id),
            "name": r.name,
            "status": r.status,
            "conclusion": r.conclusion,
            "event": r.event,
            "head_sha": r.head_sha[:7],
            "created_at": r.created_at.isoformat()
        })
    return result

def get_workflow_logs(owner: str, repo_name: str, run_id: str) -> Dict[str, Any]:
    """Retrieve failed job logs for a specific workflow run."""
    if not github_client.is_configured():
        return {
            "run_id": run_id,
            "status": "failure",
            "failed_step": "Run Tax Calculation Integration Tests",
            "error_logs": [
                "2026-08-23T12:06:12Z ERROR [checkout-api] TypeError: Cannot read property 'zipCode' of undefined",
                "2026-08-23T12:06:12Z ERROR [checkout-api]     at calculateTax (src/tax/calculate.ts:13:23)",
                "2026-08-23T12:06:13Z ERROR Process exited with code 1"
            ]
        }

    full_name = f"{owner}/{repo_name}"
    repo = github_client.get_repo(full_name)
    run = repo.get_workflow_run(int(run_id))
    jobs = run.jobs()
    failed_steps = []
    for j in jobs:
        if j.conclusion == "failure":
            for step in j.steps:
                if step.conclusion == "failure":
                    failed_steps.append({
                        "job_name": j.name,
                        "step_name": step.name,
                        "conclusion": step.conclusion
                    })
    return {
        "run_id": run_id,
        "status": run.conclusion,
        "failed_steps": failed_steps
    }
