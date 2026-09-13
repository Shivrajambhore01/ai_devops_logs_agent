/**
 * GitHub Monitor API client.
 * Dedicated client for GitHub Monitor:
 * - Credentials & connectivity verification
 * - Repository discovery & search
 * - Multi-branch commit history
 * - Deep AI Commit Intelligence
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8090'

export const STORAGE_KEY_TOKEN = 'github_monitor_token'
export const STORAGE_KEY_DISCONNECTED = 'github_monitor_disconnected'

export function getClientGitHubToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(STORAGE_KEY_TOKEN)
}

export function saveClientGitHubToken(token: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY_TOKEN, token.trim())
  localStorage.removeItem(STORAGE_KEY_DISCONNECTED)
}

export function clearClientGitHubToken(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_KEY_TOKEN)
  localStorage.setItem(STORAGE_KEY_DISCONNECTED, 'true')
}

export function isExplicitlyDisconnected(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(STORAGE_KEY_DISCONNECTED) === 'true'
}

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
  const ghToken = getClientGitHubToken()
  const disconnected = isExplicitlyDisconnected()

  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(ghToken ? { 'X-GitHub-Token': ghToken } : {}),
    ...(disconnected && !ghToken ? { 'X-GitHub-Disconnected': 'true' } : {}),
  }
}

async function ghFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}/api/v1/github-monitor${path}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  let res: Response
  try {
    res = await fetch(url, { ...init, headers: authHeaders(), signal: controller.signal })
  } catch (netErr: any) {
    clearTimeout(timeoutId)
    if (netErr.name === 'AbortError') {
      throw new Error('Connection to server timed out after 10s. Please retry.')
    }
    // Only attempt localhost/127.0.0.1 fallback on genuine network drops (e.g. ECONNREFUSED)
    try {
      const fallback = url.includes('127.0.0.1')
        ? url.replace('127.0.0.1', 'localhost')
        : url.replace('localhost', '127.0.0.1')
      res = await fetch(fallback, { ...init, headers: authHeaders() })
    } catch {
      throw new Error('Backend server is unreachable. Please verify backend is running on port 8090.')
    }
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).detail || `GitHub Monitor error (${res.status})`)
  }
  return res.json() as Promise<T>
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GitHubUserProfile {
  login: string
  name: string
  avatar_url: string
  html_url: string
  bio?: string
  public_repos: number
  total_private_repos: number
  followers?: number
}

export interface GitHubStatusResponse {
  connected: boolean
  has_system_token?: boolean
  user: GitHubUserProfile | null
  message?: string
  error?: string
  token_masked?: string
}

export interface GitHubRepository {
  id: number
  name: string
  full_name: string
  owner: {
    login: string
    avatar_url: string
  }
  private: boolean
  html_url: string
  description?: string
  default_branch: string
  updated_at: string
  pushed_at?: string
  language: string
  stargazers_count: number
  forks_count: number
  open_issues_count: number
}

export interface GitHubCommitItem {
  sha: string
  short_sha: string
  message: string
  author_name: string
  author_avatar?: string
  author_email?: string
  date: string
  html_url: string
  branch: string
}

export interface BranchWithCommits {
  name: string
  is_default: boolean
  commits_count: number
  commits: GitHubCommitItem[]
}

export interface BranchesWithCommitsResponse {
  owner: string
  repo: string
  default_branch: string
  branches_count: number
  branches: BranchWithCommits[]
}

export interface CommitAIAnalysis {
  sha: string
  short_sha: string
  intent: string
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  breaking_changes: boolean
  security_issues: string[]
  devops_impact: string[]
  recommended_tests: string[]
}

export interface BranchAIReport {
  branch: string
  overall_health: 'HEALTHY' | 'NEEDS_REVIEW' | 'AT_RISK'
  summary: string
  top_risk: string
  commit_analyses: CommitAIAnalysis[]
}


// ── API Calls ──────────────────────────────────────────────────────────────────

/** Check GitHub connection status */
export async function getGitHubStatus(token?: string): Promise<GitHubStatusResponse> {
  const effectiveToken = token || getClientGitHubToken()
  if (isExplicitlyDisconnected() && !effectiveToken) {
    return {
      connected: false,
      user: null,
      message: 'GitHub is disconnected. Please connect using your Personal Access Token credentials.',
    }
  }
  const query = effectiveToken ? `?token=${encodeURIComponent(effectiveToken)}` : ''
  return ghFetch<GitHubStatusResponse>(`/status${query}`)
}

