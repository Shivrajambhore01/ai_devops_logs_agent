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

export interface DockerImage {
  id: string
  repository: string
  tag: string
  size: number
  size_mb: number
  created: string
  containers_using: number
}

export interface DockerDaemonStatus {
  daemon_available: boolean
  total_containers: number
  running_containers: number
  total_images: number
  mode: 'live' | 'mock' | 'offline'
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

/** List all containers (cached, < 1ms) */
export async function fetchContainers(): Promise<DockerContainer[]> {
  return dockerFetch<DockerContainer[]>('/containers')
}

/** Fetch detailed inspection metadata for a single container */
export async function fetchContainerDetail(containerId: string): Promise<Record<string, any>> {
  return dockerFetch<Record<string, any>>(`/containers/${containerId}`)
}

/** List all local cached images (< 1ms) */
export async function fetchImages(): Promise<DockerImage[]> {
  return dockerFetch<DockerImage[]>('/images')
}

/** On-demand deep inspection of a specific image */
export async function fetchImageDetail(imageId: string): Promise<Record<string, any>> {
  return dockerFetch<Record<string, any>>(`/images/${imageId}`)
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

/** Fetch persisted error history with optional keyset cursor ('before') and time filters ('hours', 'since') */
export async function fetchDockerErrors(opts?: {
  container_id?: string
  severity?: string
  limit?: number
  offset?: number
  before?: string
  hours?: number
  since?: string
}): Promise<DockerErrorWithSummary[]> {
  const params = new URLSearchParams()
  if (opts?.container_id) params.set('container_id', opts.container_id)
  if (opts?.severity)     params.set('severity', opts.severity)
  if (opts?.limit)        params.set('limit', String(opts.limit ?? 50))
  if (opts?.offset)       params.set('offset', String(opts.offset ?? 0))
  if (opts?.before)       params.set('before', opts.before)
  if (opts?.hours != null) params.set('hours', String(opts.hours))
  if (opts?.since)        params.set('since', opts.since)
  return dockerFetch<DockerErrorWithSummary[]>(`/errors?${params}`)
}

/** Clear all persisted error records from the database */
export async function clearDockerErrors(): Promise<void> {
  await dockerFetch('/errors', { method: 'DELETE' })
}

/** Re-run AI analysis on a specific error by ID */
export async function reanalyzeDockerError(errorId: string): Promise<DockerAISummaryRecord> {
  return dockerFetch<DockerAISummaryRecord>(`/errors/${errorId}/reanalyze`, { method: 'POST' })
}

/** Batch re-analyze all recent errors */
export async function reanalyzeAllDockerErrors(): Promise<{ status: string; reanalyzed_count: number; summaries: any[] }> {
  return dockerFetch<{ status: string; reanalyzed_count: number; summaries: any[] }>('/errors/reanalyze-all', { method: 'POST' })
}

/**
 * Build WebSocket URL for a session or multiplexed dashboard stream.
 * Supports resume_from sequence for seamless reconnect replay.
 */
export function buildStreamWsUrl(sessionId?: string, resumeFrom?: number | null): string {
  const base = WS_BASE.replace('http://', 'ws://').replace('https://', 'wss://')
  const path = sessionId ? `/api/v1/docker/stream/${sessionId}` : `/api/v1/docker/stream`
  const params = new URLSearchParams()
  if (resumeFrom != null) {
    params.set('resume_from', String(resumeFrom))
  }
  const qs = params.toString()
  return `${base}${path}${qs ? '?' + qs : ''}`
}
