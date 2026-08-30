/**
 * Docker Monitor API client.
 * Completely separate from lib/api.ts — no GitHub calls here.
 * All endpoints hit /api/v1/docker/*
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8090'
export const WS_BASE  = process.env.NEXT_PUBLIC_WS_URL  || 'ws://127.0.0.1:8090'

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function dockerFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}/api/v1/docker${path}`
  let res = await fetch(url, { ...init, headers: authHeaders() })
  if (!res.ok) {
    // Fallback localhost ↔ 127.0.0.1
    const fallback = url.includes('127.0.0.1')
      ? url.replace('127.0.0.1', 'localhost')
      : url.replace('localhost', '127.0.0.1')
    res = await fetch(fallback, { ...init, headers: authHeaders() })
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).detail || `Docker API error ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DockerContainer {
  id: string
  name: string
  status: 'running' | 'exited' | 'paused' | 'stopped' | 'created'
  image: string
  ports: string
  exit_code?: number
}

export interface DockerDaemonStatus {
  daemon_available: boolean
  total_containers: number
  running_containers: number
  mode: 'live' | 'mock'
}

export interface DockerErrorRecord {
  id: string
  session_id: string
  container_id: string
  container_name: string
  language: string | null
  error_type: string | null
  error_message: string
  file_path: string | null
  line_number: number | null
  raw_stack_trace: string
  severity: 'ERROR' | 'CRITICAL'
  created_at: string
}

export interface DockerAISummaryRecord {
  error_id: string
  title: string
  what_happened: string
  why_it_happened: string
  recommended_fix: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  confidence: number
  suggested_commands: string[]
  created_at: string
}

export interface DockerErrorWithSummary {
  error: DockerErrorRecord
  summary: DockerAISummaryRecord | null
}

// ── API calls ──────────────────────────────────────────────────────────────────

/** Check if Docker daemon is reachable */
export async function fetchDockerStatus(): Promise<DockerDaemonStatus> {
  return dockerFetch<DockerDaemonStatus>('/status')
}

/** List all containers (running + stopped) */
export async function fetchContainers(): Promise<DockerContainer[]> {
  return dockerFetch<DockerContainer[]>('/containers')
}

export interface AutoConnectResponse {
  sessions: Record<string, string>
  containers: DockerContainer[]
}

/**
 * Auto-connect all running containers.
 * Returns { sessions: { container_id: session_id }, containers: [...] }.
 */
export async function autoConnectContainers(): Promise<AutoConnectResponse> {
  return dockerFetch<AutoConnectResponse>('/auto-connect', { method: 'POST' })
}

/** Connect a single container by ID */
export async function connectContainer(containerId: string): Promise<{
  session_id: string
  container_id: string
  container_name: string
  status: string
}> {
  return dockerFetch(`/containers/${containerId}/connect`, { method: 'POST' })
}

/** Stop a streaming session */
export async function disconnectSession(sessionId: string): Promise<void> {
  await dockerFetch(`/sessions/${sessionId}`, { method: 'DELETE' })
}

/** Fetch persisted error history with optional filters */
export async function fetchDockerErrors(opts?: {
  container_id?: string
  severity?: string
  limit?: number
  offset?: number
}): Promise<DockerErrorWithSummary[]> {
  const params = new URLSearchParams()
  if (opts?.container_id) params.set('container_id', opts.container_id)
  if (opts?.severity)     params.set('severity', opts.severity)
  if (opts?.limit)        params.set('limit', String(opts.limit ?? 50))
  if (opts?.offset)       params.set('offset', String(opts.offset ?? 0))
  return dockerFetch<DockerErrorWithSummary[]>(`/errors?${params}`)
}

/** Build WebSocket URL for a session */
export function buildStreamWsUrl(sessionId: string): string {
  const base = WS_BASE.replace('http://', 'ws://').replace('https://', 'wss://')
  return `${base}/api/v1/docker/stream/${sessionId}`
}
