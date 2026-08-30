"""
Error pattern definitions for deterministic terminal error detection.
Strictly filters out INFO / DEBUG / 2xx / 3xx / 4xx access logs.
Only triggers on genuine exceptions, stack traces, 5xx server errors, and critical system failures.
"""
from __future__ import annotations
import re
import logging
from typing import List, Tuple, Optional

logger = logging.getLogger(__name__)

# ── Explicit Info / Access Log Patterns (Bypass Error Check) ─────────────────
INFO_PREFIX_PATTERNS = [
    re.compile(r'^\s*(INFO|DEBUG|TRACE):', re.I),
    re.compile(r'\[(INFO|DEBUG|TRACE)\]', re.I),
    re.compile(r'level=(info|debug|trace)', re.I),
]

# HTTP Access Logs 2xx, 3xx, 4xx (e.g. "GET /api/v1/health HTTP/1.1" 200, 404 Not Found)
HTTP_NON_ERROR_PATTERN = re.compile(
    r'("?(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+[^"]+\s+HTTP/[0-9.]+"?)\s+(2[0-9]{2}|3[0-9]{2}|4[0-9]{2})\b',
    re.I
)

# HTTP 5xx Server Error Pattern (e.g. "GET /api/v1/checkout HTTP/1.1" 500 Internal Server Error)
HTTP_5XX_ERROR_PATTERN = re.compile(
    r'("?(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+[^"]+\s+HTTP/[0-9.]+"?)\s+5[0-9]{2}\b',
    re.I
)


# ── True Error Patterns ────────────────────────────────────────────────────────

PYTHON_EXCEPTIONS = re.compile(
    r'(Traceback \(most recent call last\)|'
    r'[A-Za-z0-9_.]*(?:Error|Exception|Warning):\s*|'
    r'^\s*raise\s+[A-Za-z0-9_.]+|'
    r'\b(CRITICAL|FATAL)\b)',
    re.M
)

JAVASCRIPT_EXCEPTIONS = re.compile(
    r'([A-Za-z0-9_.]*(?:Error|Exception):\s*|'
    r'UnhandledPromiseRejection|UnhandledRejection|'
    r'npm ERR!|Error: Cannot find module|'
    r'ECONNREFUSED|ENOENT|EACCES|'
    r'(✖|✗|×)\s*(Error|Failed|failed))',
    re.M
)

DOCKER_SYSTEM_ERRORS = re.compile(
    r'(exited with code [^0]|container.*stopped|container.*died|'
    r'OOMKilled|OutOfMemory|Segmentation fault|panic:|'
    r'Error response from daemon|Connection refused)',
    re.I
)

EXPLICIT_ERROR_HEADERS = re.compile(
    r'(^\s*ERROR:|\b\[ERROR\]\b|\b\[error\]\b|level=error)',
    re.M
)

WARN_PATTERNS = re.compile(
    r'(^\s*WARN(ING)?:|\b\[WARN(ING)?\]\b|level=warn|'
    r'DeprecationWarning|UserWarning)',
    re.I
)

# ── Stack Trace Boundary Markers ───────────────────────────────────────────────
STACK_TRACE_START_PATTERNS = [
    re.compile(r'Traceback \(most recent call last\)', re.I),
    re.compile(r'^\s+at\s+', re.M),
    re.compile(r'File ".*", line \d+', re.M),
    re.compile(r'^\s*at\s+[\w.<>[\]]+\s*\(.*:\d+:\d+\)', re.M),
]

PROCESS_EXIT_PATTERNS = [
    re.compile(r'exited with code ([^0]\d*)', re.I),
    re.compile(r'Process exited: (\d+)', re.I),
    re.compile(r'exit code: ([^0]\d*)', re.I),
]


def detect_level(line: str) -> str:
    """
    Strict level detection. Returns 'ERROR', 'WARN', or 'INFO'.
    Ignores normal INFO/DEBUG/404 web server access logs.
    Only returns 'ERROR' for true stack traces, exceptions, 5xx status codes, and critical failures.
    """
    # 1. Check HTTP 5xx Server Errors (Instant ERROR)
    if HTTP_5XX_ERROR_PATTERN.search(line):
        return "ERROR"

    # 2. Ignore HTTP 2xx/3xx/4xx Access Logs (Always INFO)
    if HTTP_NON_ERROR_PATTERN.search(line) and not ("Traceback" in line or "Exception" in line):
        return "INFO"

    # 3. Check for Stack Trace Start or Python/JS/Docker Exceptions
    if (
        PYTHON_EXCEPTIONS.search(line)
        or JAVASCRIPT_EXCEPTIONS.search(line)
        or DOCKER_SYSTEM_ERRORS.search(line)
        or EXPLICIT_ERROR_HEADERS.search(line)
    ):
        return "ERROR"

    # 4. Check for Explicit Warning Headers
    if WARN_PATTERNS.search(line):
        return "WARN"

    # 5. Default to INFO
    return "INFO"


def is_stacktrace_start(line: str) -> bool:
    return any(p.search(line) for p in STACK_TRACE_START_PATTERNS)


def extract_exit_code(line: str) -> Optional[int]:
    for p in PROCESS_EXIT_PATTERNS:
        m = p.search(line)
        if m:
            try:
                return int(m.group(1))
            except (ValueError, IndexError):
                pass
    return None