/** Validate and connect a GitHub PAT */
export async function connectGitHubToken(token: string): Promise<{ success: boolean; message: string; user: GitHubUserProfile }> {
  const res = await ghFetch<{ success: boolean; message: string; user: GitHubUserProfile }>('/connect', {
    method: 'POST',
    body: JSON.stringify({ token: token.trim() }),
  })
  if (res.success) {
    saveClientGitHubToken(token)
  }
  return res
}

/** Connect using pre-configured GITHUB_TOKEN from .env */
export async function connectGitHubEnvToken(): Promise<{ success: boolean; message: string; user: GitHubUserProfile; token?: string }> {
  const res = await ghFetch<{ success: boolean; message: string; user: GitHubUserProfile; token?: string }>('/connect-env', {
    method: 'POST',
  })
  if (res.success && res.token) {
    saveClientGitHubToken(res.token)
  }
  return res
}

/** Disconnect GitHub PAT */
export async function disconnectGitHub(): Promise<{ success: boolean; message: string }> {
  clearClientGitHubToken()
  return ghFetch('/disconnect', { method: 'POST' })
}

/** Fetch repositories accessible to the token */
export async function fetchGitHubRepos(search?: string, token?: string): Promise<GitHubRepository[]> {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (token) params.set('token', token)
  const qs = params.toString()
  return ghFetch<GitHubRepository[]>(`/repos${qs ? '?' + qs : ''}`)
}

/** Fetch all branches for a repository */
export async function fetchRepoBranches(owner: string, repo: string, token?: string): Promise<string[]> {
  const query = token ? `?token=${encodeURIComponent(token)}` : ''
  return ghFetch<string[]>(`/repos/${owner}/${repo}/branches${query}`)
}

/** Fetch last N commits for a branch */
export async function fetchRepoCommits(
  owner: string,
  repo: string,
  branch?: string,
  limit: number = 5,
  token?: string
): Promise<GitHubCommitItem[]> {
  const params = new URLSearchParams()
  if (branch) params.set('branch', branch)
  if (limit) params.set('limit', String(limit))
  if (token) params.set('token', token)
  const qs = params.toString()
  return ghFetch<GitHubCommitItem[]>(`/repos/${owner}/${repo}/commits${qs ? '?' + qs : ''}`)
}

/** Fetch all branches and their respective last 5 commits */
export async function fetchBranchesWithCommits(
  owner: string,
  repo: string,
  token?: string
): Promise<BranchesWithCommitsResponse> {
  const query = token ? `?token=${encodeURIComponent(token)}` : ''
  return ghFetch<BranchesWithCommitsResponse>(`/repos/${owner}/${repo}/branches-with-commits${query}`)
}

/** Run AI Commit Intelligence on a branch's commits */
export async function analyzeBranchCommits(
  owner: string,
  repo: string,
  branch?: string,
  commits?: GitHubCommitItem[],
  token?: string
): Promise<BranchAIReport> {
  const query = token ? `?token=${encodeURIComponent(token)}` : ''
  return ghFetch<BranchAIReport>(`/repos/${owner}/${repo}/analyze${query}`, {
    method: 'POST',
    body: JSON.stringify({ branch, commits }),
  })
}

export interface CommitDiffFile {
  filename: string
  status: string
  additions: number
  deletions: number
  patch?: string
}

export interface ChangeItemBreakdown {
  category: 'SECURITY' | 'FEATURE' | 'INFRASTRUCTURE' | 'BUG_FIX' | 'REFACTOR' | 'TEST'
  title: string
  user_explanation: string
  technical_detail?: string
  before_and_after?: {
    before: string
    after: string
  }
}

export interface CommitDeepAnalysisResponse {
  sha: string
  short_sha: string
  message: string
  author_name: string
  author_avatar?: string
  date: string
  html_url: string
  stats: {
    total?: number
    additions?: number
    deletions?: number
  }
  files: CommitDiffFile[]
  analysis: {
    summary?: string
    key_takeaways?: string[]
    changes_breakdown?: ChangeItemBreakdown[]
    what_was_done: string
    risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    risk_justification: string
    breaking_changes: string
    security_analysis: string
    devops_impact: string[]
    recommended_tests: string[]
  }
}

/** Fetch deep, diff-based AI analysis for a specific commit */
export async function fetchCommitDeepAnalysis(
  owner: string,
  repo: string,
  commitSha: string,
  token?: string
): Promise<CommitDeepAnalysisResponse> {
  const query = token ? `?token=${encodeURIComponent(token)}` : ''
  return ghFetch<CommitDeepAnalysisResponse>(`/repos/${owner}/${repo}/commits/${commitSha}/deep-analysis${query}`)
}

