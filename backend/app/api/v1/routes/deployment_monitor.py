"""
Deployment Monitor API — Multi-Platform Deployment Log Observability & AI Intelligence.

Provides:
1. Platform credential verification and connection status (Vercel / Railway / Render).
2. Project/service discovery for the connected platform.
3. Recent deployment log retrieval (last 200 lines).
4. AI-powered log analysis: health scoring, error pattern detection, and recommendations.
"""
from __future__ import annotations

import json
import logging
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from app.llm.factory import get_llm_provider

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/deployment-monitor", tags=["Deployment Monitor"])


# ── In-memory credential store (per-process, resets on restart) ───────────────

_runtime_platform: Optional[str] = None       # "vercel" | "railway" | "render"
_runtime_token: Optional[str] = None
_runtime_disconnected: bool = False


# ── Schemas ───────────────────────────────────────────────────────────────────

class DeploymentConnectPayload(BaseModel):
    platform: str   # "vercel" | "railway" | "render"
    token: str


class LogAnalysisRequest(BaseModel):
    project_id: str
    project_name: str
    platform: str
    logs: str           # raw log text


# ── Platform HTTP helpers ─────────────────────────────────────────────────────

def _http_get(url: str, token: str, extra_headers: Optional[Dict[str, str]] = None) -> Any:
    """Generic authenticated HTTP GET returning parsed JSON."""
    headers: Dict[str, str] = {
        "Authorization": f"Bearer {token.strip()}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "AI-DevOps-Agent-Monitor/1.0",
    }
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        body = ""
        try:
            body = err.read().decode("utf-8")
        except Exception:
            pass
        logger.warning(f"HTTP {err.code} on {url}: {body}")
        if err.code in (401, 403):
            raise HTTPException(status_code=401, detail=f"Invalid API token for this platform (HTTP {err.code})")
        if err.code == 404:
            raise HTTPException(status_code=404, detail="Resource not found on deployment platform")
        raise HTTPException(status_code=err.code, detail=f"Platform API error: {err.reason}")
    except Exception as err:
        logger.error(f"Failed to reach deployment platform ({url}): {err}")
        raise HTTPException(status_code=502, detail=f"Cannot reach platform API: {str(err)}")


def _http_post_graphql(url: str, token: str, query: str, variables: Optional[Dict] = None) -> Any:
    """POST a GraphQL query and return parsed JSON."""
    payload = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {token.strip()}",
            "Content-Type": "application/json",
            "User-Agent": "AI-DevOps-Agent-Monitor/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        body = ""
        try:
            body = err.read().decode("utf-8")
        except Exception:
            pass
        if err.code in (401, 403):
            raise HTTPException(status_code=401, detail="Invalid Railway API token")
        raise HTTPException(status_code=err.code, detail=f"Railway API error: {err.reason} — {body[:200]}")
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"Cannot reach Railway API: {str(err)}")


# ── Platform-specific: VERCEL ─────────────────────────────────────────────────

def _vercel_get_user(token: str) -> Dict[str, Any]:
    data = _http_get("https://api.vercel.com/v2/user", token)
    user = data.get("user", data)
    return {
        "id": user.get("uid", user.get("id", "")),
        "name": user.get("name", user.get("username", "Vercel User")),
        "email": user.get("email", ""),
        "avatar": user.get("avatar", ""),
        "platform": "vercel",
    }


def _vercel_get_projects(token: str) -> List[Dict[str, Any]]:
    """
    Return only projects that have at least one READY (successfully deployed) deployment.
    For each project, resolve the latest READY deployment ID via the deployments endpoint
    so log fetching always has a valid ID.
    """
    data = _http_get("https://api.vercel.com/v9/projects?limit=100", token)
    projects = data.get("projects", [])
    result = []
    for p in projects:
        project_id = p.get("id", "")
        project_name = p.get("name", "")

        # Try to get the latest READY deployment from the deployments endpoint
        # This is more reliable than latestDeployments on the project object
        deployment_id = ""
        deployment_url = ""
        created_at = ""
        try:
            dep_data = _http_get(
                f"https://api.vercel.com/v6/deployments?projectId={project_id}&state=READY&limit=1",
                token,
            )
            deployments = dep_data.get("deployments", [])
            if deployments:
                latest = deployments[0]
                deployment_id = latest.get("uid", "")
                deployment_url = latest.get("url", "")
                created_at = str(latest.get("createdAt", ""))
        except Exception:
            # Fall back to latestDeployments on the project object
            latest_list = p.get("latestDeployments") or []
            ready = [d for d in latest_list if d.get("readyState") == "READY"]
            if ready:
                dep = ready[0]
                deployment_id = dep.get("uid", "")
                created_at = str(dep.get("createdAt", ""))

        # Skip projects with no READY deployment at all
        if not deployment_id:
            continue

        url = f"https://{deployment_url}" if deployment_url and not deployment_url.startswith("http") else deployment_url
        if not url:
            url = f"https://{project_name}.vercel.app"

        result.append({
            "id": project_id,
            "name": project_name,
            "framework": p.get("framework") or "static",
            "status": "READY",
            "url": url,
            "last_deployed": created_at,
            "deployment_id": deployment_id,
        })
    return result



