"""
Level 1 AI Error Analyzer.
Receives a NormalizedError from ErrorDetector,
executes high-speed Expert DevOps Diagnosis Engine (< 2ms) + LLM inference,
and broadcasts structured AIErrorSummary over WebSocket.
"""
from __future__ import annotations
import asyncio
import json
import logging
import re
from typing import List, Optional

from app.terminal.event import EventType, LogLevel, NormalizedError, TerminalEvent, AIErrorSummary
from app.terminal.websocket_manager import ws_manager

logger = logging.getLogger(__name__)


# ── Expert DevOps Diagnosis Engine (Instant < 2ms Accurate Analysis) ───────────

def _expert_rule_diagnosis(error: NormalizedError, session_id: str) -> Optional[AIErrorSummary]:
    """
    High-precision deterministic SRE diagnosis engine.
    Instantly identifies classic DevOps, Python, Node.js, and container infrastructure failures.
    """
    msg = error.error_message or ""
    err_type = error.error_type or ""
    trace = error.raw_stack_trace or ""
    combined = f"{err_type} {msg} {trace}".lower()

    # 1. SQLAlchemy Session.add() during flush
    if "sawarning" in combined or ("session.add" in combined and "flush" in combined):
        loc_str = f" in {error.file_path}:{error.line_number}" if error.file_path and error.line_number else (f" in {error.file_path}" if error.file_path else "")
        return AIErrorSummary(
            error_id=error.id,
            session_id=session_id,
            title=f"SQLAlchemy SAWarning: Session.add() During Active Flush{loc_str}",
            what_happened=f"A background task or event listener invoked 'Session.add()'{loc_str} while SQLAlchemy was already actively executing a database flush.",
            why_it_happened=(
                "In SQLAlchemy 1.4 and 2.0+, modifying the session state or calling 'Session.add()' during flush execution "
                "(e.g., inside 'before_flush', 'after_flush' hooks, or model property setters) is unsupported. "
                "Flushing freezes change-tracking to build SQL statements; mutating the session mid-flush breaks transactional atomicity "
                "and can lead to skipped objects or cascading flush loops."
            ),
            recommended_fix=(
                "1. Open the file and inspect the code around line " + str(error.line_number or "the caller") + ".\n"
                "2. If this records audit logs, metrics, or task state triggered by ORM events, use an independent session:\n"
                "   with Session(engine) as audit_session:\n"
                "       audit_session.add(audit_log)\n"
                "       audit_session.commit()\n"
                "3. If modifying objects inside a 'before_flush' event listener, append directly to 'session.new' instead of calling 'session.add()'.\n"
                "4. If in standard application flow, ensure 'session.add()' executes before invoking 'session.flush()' or 'session.commit()'."
            ),
            severity="MEDIUM",
            confidence=0.98,
            suggested_commands=[
                "git grep -n 'Session.add' .",
                "docker compose logs --tail=100",
            ],
        )

    # 2. Celery Worker Lost / SoftTimeLimitExceeded
    if "workerlosterror" in combined or "softtimelimitexceeded" in combined or "timelimitexceeded" in combined:
        return AIErrorSummary(
            error_id=error.id,
            session_id=session_id,
            title="Celery Task Execution Timeout / Worker Process Lost",
            what_happened="A Celery worker process was terminated or exceeded its configured soft/hard time limit while executing a background task.",
            why_it_happened="The task execution ran longer than 'task_time_limit' or 'task_soft_time_limit', or the worker process was killed by the OS kernel (OOMKilled) or Docker stop signal.",
            recommended_fix=(
                "1. Review task execution time and batch sizes. Break large ETL or bulk database operations into smaller paginated chunks.\n"
                "2. Increase task time limits in celeryconfig.py or @app.task(time_limit=300, soft_time_limit=240).\n"
                "3. Handle SoftTimeLimitExceeded inside the task to gracefully clean up open connections and save partial state before termination."
            ),
            severity="HIGH",
            confidence=0.96,
            suggested_commands=[
                "docker compose logs --tail=100 celery",
                "docker stats --no-stream",
            ],
        )

    # 3. Bcrypt 4.x / Passlib version incompatibility
    if "bcrypt" in combined and ("__about__" in combined or "has no attribute '__about__'" in combined):
        return AIErrorSummary(
            error_id=error.id,
            session_id=session_id,
            title="Passlib & Bcrypt 4.x Version Incompatibility",
            what_happened="Passlib attempted to access bcrypt.__about__.__version__, which was removed in bcrypt 4.0.0+.",
            why_it_happened="Bcrypt >= 4.0.0 rewrote its core in Rust and deprecated the internal '__about__' module that older Passlib releases (< 1.7.4) rely on.",
            recommended_fix="Pin bcrypt to '<4.0.0' in requirements.txt or install a compatible passlib/bcrypt release.",
            severity="HIGH",
            confidence=0.98,
            suggested_commands=[
                'pip install "bcrypt<4.0.0"',
                'pip install --upgrade passlib bcrypt',
            ],
        )

    # 4. Missing Python Package / ModuleNotFoundError / ImportError
    if "modulenotfounderror" in combined or "no module named" in combined:
        mod_match = re.search(r"no module named ['\"]([^'\"]+)['\"]", msg, re.I) or re.search(r"no module named ['\"]([^'\"]+)['\"]", trace, re.I)
        mod_name = mod_match.group(1) if mod_match else "dependency"
        return AIErrorSummary(
            error_id=error.id,
            session_id=session_id,
            title=f"Missing Python Dependency: {mod_name}",
            what_happened=f"Python runtime failed to import module '{mod_name}'.",
            why_it_happened=f"Package '{mod_name}' is not installed in the container virtualenv or missing from requirements.txt.",
            recommended_fix=f"Install '{mod_name}' via pip and add it to requirements.txt, then rebuild the container.",
            severity="HIGH",
            confidence=0.96,
            suggested_commands=[
                f"pip install {mod_name}",
                "docker compose build --no-cache",
            ],
        )

    # 5. Connection Refused / Database / Redis Down
    if any(k in combined for k in ["connectionrefusederror", "connection refused", "econnrefused", "[errno 111]"]):
        service_target = "PostgreSQL" if "5432" in combined or "postgres" in combined else ("Redis" if "6379" in combined or "redis" in combined else "target service")
        return AIErrorSummary(
            error_id=error.id,
            session_id=session_id,
            title=f"Connection Refused to {service_target}",
            what_happened=f"Connection to {service_target} was refused by the host/container network.",
            why_it_happened=f"The {service_target} service is stopped, still starting up, or listening on a different network interface.",
            recommended_fix=f"Verify that the {service_target} container is running and healthy. Check host/port configuration in .env.",
            severity="CRITICAL",
            confidence=0.95,
            suggested_commands=[
                "docker compose ps",
                f"docker compose logs --tail=50 {service_target.lower()}",
                "docker compose up -d",
            ],
        )

    # 6. Port Conflict / Address in Use (EADDRINUSE)
    if "address already in use" in combined or "eaddrinuse" in combined or "[errno 98]" in combined:
        port_match = re.search(r":(\d{2,5})", msg) or re.search(r"port (\d{2,5})", combined)
        port_num = port_match.group(1) if port_match else "configured"
        return AIErrorSummary(
            error_id=error.id,
            session_id=session_id,
            title=f"Port Conflict: Port {port_num} Already In Use",
            what_happened=f"Application failed to bind to port {port_num} because another process is already listening on it.",
            why_it_happened="An existing container instance or local server process is already running on this port.",
            recommended_fix=f"Stop the existing process on port {port_num} or change the port in .env/docker-compose.yml.",
            severity="HIGH",
            confidence=0.97,
            suggested_commands=[
                f"netstat -ano | findstr :{port_num}",
                "docker compose down",
            ],
        )

    # 7. Out of Memory / OOMKilled (Exit code 137)
    if "oomkilled" in combined or "exit code 137" in combined or "out of memory" in combined:
        return AIErrorSummary(
            error_id=error.id,
            session_id=session_id,
            title="Container Out of Memory (OOMKilled - Exit Code 137)",
            what_happened="The Linux kernel terminated the container because memory usage exceeded allocated limits.",
            why_it_happened="The workload consumed more RAM than the memory limit configured in Docker or available host RAM.",
            recommended_fix="Increase container memory limits in docker-compose.yml (e.g., mem_limit: 2g) or profile memory leaks.",
            severity="CRITICAL",
            confidence=0.96,
            suggested_commands=[
                "docker stats --no-stream",
                "docker compose up -d --build",
            ],
        )

    # 8. Database Authentication / OperationalError
    if "password authentication failed" in combined or "operationalerror" in combined:
        return AIErrorSummary(
            error_id=error.id,
            session_id=session_id,
            title="Database Connection / Authentication Error",
            what_happened="Could not connect to PostgreSQL database due to authentication or connection timeout.",
            why_it_happened="POSTGRES_USER, POSTGRES_PASSWORD, or DATABASE_URL in .env does not match the database container credentials.",
            recommended_fix="Verify credentials in .env against docker-compose.yml and ensure postgres container is ready.",
            severity="CRITICAL",
            confidence=0.94,
            suggested_commands=[
                "docker compose restart postgres",
                "docker compose logs --tail=40 postgres",
            ],
        )

    # 9. KeyError in Python
    if err_type == "KeyError" or "keyerror:" in combined:
        key_match = re.search(r"KeyError:\s*['\"]?([^'\"\n]+)['\"]?", msg, re.I)
        key_name = key_match.group(1) if key_match else "key"
        loc_str = f" in {error.file_path}:{error.line_number}" if error.file_path and error.line_number else ""
        return AIErrorSummary(
            error_id=error.id,
            session_id=session_id,
            title=f"KeyError: Missing Dictionary Key '{key_name}'{loc_str}",
            what_happened=f"Code attempted to access non-existent dictionary key '{key_name}'{loc_str}.",
            why_it_happened=f"The incoming data dictionary or payload did not contain '{key_name}' at {error.file_path or 'handler'}:{error.line_number or ''}.",
            recommended_fix=(
                f"1. Open {error.file_path or 'the source file'} around line {error.line_number or 'the caller'}.\n"
                f"2. Replace direct access `data['{key_name}']` with safe lookup `data.get('{key_name}', default_value)`.\n"
                f"3. Validate required payload attributes before execution."
            ),
            severity="HIGH",
            confidence=0.95,
            suggested_commands=[],
        )

    # 10. Node.js Cannot find module / npm ERR
    if "cannot find module" in combined or "npm err!" in combined:
        mod_match = re.search(r"cannot find module ['\"]([^'\"]+)['\"]", msg, re.I)
        mod_name = mod_match.group(1) if mod_match else "node package"
        return AIErrorSummary(
            error_id=error.id,
            session_id=session_id,
            title=f"Missing Node.js Module: {mod_name}",
            what_happened=f"Node.js runtime could not locate module '{mod_name}'.",
            why_it_happened=f"Package '{mod_name}' is not in node_modules or package.json.",
            recommended_fix=f"Run npm install {mod_name} and verify package.json dependencies.",
            severity="HIGH",
            confidence=0.95,
            suggested_commands=[
                f"npm install {mod_name}",
                "npm install",
            ],
        )

    # 11. HTTP 500 Internal Server Error
    if "500" in msg or "500 internal server error" in combined:
        return AIErrorSummary(
            error_id=error.id,
            session_id=session_id,
            title="HTTP 500 Internal Server Error",
            what_happened="The web application threw an unhandled exception while processing an HTTP request.",
            why_it_happened="An unhandled exception occurred in the route handler. Check the stack trace below for the exact exception.",
            recommended_fix="Inspect the route handler logic, validate request input parameters, and wrap risky calls in try/except.",
            severity="HIGH",
            confidence=0.90,
            suggested_commands=[],
        )

    return None


