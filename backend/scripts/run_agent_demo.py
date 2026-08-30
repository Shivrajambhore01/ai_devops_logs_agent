import sys
import os

# Add backend directory to sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.agents import incident_agent_app
from app.services.evidence_service import evidence_engine
from app.services.rca_service import rca_engine
from app.tools.patching import generate_code_fix_patch, validate_patch_syntax
from app.tools.sandbox import sandbox_runner

def run_live_incident_demo():
    print("=" * 60)
    print("AI DEVOPS INCIDENT RESOLUTION AGENT -- DEMO RUNNER")
    print("=" * 60)

    # 1. Trigger Incident
    incident_state = {
        "incident_id": "INC-1024",
        "repository": "checkout-api",
        "service_name": "checkout-api",
        "deployment_id": "184",
        "commit_sha": "8a3f1c2",
        "plan": [],
        "current_step": "start",
        "observations": [],
        "evidence": [],
        "root_cause": None,
        "confidence": 0.0,
        "cited_evidence_ids": [],
        "proposed_patch": None,
        "test_passed": False,
        "test_summary": None,
        "approval_status": "PENDING",
        "pr_url": None
    }

    print(f"\n[1/5] Incident Ingested: {incident_state['incident_id']} (Service: {incident_state['service_name']})")
    
    # 2. Execute LangGraph Agent
    print("\n[2/5] Agent Orchestrator Running (LangGraph)...")
    final_state = incident_agent_app.invoke(incident_state)
    
    print("\n[3/5] Root Cause Analysis Complete:")
    print(f"      * Diagnosis:  {final_state['root_cause']}")
    print(f"      * Confidence: {final_state['confidence'] * 100}%")
    print(f"      * Evidence:   {', '.join(final_state['cited_evidence_ids'])}")

    # 3. Patch Diff Generation
    patch_info = final_state.get("proposed_patch", {})
    print("\n[4/5] Fix Patch Generated:")
    print(f"      * Title:        {patch_info.get('title')}")
    print(f"      * File:         {patch_info.get('file_path')}")
    print(f"      * Risk Level:   {patch_info.get('risk_level')}")
    print(f"      * Syntax Valid: {validate_patch_syntax(patch_info.get('patch_diff', ''))}")

    # 4. Sandbox Test Execution
    test_res = sandbox_runner.run_sandbox_tests(patch_info.get('patch_diff', ''))
    print("\n[5/5] Sandbox Validation:")
    print(f"      * Tests Passed: {test_res['passed_tests']}/{test_res['total_tests']}")
    print(f"      * Build Status: {test_res['build_status']}")
    print(f"      * Health Check: {test_res['health_check']}")

    print("\n" + "=" * 60)
    print("Awaiting Human Approval in Command Center Dashboard...")
    print("=" * 60)

if __name__ == "__main__":
    run_live_incident_demo()