def _vercel_get_logs(token: str, deployment_id: str, project_id: str = "", log_type: str = "runtime") -> str:
    """Fetch build/runtime events for a Vercel deployment.
    If deployment_id is empty, looks up the latest READY deployment for the project.
    log_type: 'runtime' (latest function/access logs), 'build' (deployment build logs), or 'all'
    """
    # Resolve deployment ID if not provided
    if not deployment_id and project_id:
        try:
            dep_data = _http_get(
                f"https://api.vercel.com/v6/deployments?projectId={project_id}&state=READY&limit=1",
                token,
            )
            deployments = dep_data.get("deployments", [])
            if deployments:
                deployment_id = deployments[0].get("uid", "")
        except Exception as err:
            return f"Could not resolve a live deployment for this project: {err}"

    if not deployment_id:
        return "No live (READY) deployment found for this project. Deploy your project on Vercel first."

    now_ms = int(datetime.utcnow().timestamp() * 1000)

    def _parse_events(events: list) -> list:
        parsed_lines = []
        for ev in events:
            if not isinstance(ev, dict):
                continue
            ts = ev.get("created") or ev.get("date") or ev.get("timestamp") or ""
            dt_str = ""
            if ts:
                try:
                    dt_val = int(ts)
                    if dt_val > 10**11:
                        dt_val /= 1000.0
                    dt_str = datetime.fromtimestamp(dt_val).strftime("%H:%M:%S")
                except Exception:
                    dt_str = str(ts)[:8]

            payload = ev.get("payload")
            ev_type = str(ev.get("type") or "log").upper()

            # 1. Handle structured runtime/access request logs or dict payload
            if isinstance(payload, dict):
                status_code = payload.get("statusCode") or payload.get("status")
                req_info = payload.get("request") if isinstance(payload.get("request"), dict) else {}
                method = payload.get("method") or req_info.get("method") or ""
                path = payload.get("path") or req_info.get("path") or payload.get("url") or ""
                dict_text = payload.get("text") or payload.get("message") or ev.get("text") or ""

                if status_code or method or path:
                    try:
                        status_num = int(status_code)
                    except Exception:
                        status_num = 200
                    level = "ERROR" if status_num >= 500 else ("WARN" if status_num >= 400 else "INFO")
                    route_part = f"[{path}]" if path else ""
                    msg_body = dict_text.strip() if dict_text else f"{method} {path} - {status_num}"
                    time_prefix = f"[{dt_str}] " if dt_str else ""
                    parsed_lines.append(f"{time_prefix}[{level}] [{method} {status_num}] {route_part} {msg_body}".strip())
                    continue
                elif dict_text:
                    # Dict payload with log line text (build logs or server logs)
                    clean_text = dict_text.strip()
                    lower_text = clean_text.lower()
                    level = ev_type
                    if " 404 " in clean_text or " 400 " in clean_text or "not found" in lower_text:
                        level = "WARN"
                    elif " 500 " in clean_text or "error" in lower_text or "fatal" in lower_text or "traceback" in lower_text:
                        level = "ERROR"
                    elif " 200 " in clean_text or " 201 " in clean_text or " 304 " in clean_text:
                        level = "INFO"
                    time_prefix = f"[{dt_str}] " if dt_str else ""
                    parsed_lines.append(f"{time_prefix}[{level}] {clean_text}")
                    continue

            # 2. Standard stdout/stderr or text event
            text = ev.get("text") or ev.get("message") or (payload if isinstance(payload, str) else "") or ""
            if not text:
                continue

            # Detect server access logs in text (e.g. 127.0.0.1 - - "POST /predict HTTP/1.1" 200)
            clean_text = text.strip()
            lower_text = clean_text.lower()
            level = ev_type
            if " 404 " in clean_text or " 400 " in clean_text or " 403 " in clean_text or "not found" in lower_text:
                level = "WARN"
            elif " 500 " in clean_text or " 502 " in clean_text or " 503 " in clean_text or "error" in lower_text or "traceback" in lower_text or "fatal" in lower_text:
                level = "ERROR"
            elif " 200 " in clean_text or " 201 " in clean_text or " 204 " in clean_text or " 304 " in clean_text:
                level = "INFO"

            time_prefix = f"[{dt_str}] " if dt_str else ""
            parsed_lines.append(f"{time_prefix}[{level}] {clean_text}")
        return parsed_lines

    try:
        if log_type == "build":
            url = f"https://api.vercel.com/v2/deployments/{deployment_id}/events?direction=forward&limit=150"
            data = _http_get(url, token)
            events = data if isinstance(data, list) else data.get("events", [])
            lines = _parse_events(events)
            return "\n".join(lines) if lines else "No build log events recorded."

        # For 'runtime' or default:
        # First attempt: backward from current time (gets newest runtime/function requests)
        url_bw = f"https://api.vercel.com/v2/deployments/{deployment_id}/events?direction=backward&until={now_ms}&limit=150"
        try:
            data_bw = _http_get(url_bw, token)
            events_bw = data_bw if isinstance(data_bw, list) else data_bw.get("events", [])
            if events_bw:
                lines_bw = _parse_events(list(reversed(events_bw)))
                if lines_bw:
                    return "\n".join(lines_bw)
        except Exception as bw_err:
            logger.warning(f"Vercel backward events query failed: {bw_err}")

        # Second attempt: standard events without direction (all recent deployment events)
        url_std = f"https://api.vercel.com/v2/deployments/{deployment_id}/events?limit=200"
        data_std = _http_get(url_std, token)
        events_std = data_std if isinstance(data_std, list) else data_std.get("events", [])
        if events_std:
            lines_std = _parse_events(events_std)
            if lines_std:
                return "\n".join(lines_std)

        # Third attempt: builds=0 (runtime function logs only)
        try:
            url_func = f"https://api.vercel.com/v2/deployments/{deployment_id}/events?builds=0&limit=100"
            data_func = _http_get(url_func, token)
            events_func = data_func if isinstance(data_func, list) else data_func.get("events", [])
            lines_func = _parse_events(events_func)
            if lines_func:
                return "\n".join(lines_func)
        except Exception:
            pass

        return "No log events recorded for this deployment yet."
    except HTTPException:
        raise
    except Exception as err:
        return f"Error fetching Vercel logs: {err}"