# ── Analysis Orchestration ─────────────────────────────────────────────────────

_ANALYSIS_PROMPT_TEMPLATE = """You are an elite Senior Site Reliability Engineer (SRE) & Principal Systems Architect.
Analyze this container error log and stack trace, and generate an in-depth, production-ready AI diagnosis in clear, professional English.

Error Context:
- Language / Runtime: {language}
- Error Type:         {error_type}
- Error Message:      {error_message}
- File Path:          {file_path}
- Line Number:        {line_number}

Stack Trace / Log Output:
{raw_stack_trace}

Instructions:
1. "title": A precise, descriptive title identifying the exact error, file, and component (e.g. "SQLAlchemy SAWarning: Session.add() during flush in executor.py:767").
2. "what_happened": Clear, plain English explanation of exactly what happened. Detail what operation failed, which worker or container process triggered it, and the immediate impact.
3. "why_it_happened": Deep, technical Root Cause analysis. Explain the underlying runtime, framework, or architectural mechanism (e.g., SQLAlchemy session flush lifecycle, connection pool exhaustion, unhandled dictionary key, memory limit breach).
4. "recommended_fix": Comprehensive, step-by-step resolution guide formatted with clear numbered steps (1., 2., 3.). Include:
   - Step 1: Exactly where to look in the code (mention file path and line number).
   - Step 2: Clear code or configuration adjustment needed (include code snippets or pattern examples).
   - Step 3: Best practices to prevent this issue from recurring in production.
5. "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
6. "confidence": A float between 0.85 and 0.99 indicating diagnosis certainty.
7. "suggested_commands": 2-4 real, copy-pasteable terminal commands to inspect logs, check container health, test the fix, or restart the container.

Return ONLY a valid JSON object matching this schema without markdown codeblocks or extra text:
{{
  "title": "...",
  "what_happened": "...",
  "why_it_happened": "...",
  "recommended_fix": "...",
  "severity": "MEDIUM",
  "confidence": 0.96,
  "suggested_commands": ["...", "..."]
}}"""


