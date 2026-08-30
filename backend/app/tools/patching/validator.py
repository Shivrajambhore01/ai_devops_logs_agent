def validate_patch_syntax(patch_diff: str) -> bool:
    """Validate unified patch diff syntax."""
    if not patch_diff or not isinstance(patch_diff, str):
        return False
    
    has_header = "---" in patch_diff and "+++" in patch_diff
    has_hunk = "@@" in patch_diff
    return has_header and has_hunk