# ── Platform-specific: RAILWAY ────────────────────────────────────────────────

RAILWAY_GRAPHQL_URL = "https://backboard.railway.app/graphql/v2"

def _railway_get_user(token: str) -> Dict[str, Any]:
    query = """
    query {
      me {
        id
        name
        email
        avatar
      }
    }
    """
    data = _http_post_graphql(RAILWAY_GRAPHQL_URL, token, query)
    if "errors" in data:
        raise HTTPException(status_code=401, detail=f"Railway auth error: {data['errors'][0].get('message', 'Bad credentials')}")
    me = data.get("data", {}).get("me", {})
    return {
        "id": me.get("id", ""),
        "name": me.get("name", "Railway User"),
        "email": me.get("email", ""),
        "avatar": me.get("avatar", ""),
        "platform": "railway",
    }


def _railway_get_projects(token: str) -> List[Dict[str, Any]]:
    query = """
    query {
      projects {
        edges {
          node {
            id
            name
            createdAt
            updatedAt
            services {
              edges {
                node {
                  id
                  name
                  updatedAt
                }
              }
            }
          }
        }
      }
    }
    """
    data = _http_post_graphql(RAILWAY_GRAPHQL_URL, token, query)
    if "errors" in data:
        raise HTTPException(status_code=400, detail=str(data["errors"]))
    edges = data.get("data", {}).get("projects", {}).get("edges", [])
    result = []
    for edge in edges:
        node = edge.get("node", {})
        services = [s["node"] for s in node.get("services", {}).get("edges", [])]
        result.append({
            "id": node.get("id", ""),
            "name": node.get("name", ""),
            "framework": "railway",
            "status": "ACTIVE",
            "url": f"https://railway.app/project/{node.get('id', '')}",
            "last_deployed": node.get("updatedAt", node.get("createdAt", "")),
            "deployment_id": node.get("id", ""),
            "services": services,
        })
    return result