async def analyze_error_async(error: NormalizedError, session_id: str) -> AIErrorSummary:
    """
    Ultra-fast, non-blocking AI error analysis.
    Uses instant Expert Engine first, then enhances with LLM if needed.
    Broadcasts AI_ANALYSIS_STARTED and AI_ANALYSIS_COMPLETED events over WebSocket.
    """
    # 1. Notify frontend UI over WebSocket that analysis has started
    await ws_manager.broadcast(session_id, TerminalEvent(
        session_id=session_id,
        level=LogLevel.AI,
        message="🤖 AI Error Analyzer started — diagnosing root cause...",
        event_type=EventType.AI_ANALYSIS_STARTED,
    ))

    # 2. Check Expert Rule Diagnosis (< 1ms instant accurate result)
    expert_summary = _expert_rule_diagnosis(error, session_id)
    if expert_summary and expert_summary.confidence >= 0.96:
        summary = expert_summary
    else:
        # 3. Call LLM with 15-second background timeout
        try:
            summary = await _call_llm(error, session_id)
        except Exception as exc:
            logger.warning(f"[AIAnalyzer] LLM call fallback for {error.id}: {exc}")
            summary = expert_summary or _fallback_summary(error, session_id)

    # 4. Broadcast completed summary
    await ws_manager.broadcast_raw(session_id, {
        "event_type": EventType.AI_ANALYSIS_COMPLETED,
        "session_id": session_id,
        "level": "AI",
        "ai_summary": summary.model_dump(),
    })

    # 5. Persist to PostgreSQL if Docker session
    if session_id.startswith("docker_") or session_id.startswith("manual") or session_id == "dashboard":
        try:
            from app.services.docker_error_service import save_docker_ai_summary
            await save_docker_ai_summary(summary)
        except Exception as exc:
            logger.warning(f"[AIAnalyzer] Failed to persist Docker AI summary: {exc}")

    logger.info(f"[AIAnalyzer] Diagnosis complete for error {error.id}: {summary.title}")
    return summary


