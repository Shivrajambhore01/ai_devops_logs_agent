from typing import List, Dict, Any

class EvidenceCorrelationEngine:
    """Correlate disparate tool observations into structured evidence items."""

    def correlate_evidence(self, observations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        evidence_items = []
        counter = 101

        for obs in observations:
            tool = obs.get("tool")
            output = obs.get("output")

            if tool == "get_recent_commits" and isinstance(output, list) and len(output) > 0:
                top_commit = output[0]
                evidence_items.append({
                    "id": f"EV-{counter}",
                    "source": "github",
                    "label": "Recent Commit Modification",
                    "detail": f"Commit {top_commit.get('commit')} by {top_commit.get('author')}: '{top_commit.get('message')}' modified files: {', '.join(top_commit.get('files_changed', []))}",
                    "metadata": top_commit
                })
                counter += 1

            elif tool == "get_workflow_logs" and isinstance(output, dict):
                evidence_items.append({
                    "id": f"EV-{counter}",
                    "source": "ci",
                    "label": "CI Workflow Failure",
                    "detail": f"Workflow run #{output.get('run_id')} failed at step '{output.get('failed_step', 'Run Tests')}'",
                    "metadata": output
                })
                counter += 1

            elif tool == "search_logs" and isinstance(output, list) and len(output) > 0:
                first_log = output[0]
                evidence_items.append({
                    "id": f"EV-{counter}",
                    "source": "logs",
                    "label": "Matching Stacktrace Event",
                    "detail": first_log.get("message", "Unhandled exception in application log"),
                    "metadata": first_log
                })
                counter += 1

        return evidence_items

evidence_engine = EvidenceCorrelationEngine()