def _railway_get_logs(token: str, project_id: str) -> str:
    """Fetch deployment logs for a Railway project via GraphQL."""
    query = """
    query GetDeploymentLogs($projectId: String!) {
      deployments(input: { projectId: $projectId }, first: 5) {
        edges {
          node {
            id
            status
            createdAt
            logs {
              edges {
                node {
                  message
                  severity
                  timestamp
                }
              }
            }
          }
        }
      }
    }
    """
    try:
        data = _http_post_graphql(RAILWAY_GRAPHQL_URL, token, query, {"projectId": project_id})
        if "errors" in data:
            return f"Railway API returned errors: {data['errors']}"
        edges = data.get("data", {}).get("deployments", {}).get("edges", [])
        if not edges:
            return "No deployments found for this project."
        lines = []
        for dep_edge in edges[:3]:
            dep = dep_edge.get("node", {})
            dep_id = dep.get("id", "?")
            status = dep.get("status", "?")
            created = dep.get("createdAt", "")
            lines.append(f"=== Deployment {dep_id[:8]} | Status: {status} | {created} ===")
            log_edges = dep.get("logs", {}).get("edges", [])
            for log_edge in log_edges:
                log = log_edge.get("node", {})
                ts = log.get("timestamp", "")
                severity = log.get("severity", "INFO").upper()
                msg = log.get("message", "")
                lines.append(f"[{ts}] [{severity}] {msg}")
        return "\n".join(lines) if lines else "No log data available."
    except HTTPException:
        raise
    except Exception as err:
        return f"Error fetching Railway logs: {err}"


# ── Platform-specific: RENDER ─────────────────────────────────────────────────

RENDER_API_BASE = "https://api.render.com/v1"

def _render_get_user(token: str) -> Dict[str, Any]:
    data = _http_get(f"{RENDER_API_BASE}/owners?limit=1", token)
    owners = data if isinstance(data, list) else []
    owner = (owners[0].get("owner", {}) if owners else {})
    return {
        "id": owner.get("id", ""),
        "name": owner.get("name", "Render User"),
        "email": owner.get("email", ""),
        "avatar": "",
        "platform": "render",
    }


def _render_get_projects(token: str) -> List[Dict[str, Any]]:
    data = _http_get(f"{RENDER_API_BASE}/services?limit=50", token)
    services = data if isinstance(data, list) else []
    result = []
    for item in services:
        svc = item.get("service", item)
        result.append({
            "id": svc.get("id", ""),
            "name": svc.get("name", ""),
            "framework": svc.get("type", "web_service"),
            "status": svc.get("suspended", "not_suspended"),
            "url": svc.get("serviceDetails", {}).get("url", f"https://render.com"),
            "last_deployed": svc.get("updatedAt", ""),
            "deployment_id": svc.get("id", ""),
        })
    return result


def _render_get_logs(token: str, service_id: str) -> str:
    """Fetch deploy logs for a Render service."""
    try:
        # Get latest deploy for the service
        deploys = _http_get(f"{RENDER_API_BASE}/services/{service_id}/deploys?limit=3", token)
        if not deploys:
            return "No deploys found for this service."
        lines = []
        for item in deploys[:3]:
            deploy = item.get("deploy", item)
            deploy_id = deploy.get("id", "?")
            status = deploy.get("status", "?")
            created = deploy.get("createdAt", "")
            lines.append(f"=== Deploy {deploy_id[:8]} | Status: {status} | {created} ===")
            try:
                log_data = _http_get(
                    f"{RENDER_API_BASE}/services/{service_id}/deploys/{deploy_id}/logs",
                    token,
                )
                logs_list = log_data if isinstance(log_data, list) else log_data.get("logs", [])
                for log in logs_list[:80]:
                    ts = log.get("timestamp", "")
                    msg = log.get("message", "")
                    lines.append(f"[{ts}] {msg}")
            except Exception:
                lines.append("  (log details unavailable for this deploy)")
        return "\n".join(lines) if lines else "No log content available."
    except HTTPException:
        raise
    except Exception as err:
        return f"Error fetching Render logs: {err}"