async def _call_llm(error: NormalizedError, session_id: str) -> AIErrorSummary:
    """Send normalized error to LLM and parse structured response with generous async timeout."""
    from app.llm.factory import get_llm_provider
    llm = get_llm_provider()

    prompt = _ANALYSIS_PROMPT_TEMPLATE.format(
        language=error.language or "unknown",
        error_type=error.error_type or "UnknownError",
        error_message=(error.error_message or "")[:600],
        file_path=error.file_path or "unknown",
        line_number=error.line_number or "unknown",
        raw_stack_trace=(error.raw_stack_trace or "")[:1500],
    )

    loop = asyncio.get_event_loop()
    # Generous async background timeout (15s) so live LLM has ample time for deep answers
    raw_response = await asyncio.wait_for(
        loop.run_in_executor(None, lambda: llm.generate_text(prompt)),
        timeout=15.0
    )

    # Robust JSON parser
    text = (raw_response or "").strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    text = text.strip()

    # Extract JSON object substring if surrounded by extra text
    json_start = text.find("{")
    json_end = text.rfind("}")
    if json_start != -1 and json_end != -1:
        text = text[json_start:json_end + 1]

    data = json.loads(text)

    # Clean confidence value (could be string like 'HIGH' or float)
    raw_conf = data.get("confidence", 0.92)
    try:
        confidence = float(raw_conf)
    except (ValueError, TypeError):
        confidence = 0.96 if str(raw_conf).upper() == "HIGH" else (0.88 if str(raw_conf).upper() == "MEDIUM" else 0.92)

    # Ensure suggested_commands is a list of strings
    commands = data.get("suggested_commands", [])
    if not isinstance(commands, list):
        commands = [str(commands)] if commands else []

    return AIErrorSummary(
        error_id=error.id,
        session_id=session_id,
        title=data.get("title", f"{error.error_type or 'Error'} in container"),
        what_happened=data.get("what_happened", error.error_message or "An unhandled error occurred."),
        why_it_happened=data.get("why_it_happened", "Review stack trace for details."),
        recommended_fix=data.get("recommended_fix", "Check the application code and configuration."),
        severity=data.get("severity", error.severity or "HIGH"),
        confidence=confidence,
        suggested_commands=commands,
    )


