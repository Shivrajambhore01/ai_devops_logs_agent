import re
from typing import List, Dict, Any, Optional

# Secret patterns for PII / Auth sanitization
SECRET_PATTERNS = [
    (r'(?i)(bearer\s+)[a-zA-Z0-9\-\._~\+\/]+=*', r'\1[REDACTED_TOKEN]'),
    (r'(?i)(api[_\-]?key\s*[:=]\s*)[a-zA-Z0-9\-\._]{8,}', r'\1[REDACTED_KEY]'),
    (r'(?i)(password\s*[:=]\s*)[^\s,;&]+', r'\1[REDACTED_PASSWORD]'),
    (r'(?i)(secret\s*[:=]\s*)[^\s,;&]+', r'\1[REDACTED_SECRET]'),
    (r'eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}', '[REDACTED_JWT]'),
]

def sanitize_log(text: str) -> str:
    """Mask sensitive tokens, passwords, and API keys from raw log text."""
    sanitized = text
    for pattern, replacement in SECRET_PATTERNS:
        sanitized = re.sub(pattern, replacement, sanitized)
    return sanitized

def extract_file_location(log_line: str) -> Optional[str]:
    """Extract file path and line number from stack trace line if present."""
    match = re.search(r'([a-zA-Z0-9_\-\/\\.]+\.(?:ts|js|py|go|java|rs)):(\d+)(?::(\d+))?', log_line)
    if match:
        return match.group(0)
    return None

def extract_error_class(log_line: str) -> Optional[str]:
    """Isolate specific error types (e.g., TypeError, MongoServerSelectionError)."""
    match = re.search(r'([A-Z][a-zA-Z0-9]*(?:Error|Exception|Rejection|Timeout|Failure))', log_line)
    if match:
        return match.group(1)
    return None

def parse_stacktrace(raw_log: str) -> List[Dict[str, Any]]:
    """Parse raw log stream into structured error log items with secret sanitization."""
    lines = raw_log.split("\n") if isinstance(raw_log, str) else raw_log
    results = []
    
    for raw_line in lines:
        if not raw_line.strip():
            continue
        
        sanitized = sanitize_log(raw_line.strip())
        level = "INFO"
        if any(term in sanitized for term in ["ERROR", "Exception", "Error", "FAIL", "UnhandledRejection", "FATAL"]):
            level = "ERROR"
        elif any(term in sanitized for term in ["WARN", "WARNING"]):
            level = "WARN"

        is_stacktrace = ("at " in sanitized or "File " in sanitized or "Traceback" in sanitized or ".ts:" in sanitized or ".py:" in sanitized)
        file_loc = extract_file_location(sanitized)
        err_class = extract_error_class(sanitized)

        results.append({
            "level": level,
            "raw": sanitized,
            "is_stacktrace": is_stacktrace,
            "file_location": file_loc,
            "error_class": err_class
        })
        
    return results