# ── Routing by platform ───────────────────────────────────────────────────────

def _get_user(platform: str, token: str) -> Dict[str, Any]:
    if platform == "vercel":
        return _vercel_get_user(token)
    elif platform == "railway":
        return _railway_get_user(token)
    elif platform == "render":
        return _render_get_user(token)
    raise HTTPException(status_code=400, detail=f"Unsupported platform: {platform}")


def _get_projects(platform: str, token: str) -> List[Dict[str, Any]]:
    if platform == "vercel":
        return _vercel_get_projects(token)
    elif platform == "railway":
        return _railway_get_projects(token)
    elif platform == "render":
        return _render_get_projects(token)
    raise HTTPException(status_code=400, detail=f"Unsupported platform: {platform}")


def _get_logs(platform: str, token: str, project_id: str, deployment_id: str, log_type: str = "runtime") -> str:
    if platform == "vercel":
        return _vercel_get_logs(token, deployment_id, project_id, log_type)
    elif platform == "railway":
        return _railway_get_logs(token, project_id)
    elif platform == "render":
        return _render_get_logs(token, project_id)
    raise HTTPException(status_code=400, detail=f"Unsupported platform: {platform}")



# ── Token resolution helper ───────────────────────────────────────────────────

def _resolve_token(x_deploy_token: Optional[str] = None) -> Optional[str]:
    if x_deploy_token:
        return x_deploy_token.strip()
    return _runtime_token


def _resolve_platform(x_deploy_platform: Optional[str] = None) -> Optional[str]:
    if x_deploy_platform:
        return x_deploy_platform.strip().lower()
    return _runtime_platform


# ── API Endpoints ─────────────────────────────────────────────────────────────

@router.get("/status")
async def get_deployment_status(
    x_deploy_token: Optional[str] = Header(default=None),
    x_deploy_platform: Optional[str] = Header(default=None),
):
    """Return current connection state for the deployment monitor."""
    global _runtime_platform, _runtime_token, _runtime_disconnected

    token = _resolve_token(x_deploy_token)
    platform = _resolve_platform(x_deploy_platform)

    if _runtime_disconnected and not token:
        return {
            "connected": False,
            "platform": None,
            "user": None,
            "message": "Deployment monitor disconnected. Please connect with your platform credentials.",
        }

    if not token or not platform:
        return {
            "connected": False,
            "platform": platform,
            "user": None,
            "message": "No credentials provided. Select a platform and enter your API token.",
        }

    try:
        user = _get_user(platform, token)
        return {
            "connected": True,
            "platform": platform,
            "user": user,
            "token_masked": f"{'*' * (len(token) - 6)}{token[-6:]}",
            "message": f"Connected to {platform.capitalize()} as {user.get('name', 'User')}",
        }
    except HTTPException as e:
        return {
            "connected": False,
            "platform": platform,
            "user": None,
            "error": e.detail,
            "message": f"Failed to connect: {e.detail}",
        }


@router.post("/connect")
async def connect_deployment(
    payload: DeploymentConnectPayload,
):
    """Validate platform credentials and store them in-memory."""
    global _runtime_platform, _runtime_token, _runtime_disconnected

    platform = payload.platform.lower().strip()
    token = payload.token.strip()

    if platform not in ("vercel", "railway", "render"):
        raise HTTPException(status_code=400, detail=f"Unsupported platform '{platform}'. Use: vercel, railway, or render.")

    if not token:
        raise HTTPException(status_code=400, detail="API token cannot be empty.")

    user = _get_user(platform, token)  # raises 401 on bad creds

    _runtime_platform = platform
    _runtime_token = token
    _runtime_disconnected = False

    logger.info(f"Deployment monitor connected to {platform} as {user.get('name', '?')}")
    return {
        "success": True,
        "platform": platform,
        "user": user,
        "message": f"Successfully connected to {platform.capitalize()} as {user.get('name', 'User')}",
    }


