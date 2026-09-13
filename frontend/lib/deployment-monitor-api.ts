/**
 * Deployment Monitor API client.
 * Handles credentials, project listing, log fetching, and AI analysis for:
 *   - Vercel
 *   - Railway
 *   - Render
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8090'

export type DeploymentPlatform = 'vercel' | 'railway' | 'render'

const STORAGE_KEY = 'deployment_monitor_creds'
const STORAGE_DISCONNECTED = 'deployment_monitor_disconnected'

// ── LocalStorage credential management ───────────────────────────────────────

export interface DeploymentCreds {
  platform: DeploymentPlatform
  token: string
}

export function getSavedDeploymentCreds(): DeploymentCreds | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveDeploymentCreds(creds: DeploymentCreds): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(creds))
  localStorage.removeItem(STORAGE_DISCONNECTED)
}

export function clearDeploymentCreds(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
  localStorage.setItem(STORAGE_DISCONNECTED, 'true')
}

export function isDeploymentDisconnected(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(STORAGE_DISCONNECTED) === 'true'
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function deployHeaders(creds?: DeploymentCreds | null): HeadersInit {
  const authToken = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
  const c = creds || getSavedDeploymentCreds()
  return {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(c?.token ? { 'X-Deploy-Token': c.token } : {}),
    ...(c?.platform ? { 'X-Deploy-Platform': c.platform } : {}),
  }
}

async function deployFetch<T>(path: string, init: RequestInit = {}, creds?: DeploymentCreds | null): Promise<T> {
  const url = `${API_BASE}/api/v1/deployment-monitor${path}`
  const headers = deployHeaders(creds)
  let res = await fetch(url, { ...init, headers })
  if (!res.ok) {
    const fallback = url.includes('127.0.0.1')
      ? url.replace('127.0.0.1', 'localhost')
      : url.replace('localhost', '127.0.0.1')
    res = await fetch(fallback, { ...init, headers })
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).detail || `Deployment Monitor error ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeploymentUser {
  id: string
  name: string
  email: string
  avatar: string
  platform: DeploymentPlatform
}

export interface DeploymentStatusResponse {
  connected: boolean
  platform: DeploymentPlatform | null
  user: DeploymentUser | null
  token_masked?: string
  message?: string
  error?: string
}

export interface DeploymentProject {
  id: string
  name: string
  framework: string
  status: string
  url: string
  last_deployed: string
  deployment_id: string
}

export interface DeploymentProjectsResponse {
  platform: DeploymentPlatform
  count: number
  projects: DeploymentProject[]
}

export interface DeploymentLogsResponse {
  platform: DeploymentPlatform
  project_id: string
  deployment_id: string
  log_type?: 'runtime' | 'build' | 'all'
  log_text: string
  line_count: number
  fetched_at: string
}

export interface DeploymentLogError {
  id?: string
  title?: string
  line: string
  explanation?: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'ERROR' | 'WARN' | 'INFO'
  timestamp?: string
  what_happened?: string
  why_it_happened?: string
  recommended_fix?: string
  suggested_commands?: string[]
  confidence?: number
}

export interface DeploymentAnalysis {
  health_score: number
  health_label: 'HEALTHY' | 'DEGRADED' | 'CRITICAL'
  summary: string
  error_count: number
  warning_count: number
  errors: DeploymentLogError[]
  patterns: string[]
  recommended_actions: string[]
  deployment_success: boolean | null
}

export interface DeploymentAnalysisResponse {
  platform: DeploymentPlatform
  project_name: string
  analyzed_at: string
  analysis: DeploymentAnalysis
}

// ── API functions ─────────────────────────────────────────────────────────────

/** Get current deployment monitor connection status */
export async function getDeploymentStatus(creds?: DeploymentCreds | null): Promise<DeploymentStatusResponse> {
  return deployFetch<DeploymentStatusResponse>('/status', {}, creds)
}

/** Connect to a deployment platform with credentials */
export async function connectDeployment(
  platform: DeploymentPlatform,
  token: string
): Promise<{ success: boolean; platform: string; user: DeploymentUser; message: string }> {
  const res = await deployFetch<{ success: boolean; platform: string; user: DeploymentUser; message: string }>(
    '/connect',
    {
      method: 'POST',
      body: JSON.stringify({ platform, token: token.trim() }),
    }
  )
  if (res.success) {
    saveDeploymentCreds({ platform, token: token.trim() })
  }
  return res
}

/** Disconnect from the current deployment platform */
export async function disconnectDeployment(): Promise<{ success: boolean; message: string }> {
  clearDeploymentCreds()
  return deployFetch('/disconnect', { method: 'POST' })
}

/** Fetch all projects for the connected platform */
export async function fetchDeploymentProjects(creds?: DeploymentCreds | null): Promise<DeploymentProjectsResponse> {
  return deployFetch<DeploymentProjectsResponse>('/projects', {}, creds)
}

/** Fetch deployment logs for a specific project (runtime, build, or all) */
export async function fetchDeploymentLogs(
  projectId: string,
  deploymentId: string = '',
  logType: 'runtime' | 'build' | 'all' = 'runtime',
  creds?: DeploymentCreds | null
): Promise<DeploymentLogsResponse> {
  const qs = new URLSearchParams({
    project_id: projectId,
    deployment_id: deploymentId,
    log_type: logType,
  }).toString()
  return deployFetch<DeploymentLogsResponse>(`/logs?${qs}`, {}, creds)
}

/** AI-analyse deployment logs */
export async function analyzeDeploymentLogs(
  projectId: string,
  projectName: string,
  platform: DeploymentPlatform,
  logs: string
): Promise<DeploymentAnalysisResponse> {
  return deployFetch<DeploymentAnalysisResponse>('/analyze', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, project_name: projectName, platform, logs }),
  })
}