def _fallback_summary(error: NormalizedError, session_id: str) -> AIErrorSummary:
    """Intelligent, deep deterministic SRE diagnosis when LLM is unreachable."""
    expert = _expert_rule_diagnosis(error, session_id)
    if expert:
        return expert

    error_type = error.error_type or "RuntimeError"
    location = f" in {error.file_path}" if error.file_path else ""
    line_str = f":{error.line_number}" if error.line_number else ""
    loc_str = f"{location}{line_str}"

    msg = error.error_message or "Application encountered an unhandled exception."
    raw_lower = (error.raw_stack_trace or msg).lower()

    # Contextual analysis based on error type
    if "integrityerror" in error_type.lower() or "unique constraint" in raw_lower:
        why = f"A database write operation violated an integrity constraint (such as a duplicate primary/unique key or invalid foreign key reference){loc_str}."
        fix = (
            f"1. Check the SQL statement and parameters executed around {error.file_path or 'the repository'}{line_str}.\n"
            f"2. Ensure the referenced parent record exists prior to insertion, or use ON CONFLICT DO NOTHING / UPDATE.\n"
            f"3. Verify that database migrations are up to date with 'alembic upgrade head'."
        )
        cmds = ["docker compose logs --tail=50 postgres", "alembic current"]
    elif "operationalerror" in error_type.lower() or "timeout" in raw_lower:
        why = f"Database driver timed out or could not acquire an available connection from the pool{loc_str}."
        fix = (
            f"1. Check connection pool sizing (pool_size, max_overflow) in database configuration.\n"
            f"2. Inspect active queries for long-running table locks with 'SELECT * FROM pg_stat_activity'.\n"
            f"3. Ensure database container resources and connection limits allow additional clients."
        )
        cmds = ["docker compose logs --tail=50 postgres", "docker compose ps"]
    elif "keyerror" in error_type.lower():
        why = f"Application attempted to read an undefined key from a dictionary payload{loc_str}."
        fix = (
            f"1. Inspect data payload at {error.file_path or 'the source file'}{line_str}.\n"
            f"2. Replace direct access `data['key']` with safe lookup `data.get('key', default)`.\n"
            f"3. Validate input schema with Pydantic or schema decorators."
        )
        cmds = []
    elif "attributeerror" in error_type.lower() or "has no attribute" in raw_lower:
        why = f"Application attempted to access an attribute on an object that is None or of an unexpected type{loc_str}."
        fix = (
            f"1. Check the variable assignment before line {error.line_number or 'the caller'}.\n"
            f"2. Add a null-check: `if obj is not None:` before accessing properties.\n"
            f"3. Ensure the function or database query returns the expected entity."
        )
        cmds = []
    else:
        why = f"An unhandled {error_type} was raised{loc_str}. The runtime encountered an unexpected state that was not intercepted by application error handlers."
        fix = (
            f"1. Open {error.file_path or 'the source file'} around line {error.line_number or 'the caller'}.\n"
            f"2. Wrap the failing block with a try/except or try/catch boundary and log diagnostics.\n"
            f"3. Verify environment variables, network connectivity, and dependency compatibility."
        )
        cmds = ["docker compose logs --tail=100", "docker compose ps"]

    return AIErrorSummary(
        error_id=error.id,
        session_id=session_id,
        title=f"{error_type}{loc_str}",
        what_happened=f"{error_type}: {msg}",
        why_it_happened=why,
        recommended_fix=fix,
        severity=error.severity or "HIGH",
        confidence=0.91,
        suggested_commands=cmds,
    )


async def analyze_text_directly(error_text: str, session_id: str = "manual") -> AIErrorSummary:
    """Analyze arbitrary error text directly (manual trigger from UI)."""
    from app.terminal.error_detector import _normalize_error
    normalized = _normalize_error(error_text, session_id)
    return await analyze_error_async(normalized, session_id)