@router.post("/disconnect")
async def disconnect_deployment():
    """Clear stored deployment platform credentials."""
    global _runtime_platform, _runtime_token, _runtime_disconnected

    _runtime_platform = None
    _runtime_token = None
    _runtime_disconnected = True

    logger.info("Deployment monitor disconnected.")
    return {"success": True, "message": "Disconnected from deployment platform."}


@router.get("/projects")
async def list_deployment_projects(
    x_deploy_token: Optional[str] = Header(default=None),
    x_deploy_platform: Optional[str] = Header(default=None),
):
    """List all projects/services for the connected platform."""
    token = _resolve_token(x_deploy_token)
    platform = _resolve_platform(x_deploy_platform)

    if not token or not platform:
        raise HTTPException(status_code=401, detail="Not connected to any deployment platform. Please connect first.")

    projects = _get_projects(platform, token)
    return {
        "platform": platform,
        "count": len(projects),
        "projects": projects,
    }


@router.get("/logs")
async def get_deployment_logs(
    project_id: str,
    deployment_id: str = "",
    log_type: str = "runtime",
    x_deploy_token: Optional[str] = Header(default=None),
    x_deploy_platform: Optional[str] = Header(default=None),
):
    """Fetch recent deployment logs for a specific project.
    log_type: 'runtime' (latest function/access logs), 'build' (deployment build logs), or 'all'
    """
    token = _resolve_token(x_deploy_token)
    platform = _resolve_platform(x_deploy_platform)

    if not token or not platform:
        raise HTTPException(status_code=401, detail="Not connected. Please provide credentials.")

    log_text = _get_logs(platform, token, project_id, deployment_id, log_type)
    return {
        "platform": platform,
        "project_id": project_id,
        "deployment_id": deployment_id,
        "log_type": log_type,
        "log_text": log_text,
        "line_count": len(log_text.splitlines()),
        "fetched_at": datetime.utcnow().isoformat() + "Z",
    }


