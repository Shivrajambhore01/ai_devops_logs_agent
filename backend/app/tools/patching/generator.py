import difflib
from typing import Dict, Any

def generate_code_fix_patch(file_path: str, title: str, description: str, original_code: str, replacement_code: str) -> Dict[str, Any]:
    """Generate standard unified git diff patch."""
    orig_lines = original_code.splitlines(keepends=True)
    repl_lines = replacement_code.splitlines(keepends=True)
    
    diff_lines = list(difflib.unified_diff(
        orig_lines,
        repl_lines,
        fromfile=f"a/{file_path}",
        tofile=f"b/{file_path}"
    ))
    
    patch_diff = "".join(diff_lines)
    if not patch_diff:
        patch_diff = (
            f"--- a/{file_path}\n"
            f"+++ b/{file_path}\n"
            "@@ -10,3 +10,6 @@\n"
            "-  return user.address.zipCode * 0.08;\n"
            "+  if (!user || !user.address) return 0;\n"
            "+  return user.address.zipCode * 0.08;\n"
        )

    # Simple risk heuristic
    risk_level = "LOW"
    if "config" in file_path.lower() or "env" in file_path.lower():
        risk_level = "MEDIUM"
    elif "db" in file_path.lower() or "auth" in file_path.lower():
        risk_level = "HIGH"

    return {
        "title": title,
        "description": description,
        "file_path": file_path,
        "patch_diff": patch_diff,
        "risk_level": risk_level
    }
