'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Rocket,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Sparkles,
  KeyRound,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Clock,
  Layers,
  Activity,
  Cpu,
  Info,
  Loader2,
  Plug,
  PlugZap,
  Copy,
  Check,
  BarChart3,
  ShieldAlert,
  Lightbulb,
  Search,
  Terminal,
  Code2,
} from 'lucide-react'
import {
  type DeploymentPlatform,
  type DeploymentProject,
  type DeploymentAnalysis,
  type DeploymentCreds,
  getSavedDeploymentCreds,
  getDeploymentStatus,
  connectDeployment,
  disconnectDeployment,
  fetchDeploymentProjects,
  fetchDeploymentLogs,
  analyzeDeploymentLogs,
  isDeploymentDisconnected,
} from '@/lib/deployment-monitor-api'
import { AIProviderBadge } from '@/components/ai/AIProviderBadge'

// ── Platform metadata ─────────────────────────────────────────────────────────

const PLATFORMS: {
  key: DeploymentPlatform
  name: string
  description: string
  color: string
  accentBg: string
  accentBorder: string
  tokenUrl: string
  tokenSteps: string[]
  icon: React.ReactNode
}[] = [
  {
    key: 'vercel',
    name: 'Vercel',
    description: 'Deploy frontend apps & serverless functions',
    color: '#e2e8f0',
    accentBg: 'bg-slate-100/10',
    accentBorder: 'border-slate-400/30',
    tokenUrl: 'https://vercel.com/account/tokens',
    tokenSteps: [
      'Go to vercel.com/account/tokens',
      'Click "Create Token"',
      'Name it (e.g. ai-devops-monitor)',
      'Set scope to "Full Account"',
      'Copy the generated token',
    ],
    icon: (
      <svg className="size-6" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2L2 19.778h20L12 2z" />
      </svg>
    ),
  },
  {
    key: 'railway',
    name: 'Railway',
    description: 'Infrastructure platform for any stack',
    color: '#a855f7',
    accentBg: 'bg-purple-500/10',
    accentBorder: 'border-purple-400/30',
    tokenUrl: 'https://railway.app/account/tokens',
    tokenSteps: [
      'Go to railway.app/account/tokens',
      'Click "Create Token"',
      'Name it (e.g. ai-devops-monitor)',
      'Set expiry as needed',
      'Copy the generated token',
    ],
    icon: (
      <svg className="size-6" fill="currentColor" viewBox="0 0 24 24">
        <path d="M2.5 13.292C2.5 7.322 7.322 2.5 13.292 2.5c5.142 0 9.43 3.483 10.607 8.188H13.292A2.5 2.5 0 0110.792 13.292v7.92C5.87 19.921 2.5 16.968 2.5 13.292zm10.792 10.208v-7.708h7.708C19.92 21.315 16.967 23.5 13.292 23.5z" />
      </svg>
    ),
  },
  {
    key: 'render',
    name: 'Render',
    description: 'Cloud for web services, databases & cron jobs',
    color: '#46e3b7',
    accentBg: 'bg-emerald-500/10',
    accentBorder: 'border-emerald-400/30',
    tokenUrl: 'https://dashboard.render.com/u/settings#api-keys',
    tokenSteps: [
      'Go to dashboard.render.com/u/settings#api-keys',
      'Click "Create API Key"',
      'Name it (e.g. ai-devops-monitor)',
      'Copy the generated API key',
    ],
    icon: (
      <svg className="size-6" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm-1 14.5v-9l7 4.5-7 4.5z" />
      </svg>
    ),
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPlatformMeta(key: DeploymentPlatform) {
  return PLATFORMS.find(p => p.key === key) || PLATFORMS[0]
}

function getStatusColor(status: string): string {
  const s = status?.toUpperCase() || ''
  if (['READY', 'ACTIVE', 'SUCCEEDED', 'COMPLETED'].some(v => s.includes(v))) return 'text-[#98c379]'
  if (['BUILDING', 'DEPLOYING', 'IN_PROGRESS'].some(v => s.includes(v))) return 'text-[#e5c07b]'
  if (['ERROR', 'FAILED', 'CANCELLED'].some(v => s.includes(v))) return 'text-[#e06c75]'
  return 'text-slate-400'
}

function formatDate(raw: string): string {
  if (!raw) return '—'
  try {
    const n = Number(raw)
    const d = isNaN(n) ? new Date(raw) : new Date(n)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return raw
  }
}

function healthColor(label: string): { text: string; bg: string; border: string; ring: string } {
  if (label === 'HEALTHY') return { text: 'text-[#98c379]', bg: 'bg-[#98c379]/15', border: 'border-[#98c379]/40', ring: '#98c379' }
  if (label === 'CRITICAL') return { text: 'text-[#e06c75]', bg: 'bg-[#e06c75]/15', border: 'border-[#e06c75]/40', ring: '#e06c75' }
  return { text: 'text-[#e5c07b]', bg: 'bg-[#e5c07b]/15', border: 'border-[#e5c07b]/40', ring: '#e5c07b' }
}

function logLineColor(line: string): string {
  const l = line.toLowerCase()
  if (l.includes('[error]') || l.includes('error') || l.includes('fatal') || l.includes('fail')) return 'text-[#e06c75]'
  if (l.includes('[warn]') || l.includes('warning')) return 'text-[#e5c07b]'
  if (l.includes('[info]') || l.includes('success') || l.includes('ready')) return 'text-[#98c379]'
  if (l.includes('===')) return 'text-[#61afef] font-semibold'
  return 'text-slate-300'
}

const INCIDENT_SEV_STYLE: Record<string, { badge: string; border: string; bg: string; icon: string }> = {
  CRITICAL: { badge: 'bg-[#e06c75]/20 text-[#e06c75]', border: 'border-[#e06c75]/40', bg: 'bg-[#e06c75]/5', icon: '🚨' },
  HIGH:     { badge: 'bg-[#e5984a]/20 text-[#e5984a]', border: 'border-[#e5984a]/40', bg: 'bg-[#e5984a]/5', icon: '⚠️' },
  MEDIUM:   { badge: 'bg-[#e5c07b]/20 text-[#e5c07b]', border: 'border-[#e5c07b]/40', bg: 'bg-[#e5c07b]/5', icon: '⚠️' },
  LOW:      { badge: 'bg-[#98c379]/20 text-[#98c379]', border: 'border-[#98c379]/40', bg: 'bg-[#98c379]/5', icon: 'ℹ️' },
  WARN:     { badge: 'bg-[#e5c07b]/20 text-[#e5c07b]', border: 'border-[#e5c07b]/40', bg: 'bg-[#e5c07b]/5', icon: '⚠️' },
  ERROR:    { badge: 'bg-[#e06c75]/20 text-[#e06c75]', border: 'border-[#e06c75]/40', bg: 'bg-[#e06c75]/5', icon: '❌' },
  INFO:     { badge: 'bg-[#61afef]/20 text-[#61afef]', border: 'border-[#61afef]/40', bg: 'bg-[#61afef]/5', icon: 'ℹ️' },
}

function FormattedLogLine({ line, isNewError }: { line: string; isNewError: boolean }) {
  const httpMatch = line.match(/\[(GET|POST|PUT|DELETE|PATCH|OPTIONS)\s+(\d{3})\]/i)
  const routeMatch = line.match(/\[(\/[^\]]+)\]/)

  const timeMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\]/)
  const timeStr = timeMatch ? timeMatch[1] : ''
  let content = timeMatch ? line.slice(timeMatch[0].length).trim() : line

  let method = httpMatch ? httpMatch[1].toUpperCase() : ''
  let statusNum = httpMatch ? parseInt(httpMatch[2]) : 0
  let route = routeMatch ? routeMatch[1] : ''

  if (!method) {
    const rawHttp = line.match(/"(GET|POST|PUT|DELETE|PATCH)\s+([^\s]+)\s+HTTP\/[0-9.]+"\s+(\d{3})/)
    if (rawHttp) {
      method = rawHttp[1]
      route = rawHttp[2]
      statusNum = parseInt(rawHttp[3])
    }
  }

  const isError = line.toLowerCase().includes('[error]') || line.toLowerCase().includes('error') || statusNum >= 500
  const isWarn = line.toLowerCase().includes('[warn]') || line.toLowerCase().includes('warning') || statusNum === 404 || (statusNum >= 400 && statusNum < 500)

  return (
    <div
      className={`group flex items-start gap-2 py-0.5 px-2 rounded font-mono text-[11px] leading-relaxed transition-colors hover:bg-white/[0.04] ${
        isNewError
          ? 'bg-[#e06c75]/15 border-l-2 border-[#e06c75]'
          : isError
          ? 'bg-[#e06c75]/5 border-l-2 border-[#e06c75]/60'
          : isWarn
          ? 'bg-[#e5c07b]/5 border-l-2 border-[#e5c07b]/60'
          : ''
      }`}
    >
      {timeStr && (
        <span className="text-[#5c6370] text-[10px] shrink-0 select-none mt-0.5 w-14">
          {timeStr}
        </span>
      )}

      {statusNum > 0 && (
        <span
          className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded font-mono ${
            statusNum >= 500
              ? 'bg-[#e06c75]/20 text-[#e06c75] border border-[#e06c75]/40'
              : statusNum >= 400
              ? 'bg-[#e5c07b]/20 text-[#e5c07b] border border-[#e5c07b]/40'
              : 'bg-[#98c379]/20 text-[#98c379] border border-[#98c379]/40'
          }`}
        >
          {method || 'HTTP'} {statusNum}
        </span>
      )}

      {route && (
        <span className="text-[#61afef] font-semibold text-[11px] shrink-0">
          {route}
        </span>
      )}

      <span className={`flex-1 break-all whitespace-pre-wrap ${logLineColor(line)}`}>
        {content}
      </span>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CredentialGuide({ platform }: { platform: DeploymentPlatform }) {
  const [open, setOpen] = useState(false)
  const meta = getPlatformMeta(platform)
  return (
    <div className="mt-3 rounded-lg border border-dashed border-slate-600/50 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Info className="size-3.5" />
          How to get your {meta.name} API token
        </span>
        {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 bg-black/20">
          <ol className="space-y-1.5">
            {meta.tokenSteps.map((step, i) => (
              <li key={i} className="flex items-start gap-2.5 text-xs text-slate-400">
                <span className="flex-shrink-0 size-4 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-bold mt-0.5">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <a
            href={meta.tokenUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <ExternalLink className="size-3" />
            Open {meta.name} Token Settings
          </a>
        </div>
      )}
    </div>
  )
}

function HealthGauge({ score, label }: { score: number; label: string }) {
  const colors = healthColor(label)
  const circumference = 2 * Math.PI * 36
  const dashOffset = circumference * (1 - score / 100)
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative size-24">
        <svg className="size-24 -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="36" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
          <circle
            cx="40" cy="40" r="36" fill="none"
            stroke={colors.ring} strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-2xl font-bold tabular-nums ${colors.text}`}>{score}</span>
          <span className="text-[9px] text-slate-500 uppercase tracking-wider">score</span>
        </div>
      </div>
      <span className={`text-xs font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${colors.bg} ${colors.border} ${colors.text}`}>
        {label}
      </span>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function DeploymentMonitor() {
  const [phase, setPhase] = useState<'connect' | 'projects' | 'logs'>('connect')

  // Credential state
  const [selectedPlatform, setSelectedPlatform] = useState<DeploymentPlatform>('vercel')
  const [tokenInput, setTokenInput] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState('')
  const [connectedUser, setConnectedUser] = useState<any>(null)
  const [connectedPlatform, setConnectedPlatform] = useState<DeploymentPlatform>('vercel')

  // Projects state
  const [projects, setProjects] = useState<DeploymentProject[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [projectsError, setProjectsError] = useState('')
  const [search, setSearch] = useState('')
  const [selectedProject, setSelectedProject] = useState<DeploymentProject | null>(null)

  // Logs state
  const [logText, setLogText] = useState('')
  const [logType, setLogType] = useState<'runtime' | 'build'>('runtime')
  const [levelFilter, setLevelFilter] = useState<string | null>(null)
  const [logSearch, setLogSearch] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [logsError, setLogsError] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const autoRefreshRef = useRef<NodeJS.Timeout | null>(null)
  const prevLogTextRef = useRef<string>('')            // track previous log for diff
  const logEndRef = useRef<HTMLDivElement | null>(null) // auto-scroll anchor
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>('')
  const [newErrorLines, setNewErrorLines] = useState<string[]>([])  // auto-detected errors
  const [errorAutoAnalyzing, setErrorAutoAnalyzing] = useState(false)

  // AI view & interaction state (Docker Monitor format)
  const [aiTab, setAiTab] = useState<'incidents' | 'metrics'>('incidents')
  const [expandedIncidentId, setExpandedIncidentId] = useState<string | null>(null)
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null)

  // Analysis state
  const [analysis, setAnalysis] = useState<DeploymentAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState('')

  // Auto-restore saved creds on mount
  useEffect(() => {
    if (isDeploymentDisconnected()) return
    const saved = getSavedDeploymentCreds()
    if (!saved) return
    setSelectedPlatform(saved.platform)
    setConnecting(true)
    getDeploymentStatus(saved)
      .then(status => {
        if (status.connected && status.user) {
          setConnectedUser(status.user)
          setConnectedPlatform(saved.platform)
          setPhase('projects')
          loadProjects(saved)
        }
      })
      .catch(() => {})
      .finally(() => setConnecting(false))
  }, [])

  // Auto-refresh logs every 10 seconds when enabled
  useEffect(() => {
    if (autoRefresh && selectedProject) {
      autoRefreshRef.current = setInterval(() => {
        doFetchLogs(selectedProject, false)
      }, 10_000)  // 10s live poll
    } else {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current)
    }
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current) }
  }, [autoRefresh, selectedProject, logType])

  // Auto-scroll to bottom whenever logText changes
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [logText, autoScroll])

  const handleCopyCmd = (cmd: string) => {
    navigator.clipboard.writeText(cmd)
    setCopiedCmd(cmd)
    setTimeout(() => setCopiedCmd(null), 2000)
  }

  const loadProjects = useCallback(async (creds?: DeploymentCreds) => {
    setLoadingProjects(true)
    setProjectsError('')
    try {
      const res = await fetchDeploymentProjects(creds)
      setProjects(res.projects || [])
    } catch (err: any) {
      setProjectsError(err.message || 'Failed to load projects')
    } finally {
      setLoadingProjects(false)
    }
  }, [])

  const doConnect = async () => {
    const token = tokenInput.trim()
    if (!token) { setConnectError('Please enter your API token.'); return }
    setConnecting(true)
    setConnectError('')
    try {
      const res = await connectDeployment(selectedPlatform, token)
      setConnectedUser(res.user)
      setConnectedPlatform(selectedPlatform)
      setPhase('projects')
      await loadProjects({ platform: selectedPlatform, token })
    } catch (err: any) {
      setConnectError(err.message || 'Connection failed. Please check your token.')
    } finally {
      setConnecting(false)
    }
  }

  const doDisconnect = async () => {
    try { await disconnectDeployment() } catch { /* ignore */ }
    setConnectedUser(null)
    setProjects([])
    setSelectedProject(null)
    setLogText('')
    setAnalysis(null)
    setTokenInput('')
    setPhase('connect')
  }

  const doSelectProject = async (project: DeploymentProject) => {
    setSelectedProject(project)
    setPhase('logs')
    setLogText('')
    setAnalysis(null)
    setLogsError('')
    setAnalysisError('')
    setNewErrorLines([])
    prevLogTextRef.current = ''
    setLastUpdatedAt('')
    setLogType('runtime')
    setLevelFilter(null)
    setLogSearch('')
    setAiTab('incidents')
    setExpandedIncidentId(null)
    setAutoRefresh(true)   // live polling ON by default
    await doFetchLogs(project, true, 'runtime')
  }

  const doFetchLogs = async (
    project: DeploymentProject,
    triggerAnalysis: boolean,
    typeOverride?: 'runtime' | 'build'
  ) => {
    const activeType = typeOverride || logType
    setLoadingLogs(true)
    setLogsError('')
    try {
      const res = await fetchDeploymentLogs(project.id, project.deployment_id, activeType)
      const newLog = res.log_text
      setLogText(newLog)
      setLastUpdatedAt(new Date().toLocaleTimeString())

      // ── Error detection: diff new lines vs previous snapshot ─────────────────
      const prevLines = new Set(prevLogTextRef.current.split('\n').filter(Boolean))
      const currentLines = newLog.split('\n').filter(Boolean)
      const brandNewLines = currentLines.filter(l => !prevLines.has(l))
      const errorKeywords = ['error', 'fatal', 'failed', 'exception', 'traceback', 'crash', 'oom', 'killed', ' 500 ', ' 502 ']
      const detectedErrors = brandNewLines.filter(l =>
        errorKeywords.some(kw => l.toLowerCase().includes(kw))
      )

      if (detectedErrors.length > 0 && prevLogTextRef.current !== '') {
        // New errors appeared since last poll — auto-trigger AI analysis
        setNewErrorLines(detectedErrors)
        setErrorAutoAnalyzing(true)
        doAnalyze(project, newLog).finally(() => setErrorAutoAnalyzing(false))
      } else if (triggerAnalysis && newLog && newLog.length > 10) {
        // First load — always analyse
        doAnalyze(project, newLog)
      }

      prevLogTextRef.current = newLog
    } catch (err: any) {
      setLogsError(err.message || 'Failed to fetch logs')
    } finally {
      setLoadingLogs(false)
    }
  }

  const doAnalyze = async (project: DeploymentProject, logs: string) => {
    setAnalyzing(true)
    setAnalysisError('')
    setAnalysis(null)
    try {
      const res = await analyzeDeploymentLogs(project.id, project.name, connectedPlatform, logs)
      setAnalysis(res.analysis)
    } catch (err: any) {
      setAnalysisError(err.message || 'AI analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }

  const filteredProjects = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  const meta = getPlatformMeta(connectedPlatform)

  // ── Phase: CONNECT ──────────────────────────────────────────────────────────

  if (phase === 'connect') {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-lg">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center size-16 rounded-2xl bg-primary/15 border border-primary/30 mb-4 shadow-lg shadow-primary/10">
              <Rocket className="size-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Deployment Monitor</h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
              Connect to your deployment platform to monitor logs and get AI-powered insights.
            </p>
          </div>

          {/* Platform Selector */}
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Select Platform</p>
            <div className="grid grid-cols-3 gap-3">
              {PLATFORMS.map(p => (
                <button
                  key={p.key}
                  onClick={() => { setSelectedPlatform(p.key); setConnectError('') }}
                  className={`flex flex-col items-center gap-2 py-4 px-2 rounded-xl border transition-all duration-200 text-center ${
                    selectedPlatform === p.key
                      ? `border-primary/70 bg-primary/10 shadow-lg shadow-primary/10`
                      : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                  }`}
                  style={{ color: selectedPlatform === p.key ? p.color : undefined }}
                >
                  <span style={{ color: p.color }}>{p.icon}</span>
                  <span className="text-xs font-semibold text-foreground">{p.name}</span>
                  <span className="text-[10px] text-muted-foreground leading-tight">{p.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Token Input */}
          <div className="mb-2">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2 block">
              {getPlatformMeta(selectedPlatform).name} API Token
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type={showToken ? 'text' : 'password'}
                value={tokenInput}
                onChange={e => { setTokenInput(e.target.value); setConnectError('') }}
                onKeyDown={e => e.key === 'Enter' && doConnect()}
                placeholder={`Paste your ${getPlatformMeta(selectedPlatform).name} token here…`}
                className="w-full pl-9 pr-10 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all font-mono"
              />
              <button
                onClick={() => setShowToken(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {/* Credential Guide */}
          <CredentialGuide platform={selectedPlatform} />

          {/* Error */}
          {connectError && (
            <div className="mt-3 flex items-start gap-2 text-[#e06c75] bg-[#e06c75]/10 border border-[#e06c75]/30 rounded-lg px-3 py-2.5 text-xs">
              <AlertTriangle className="size-3.5 flex-shrink-0 mt-0.5" />
              {connectError}
            </div>
          )}

          {/* Connect Button */}
          <button
            onClick={doConnect}
            disabled={connecting || !tokenInput.trim()}
            className="mt-4 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
          >
            {connecting ? (
              <><Loader2 className="size-4 animate-spin" /> Connecting…</>
            ) : (
              <><PlugZap className="size-4" /> Connect to {getPlatformMeta(selectedPlatform).name}</>
            )}
          </button>
        </div>
      </div>
    )
  }

  // ── Phase: PROJECTS ─────────────────────────────────────────────────────────

  if (phase === 'projects') {
    return (
      <div className="space-y-6 p-1">
        {/* Header bar */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-10 rounded-xl border border-white/10 bg-white/5" style={{ color: meta.color }}>
              {meta.icon}
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{meta.name} — Connected</p>
              <p className="text-xs text-muted-foreground">
                {connectedUser?.name || connectedUser?.email || 'User'}
                <span className="ml-2 inline-flex items-center gap-1 text-[#98c379]">
                  <span className="size-1.5 rounded-full bg-[#98c379] animate-pulse" />
                  Live deployments only
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadProjects()}
              disabled={loadingProjects}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-all"
            >
              <RefreshCw className={`size-3.5 ${loadingProjects ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button
              onClick={doDisconnect}
              className="flex items-center gap-1.5 text-xs text-[#e06c75] hover:text-[#e06c75]/80 px-3 py-1.5 rounded-lg border border-[#e06c75]/30 hover:bg-[#e06c75]/10 transition-all"
            >
              <Plug className="size-3.5" /> Disconnect
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-all"
          />
        </div>

        {/* Projects Grid */}
        {loadingProjects ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm">Loading projects from {meta.name}…</p>
          </div>
        ) : projectsError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <XCircle className="size-10 text-[#e06c75]/60" />
            <p className="text-sm text-[#e06c75]">{projectsError}</p>
            <button onClick={() => loadProjects()} className="text-xs text-primary hover:underline">Retry</button>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Layers className="size-10 opacity-30" />
            <p className="text-sm font-medium">
              {search ? 'No live projects match your search.' : 'No successfully deployed projects found.'}
            </p>
            <p className="text-xs text-center max-w-xs leading-relaxed">
              {!search && 'Only projects with at least one successful (READY) deployment are shown. Deploy your project first, then refresh.'}
            </p>
            {!search && (
              <button onClick={() => loadProjects()} className="text-xs text-primary hover:underline flex items-center gap-1">
                <RefreshCw className="size-3" /> Refresh
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProjects.map(project => (
              <button
                key={project.id}
                onClick={() => doSelectProject(project)}
                className="group relative text-left p-4 rounded-xl border border-white/10 bg-white/5 hover:border-primary/40 hover:bg-primary/5 transition-all duration-200 hover:shadow-lg hover:shadow-primary/10 active:scale-[0.99]"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="size-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center" style={{ color: meta.color }}>
                      <Rocket className="size-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground leading-tight truncate max-w-[140px]">{project.name}</p>
                      <p className="text-[10px] text-muted-foreground capitalize">{project.framework}</p>
                    </div>
                  </div>
                  {/* Backend guarantees only READY deployments are returned */}
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#98c379] bg-[#98c379]/15 border border-[#98c379]/30 px-1.5 py-0.5 rounded-full">
                    <span className="size-1.5 rounded-full bg-[#98c379] animate-pulse" />
                    LIVE
                  </span>

                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Clock className="size-3" />
                    {formatDate(project.last_deployed)}
                  </div>
                  {project.url && (
                    <p className="text-[10px] text-muted-foreground truncate">{project.url}</p>
                  )}
                </div>
                <div className="absolute inset-x-4 bottom-3 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[10px] text-primary font-semibold">View logs</span>
                  <Activity className="size-3 text-primary" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Phase: LOGS + AI ANALYSIS ───────────────────────────────────────────────

  if (phase === 'logs' && selectedProject) {
    const hc = analysis ? healthColor(analysis.health_label) : null
    return (
      <div className="space-y-5 p-1">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setPhase('projects'); setSelectedProject(null); setLogText(''); setAnalysis(null) }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="size-4" />
              Projects
            </button>
            <span className="text-muted-foreground">/</span>
            <div className="flex items-center gap-2">
              <div className="size-7 rounded-lg flex items-center justify-center" style={{ color: meta.color }}>
                {meta.icon}
              </div>
              <span className="text-sm font-semibold text-foreground">{selectedProject.name}</span>
              {/* All projects are guaranteed READY from backend */}
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#98c379] bg-[#98c379]/10 px-1.5 py-0.5 rounded-full border border-[#98c379]/30">
                <span className="size-1.5 rounded-full bg-[#98c379] animate-pulse" />
                LIVE
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoRefresh(r => !r)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${
                autoRefresh
                  ? 'border-[#98c379]/40 text-[#98c379] bg-[#98c379]/10'
                  : 'border-white/10 text-muted-foreground hover:bg-white/5'
              }`}
            >
              <span className={`size-1.5 rounded-full flex-shrink-0 ${
                autoRefresh ? 'bg-[#98c379] animate-pulse' : 'bg-muted-foreground/40'
              }`} />
              {autoRefresh ? 'Live · 10s' : 'Live Off'}
            </button>
            <button
              onClick={() => doFetchLogs(selectedProject, false)}
              disabled={loadingLogs}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`size-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={() => logText && doAnalyze(selectedProject, logText)}
              disabled={analyzing || !logText}
              className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 px-3 py-1.5 rounded-lg border border-primary/30 hover:bg-primary/10 transition-all disabled:opacity-50"
            >
              <Sparkles className={`size-3.5 ${analyzing ? 'animate-pulse' : ''}`} />
              {analyzing ? 'Analysing…' : 'Re-analyse'}
            </button>
          </div>
        </div>

        {/* ⚡ Error auto-detected banner */}
        {newErrorLines.length > 0 && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-[#e06c75]/40 bg-[#e06c75]/10">
            <AlertTriangle className="size-4 flex-shrink-0 mt-0.5 text-[#e06c75] animate-pulse" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-[#e06c75]">
                {errorAutoAnalyzing
                  ? '⚡ New errors detected — AI is re-analysing automatically…'
                  : `⚡ ${newErrorLines.length} new error line${newErrorLines.length > 1 ? 's' : ''} detected in latest poll`}
              </p>
              <code className="text-[10px] mt-1 font-mono block truncate text-[#e06c75]/70">{newErrorLines[0]}</code>
            </div>
            <button onClick={() => setNewErrorLines([])} className="text-[#e06c75]/50 hover:text-[#e06c75] flex-shrink-0 transition-colors">
              <XCircle className="size-4" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
          {/* Log panel — 3/5 width */}
          <div className="xl:col-span-3 space-y-3">
            {/* Log Panel Header */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Deployment Logs</p>
                {/* Mode Selector: Runtime Logs vs Build Logs */}
                <div className="flex items-center bg-white/5 p-0.5 rounded-lg border border-white/10">
                  <button
                    onClick={() => {
                      setLogType('runtime')
                      doFetchLogs(selectedProject, false, 'runtime')
                    }}
                    className={`px-2.5 py-1 text-[11px] font-mono font-medium rounded-md transition-all ${
                      logType === 'runtime'
                        ? 'bg-primary/20 text-primary border border-primary/40 shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    ⚡ Runtime Logs
                  </button>
                  <button
                    onClick={() => {
                      setLogType('build')
                      doFetchLogs(selectedProject, false, 'build')
                    }}
                    className={`px-2.5 py-1 text-[11px] font-mono font-medium rounded-md transition-all ${
                      logType === 'build'
                        ? 'bg-primary/20 text-primary border border-primary/40 shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    🔨 Build Logs
                  </button>
                </div>
                {autoRefresh && (
                  <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[#98c379] bg-[#98c379]/10 border border-[#98c379]/20 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                    <span className="size-1 rounded-full bg-[#98c379] animate-ping" />
                    Live
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {lastUpdatedAt && (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="size-3" /> {lastUpdatedAt}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground font-mono">
                  {logText.split('\n').filter(Boolean).length} lines
                </span>
              </div>
            </div>

            {/* Docker Monitor Style Filter & Search Toolbar */}
            <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-muted/60 border border-border flex-wrap">
              {/* Level Filter Chips */}
              <div className="flex items-center gap-1.5">
                {(['ALL', 'ERROR', 'WARN', 'INFO'] as const).map(lvl => {
                  const active = (lvl === 'ALL' && levelFilter === null) || levelFilter === lvl
                  return (
                    <button
                      key={lvl}
                      onClick={() => setLevelFilter(lvl === 'ALL' ? null : (levelFilter === lvl ? null : lvl))}
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md transition-all ${
                        active
                          ? lvl === 'ERROR'
                            ? 'bg-red-500/20 text-red-500 border border-red-500/40'
                            : lvl === 'WARN'
                            ? 'bg-amber-500/20 text-amber-500 border border-amber-500/40'
                            : lvl === 'INFO'
                            ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/40'
                            : 'bg-primary/20 text-primary border border-primary/40'
                          : 'text-muted-foreground hover:text-foreground border border-transparent hover:bg-muted'
                      }`}
                    >
                      {lvl}
                    </button>
                  )
                })}
              </div>

              {/* Search Bar & Auto-scroll */}
              <div className="flex items-center gap-2 flex-1 max-w-xs justify-end">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                  <input
                    type="text"
                    value={logSearch}
                    onChange={e => setLogSearch(e.target.value)}
                    placeholder="Filter logs (e.g. /predict, 404)..."
                    className="w-full pl-7 pr-3 py-1 bg-background border border-border rounded-lg text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
                  />
                  {logSearch && (
                    <button
                      onClick={() => setLogSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
                    >
                      ×
                    </button>
                  )}
                </div>

                <button
                  onClick={() => setAutoScroll(s => !s)}
                  className={`text-[10px] font-mono px-2 py-1 rounded-md border transition-all ${
                    autoScroll
                      ? 'border-emerald-500/30 text-emerald-500 bg-emerald-500/10'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  }`}
                  title="Auto-scroll to latest line"
                >
                  ↓ Auto
                </button>

                <button
                  onClick={() => setLogText('')}
                  className="text-[10px] font-mono text-muted-foreground hover:text-red-500 px-1.5 py-1 transition-colors"
                >
                  CLR
                </button>
              </div>
            </div>

            {/* Log Stream Box */}
            <div className="relative rounded-xl border border-border bg-[#0a0f1d] overflow-hidden shadow-xs">
              {loadingLogs && !logText && (
                <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin text-primary" />
                  <span className="text-sm">Fetching {logType} logs from {meta.name}…</span>
                </div>
              )}
              {logsError && (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-[#e06c75]">
                  <XCircle className="size-8 opacity-60" />
                  <p className="text-sm">{logsError}</p>
                </div>
              )}
              {logText && (
                <div className="text-xs font-mono leading-5 p-3 max-h-[520px] overflow-y-auto overflow-x-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent space-y-0.5">
                  {logText
                    .split('\n')
                    .filter(line => {
                      if (!line.trim()) return false
                      const l = line.toLowerCase()
                      if (levelFilter) {
                        if (levelFilter === 'ERROR' && !(l.includes('[error]') || l.includes('error') || l.includes(' 500 ') || l.includes(' 502 '))) return false
                        if (levelFilter === 'WARN' && !(l.includes('[warn]') || l.includes('warning') || l.includes(' 404 ') || l.includes(' 400 '))) return false
                        if (levelFilter === 'INFO' && !(l.includes('[info]') || l.includes(' 200 ') || l.includes(' 201 ') || l.includes(' 304 '))) return false
                      }
                      if (logSearch.trim()) {
                        if (!l.includes(logSearch.toLowerCase().trim())) return false
                      }
                      return true
                    })
                    .map((line, i) => {
                      const isNewError = newErrorLines.includes(line)
                      return (
                        <FormattedLogLine
                          key={i}
                          line={line}
                          isNewError={isNewError}
                        />
                      )
                    })}
                  <div ref={logEndRef} />
                </div>
              )}
              {!loadingLogs && !logsError && !logText && (
                <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                  <Activity className="size-8 opacity-30" />
                  <p className="text-sm">No {logType} log content available yet</p>
                </div>
              )}
            </div>
          </div>

          {/* AI Analysis panel — 2/5 width — DOCKER MONITOR FORMAT */}
          <div className="xl:col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Sparkles className="size-3.5 text-primary" />
                AI Analysis
              </p>
              <AIProviderBadge />
            </div>

            {/* Docker Monitor Style Tabs */}
            <div className="flex border-b border-white/10 shrink-0 bg-white/[0.02] rounded-t-xl overflow-hidden">
              <button
                onClick={() => setAiTab('incidents')}
                className={`flex-1 py-2.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                  aiTab === 'incidents'
                    ? 'text-white border-b-2 border-primary font-bold bg-white/5'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span>🤖</span> AI Incidents ({analysis?.errors?.length || 0})
              </button>
              <button
                onClick={() => setAiTab('metrics')}
                className={`flex-1 py-2.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                  aiTab === 'metrics'
                    ? 'text-white border-b-2 border-[#61afef] font-bold bg-white/5'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span>📊</span> Health & Metrics
              </button>
            </div>

            {analyzing && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-8 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <div className="size-10 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                <p className="text-xs text-center font-medium">AI is performing deep incident analysis on your deployment logs…</p>
              </div>
            )}

            {analysisError && !analyzing && (
              <div className="rounded-xl border border-[#e06c75]/30 bg-[#e06c75]/10 p-4 text-xs text-[#e06c75] flex items-start gap-2">
                <AlertTriangle className="size-4 flex-shrink-0 mt-0.5" />
                {analysisError}
              </div>
            )}

            {!analyzing && !analysis && !analysisError && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-8 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <Sparkles className="size-8 opacity-20" />
                <p className="text-xs text-center">AI analysis will appear once logs are loaded.</p>
              </div>
            )}

            {/* TAB 1: DOCKER MONITOR STYLE INCIDENT CARDS */}
            {analysis && !analyzing && aiTab === 'incidents' && (
              <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/10">
                {(!analysis.errors || analysis.errors.length === 0) ? (
                  <div className="rounded-xl border border-[#98c379]/30 bg-[#98c379]/5 p-8 text-center space-y-2">
                    <span className="text-3xl">✅</span>
                    <p className="text-sm font-bold text-white">All Systems Operational</p>
                    <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                      No critical errors or fatal exceptions detected in the current deployment logs.
                    </p>
                  </div>
                ) : (
                  analysis.errors.map((inc, idx) => {
                    const sev = (inc.severity || 'WARN').toUpperCase()
                    const s = INCIDENT_SEV_STYLE[sev] || INCIDENT_SEV_STYLE.WARN
                    const isOpen = expandedIncidentId === (inc.id || String(idx))
                    const cardId = inc.id || String(idx)

                    return (
                      <div
                        key={cardId}
                        className={`rounded-xl border ${s.border} ${s.bg} overflow-hidden transition-all`}
                      >
                        {/* Header Button */}
                        <button
                          onClick={() => setExpandedIncidentId(isOpen ? null : cardId)}
                          className="w-full flex items-start justify-between px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
                        >
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <span className="text-base mt-0.5">{s.icon}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-white leading-snug">
                                {inc.title || inc.explanation || inc.line}
                              </p>
                              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                <span className="text-[10px] text-[#5c6370]">
                                  {inc.timestamp || 'Recent'}
                                </span>
                                <span className="text-[10px] text-[#61afef] font-mono px-1.5 py-0.2 rounded bg-[#1e1e2e]">
                                  {selectedProject.name}
                                </span>
                                {inc.confidence && (
                                  <span className="text-[10px] text-[#5c6370]">
                                    · {Math.round(inc.confidence * 100)}% confidence
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 ml-2 shrink-0">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded font-mono ${s.badge}`}>
                              {sev}
                            </span>
                            <span className="text-[#5c6370] text-xs font-bold">
                              {isOpen ? '↑' : '↓'}
                            </span>
                          </div>
                        </button>

                        {/* Expanded Docker Monitor Style Details */}
                        {isOpen && (
                          <div className="px-4 pb-4 pt-3 space-y-3 border-t border-white/10 bg-[#070712]">
                            {/* Raw Log Line Snippet */}
                            <div className="bg-[#05050c] rounded-lg border border-[#2a2a3e] p-2.5 font-mono text-[10px] text-[#abb2bf] overflow-x-auto whitespace-pre-wrap">
                              <span className="text-[#5c6370] select-none">$ LOG: </span>
                              <span className="text-[#e06c75]">{inc.line}</span>
                            </div>

                            {/* What Happened */}
                            {inc.what_happened && (
                              <div>
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#61afef] uppercase tracking-wider mb-1">
                                  <span>🔍</span> What Happened
                                </div>
                                <p className="text-xs text-[#abb2bf] leading-relaxed pl-1">
                                  {inc.what_happened}
                                </p>
                              </div>
                            )}

                            {/* Technical Root Cause */}
                            {inc.why_it_happened && (
                              <div>
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#e5c07b] uppercase tracking-wider mb-1">
                                  <span>🎯</span> Technical Root Cause
                                </div>
                                <p className="text-xs text-[#abb2bf] leading-relaxed pl-1">
                                  {inc.why_it_happened}
                                </p>
                              </div>
                            )}

                            {/* Recommended Solution & Fix */}
                            {inc.recommended_fix && (
                              <div>
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#98c379] uppercase tracking-wider mb-1">
                                  <span>🛠️</span> Recommended Solution & Fix
                                </div>
                                <div className="text-xs text-[#abb2bf] leading-relaxed pl-1 bg-[#0a0a14] p-2.5 rounded-lg border border-[#2a2a3e] whitespace-pre-wrap">
                                  {inc.recommended_fix}
                                </div>
                              </div>
                            )}

                            {/* Actionable Terminal Commands */}
                            {inc.suggested_commands && inc.suggested_commands.length > 0 && (
                              <div>
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#c678dd] uppercase tracking-wider mb-1">
                                  <Terminal className="size-3 text-[#c678dd]" /> Actionable Terminal Commands
                                </div>
                                <div className="space-y-1.5 pl-1">
                                  {inc.suggested_commands.map((cmd, cIdx) => (
                                    <div
                                      key={cIdx}
                                      className="flex items-center gap-2 bg-[#0d0d1a] rounded-lg px-2.5 py-1.5 border border-[#2a2a3e]"
                                    >
                                      <span className="text-[#56b6c2] text-[10px] font-mono">$</span>
                                      <code className="text-[10px] text-[#abb2bf] font-mono flex-1 truncate">{cmd}</code>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleCopyCmd(cmd)
                                        }}
                                        className="text-[9px] font-mono text-[#5c6370] hover:text-[#61afef] px-1.5 py-0.5 rounded bg-[#1e1e2e] transition-colors"
                                      >
                                        {copiedCmd === cmd ? 'COPIED!' : 'COPY'}
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Re-analyse button */}
                            <div className="pt-2 flex justify-end">
                              <button
                                onClick={() => logText && doAnalyze(selectedProject, logText)}
                                disabled={analyzing}
                                className="text-[9px] font-mono px-2.5 py-1 rounded bg-[#c678dd]/10 text-[#c678dd] border border-[#c678dd]/30 hover:bg-[#c678dd]/20 transition-all flex items-center gap-1.5"
                              >
                                <span>⚡</span> Re-analyze with AI
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )}

            {/* TAB 2: HEALTH & METRICS */}
            {analysis && !analyzing && aiTab === 'metrics' && (
              <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/10">
                {/* Health gauge */}
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col items-center gap-3">
                  <HealthGauge score={analysis.health_score} label={analysis.health_label} />
                  <p className="text-xs text-center text-muted-foreground leading-relaxed">{analysis.summary}</p>
                  <div className="w-full flex justify-around text-center pt-2 border-t border-white/10">
                    <div>
                      <p className="text-lg font-bold text-[#e06c75]">{analysis.error_count}</p>
                      <p className="text-[10px] text-muted-foreground">Errors</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-[#e5c07b]">{analysis.warning_count}</p>
                      <p className="text-[10px] text-muted-foreground">Warnings</p>
                    </div>
                    <div>
                      {analysis.deployment_success === true && <CheckCircle2 className="size-6 text-[#98c379] mx-auto" />}
                      {analysis.deployment_success === false && <XCircle className="size-6 text-[#e06c75] mx-auto" />}
                      {analysis.deployment_success === null && <Activity className="size-6 text-muted-foreground mx-auto opacity-50" />}
                      <p className="text-[10px] text-muted-foreground">Deploy</p>
                    </div>
                  </div>
                </div>

                {/* Patterns */}
                {analysis.patterns && analysis.patterns.length > 0 && (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                      <BarChart3 className="size-3.5 text-[#61afef]" /> Operational Patterns
                    </p>
                    {analysis.patterns.map((p, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                        <span className="text-[#61afef] mt-0.5">•</span> {p}
                      </div>
                    ))}
                  </div>
                )}

                {/* Recommendations */}
                {analysis.recommended_actions && analysis.recommended_actions.length > 0 && (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                      <Lightbulb className="size-3.5 text-[#e5c07b]" /> Strategic Recommendations
                    </p>
                    {analysis.recommended_actions.map((action, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                        <span className="flex-shrink-0 size-4 rounded-full bg-[#e5c07b]/20 text-[#e5c07b] flex items-center justify-center text-[9px] font-bold mt-0.5">
                          {i + 1}
                        </span>
                        {action}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return null
}