@router.post("/analyze")
async def analyze_deployment_logs(payload: LogAnalysisRequest):
    """AI-powered analysis of deployment logs in Docker Monitor style format."""
    if not payload.logs or len(payload.logs.strip()) < 10:
        raise HTTPException(status_code=400, detail="Log content is too short to analyze.")

    # Truncate very large logs to avoid token limits
    log_content = payload.logs[:8000] if len(payload.logs) > 8000 else payload.logs

    system_prompt = (
        "You are a senior DevOps SRE and deployment pipeline reliability expert. "
        "You perform deep, granular root-cause analysis on deployment & runtime logs (Docker, Vercel, Railway, Render). "
        "For every detected error, 4xx/5xx failure, or warning, you provide an actionable Docker-Monitor style incident breakdown. "
        "Always respond with valid JSON only — no markdown backticks, no extra text."
    )

    prompt = f"""Analyse the following deployment and runtime logs from the '{payload.project_name}' project on {payload.platform.capitalize()}.

=== LOGS START ===
{log_content}
=== LOGS END ===

Return a JSON object strictly matching this schema:
{{
  "health_score": <integer 0-100, 100=perfectly healthy>,
  "health_label": "<HEALTHY | DEGRADED | CRITICAL>",
  "summary": "<2-3 sentence executive summary of deployment and runtime health>",
  "error_count": <integer count of errors and 4xx/5xx failures>,
  "warning_count": <integer count of warnings, missing configs, or non-critical 404s>,
  "errors": [
    {{
      "id": "inc_1",
      "title": "<concise incident title, e.g. '404 Not Found on /favicon.ico' or 'Large bundle size (343.57 MB) exceeds quota'>",
      "severity": "<CRITICAL | HIGH | MEDIUM | LOW | WARN>",
      "line": "<exact relevant log line snippet>",
      "timestamp": "<extracted timestamp or 'Recent'>",
      "what_happened": "<clear 1-2 sentence explanation of the symptom>",
      "why_it_happened": "<technical root cause explaining why this happened in the code or deployment>",
      "recommended_fix": "<step-by-step actionable fix with code/config instructions>",
      "suggested_commands": ["<terminal command 1>", "<terminal command 2>"],
      "confidence": <float between 0.85 and 0.99>
    }}
  ],
  "patterns": ["<pattern 1>", "<pattern 2>"],
  "recommended_actions": ["<action 1>", "<action 2>", "<action 3>"],
  "deployment_success": <true | false | null if unknown>
}}

Guidelines:
- Analyze both build issues (e.g. large bundle size, missing python version specification) and runtime issues (e.g. 404 on /favicon.ico, API endpoint errors, uncaught exceptions).
- For each error/issue, provide realistic copyable terminal commands in suggested_commands (e.g. touch static/favicon.ico, echo '3.12' > .python-version, vercel env pull).
- Deduct points for 5xx errors (-25), build failures (-35), 404 errors (-8), bundle size warnings (-12)."""

    llm = get_llm_provider()
    try:
        raw = llm.generate_text(prompt, system_prompt)
        clean = raw.replace("```json", "").replace("```", "").strip()
        analysis = json.loads(clean)
    except Exception as err:
        logger.error(f"AI log analysis JSON parse failed: {err}")
        # Build intelligent fallback with Docker-style error cards
        detected_incidents = []
        lines = payload.logs.splitlines()
        for idx, line in enumerate(lines):
            lower_l = line.lower()
            if "404" in line or "not found" in lower_l:
                detected_incidents.append({
                    "id": f"inc_{idx+1}",
                    "title": "404 Not Found: Requested Resource Missing",
                    "severity": "WARN",
                    "line": line.strip()[:180],
                    "timestamp": "Recent",
                    "what_happened": "A client requested a route or static file that was not served by the application.",
                    "why_it_happened": "The file or endpoint route is either missing from the project directory or not routed in server config.",
                    "recommended_fix": "Add the missing static file to your static directory, or add a route handler.",
                    "suggested_commands": ["touch static/favicon.ico", "git status"],
                    "confidence": 0.90,
                })
            elif "bundle size" in lower_l or "exceeds" in lower_l:
                detected_incidents.append({
                    "id": f"inc_{idx+1}",
                    "title": "Bundle Size Exceeds Standard Limits",
                    "severity": "MEDIUM",
                    "line": line.strip()[:180],
                    "timestamp": "Recent",
                    "what_happened": "The deployment payload exceeds standard serverless function bundle limits.",
                    "why_it_happened": "Heavy machine learning models, uncompressed assets, or heavy virtualenv packages are bundled directly into the function.",
                    "recommended_fix": "Examine dependencies in requirements.txt. Use .vercelignore to exclude large data files, models, or caches.",
                    "suggested_commands": ["echo '*.pt\n*.pkl\n*.csv' >> .vercelignore", "git add .vercelignore"],
                    "confidence": 0.92,
                })
            elif "no python version" in lower_l:
                detected_incidents.append({
                    "id": f"inc_{idx+1}",
                    "title": "Missing Python Version Specification",
                    "severity": "LOW",
                    "line": line.strip()[:180],
                    "timestamp": "Recent",
                    "what_happened": "No Python version was pinned, forcing Vercel to use the default runtime version.",
                    "why_it_happened": "Neither .python-version, pyproject.toml, nor Pipfile.lock specified a pinned version.",
                    "recommended_fix": "Add a .python-version file containing your target Python version (e.g. 3.12).",
                    "suggested_commands": ["echo '3.12' > .python-version", "git add .python-version"],
                    "confidence": 0.95,
                })

        err_cnt = payload.logs.lower().count("error") + payload.logs.count(" 500 ")
        warn_cnt = payload.logs.lower().count("warn") + payload.logs.count(" 404 ")

        analysis = {
            "health_score": 85 if not err_cnt else 60,
            "health_label": "HEALTHY" if not err_cnt and warn_cnt <= 2 else ("DEGRADED" if not err_cnt else "CRITICAL"),
            "summary": "Deployment is live with active requests. Minor route warnings and configuration opportunities detected.",
            "error_count": err_cnt,
            "warning_count": warn_cnt,
            "errors": detected_incidents[:6],
            "patterns": ["Active live traffic detected", "Resource optimization opportunities identified"],
            "recommended_actions": [
                "Address missing static assets (e.g. favicon.ico)",
                "Pin Python runtime in .python-version",
                "Optimize bundle size using .vercelignore",
            ],
            "deployment_success": True,
        }

    return {
        "platform": payload.platform,
        "project_name": payload.project_name,
        "analyzed_at": datetime.utcnow().isoformat() + "Z",
        "analysis": analysis,
    }
