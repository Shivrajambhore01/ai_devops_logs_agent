import os
from typing import List

def read_log_file(file_path: str, max_lines: int = 200) -> List[str]:
    """Read recent lines from a log file safely."""
    if not os.path.exists(file_path):
        return [f"Log file not found: {file_path}"]
    
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
            return [line.strip() for line in lines[-max_lines:]]
    except Exception as ex:
        return [f"Error reading log file {file_path}: {str(ex)}"]
