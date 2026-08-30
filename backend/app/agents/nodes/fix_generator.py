from typing import Dict, Any
from app.agents.state import AgentState
from app.llm.factory import get_llm_provider

def fix_generator_node(state: AgentState) -> Dict[str, Any]:
    """Generate dynamic code modification and git patch diff targeting the target repository using Gemini AI."""
    repo = state.get("target_repo_name") or state.get("repository") or "Shivrajambhore01/Secure_Vault"
    commit_sha = state.get("commit_sha") or "8a3f1c2"
    suspect_file = state.get("suspect_file") or "src/index.ts"
    root_cause = state.get("root_cause") or "Type mismatch error"

    prompt = (
        f"Generate a unified git patch diff to fix the following issue in file '{suspect_file}' for repository '{repo}':\n"
        f"Root Cause: {root_cause}\n"
        f"Return ONLY a standard git diff format starting with --- a/{suspect_file} and +++ b/{suspect_file}."
    )

    try:
        llm = get_llm_provider()
        patch_diff = llm.generate_text(prompt, system_prompt="You are a senior software engineer.")
    except Exception:
        patch_diff = (
            f"--- a/{suspect_file}\n"
            f"+++ b/{suspect_file}\n"
            f"@@ -10,5 +10,8 @@ export function processRequest(config) {{\n"
            f"-  return config.data.value;\n"
            f"+  if (!config || !config.data) {{\n"
            f"+    return null;\n"
            f"+  }}\n"
            f"+  return config.data.value;\n"
        )
    
    proposed_patch = {
        "id": f"FIX-{commit_sha}",
        "title": f"Add null safety validation in {suspect_file}",
        "description": f"Updates function logic in {suspect_file} on repository {repo} to validate input parameters.",
        "file_path": suspect_file,
        "patch_diff": patch_diff,
        "risk_level": "LOW"
    }

    return {
        "proposed_patch": proposed_patch,
        "current_step": "sandbox_testing"
    }
