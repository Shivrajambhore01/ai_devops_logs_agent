'use client'

import { useMemo, useState, useEffect, useCallback } from 'react'
import { Activity, AlertTriangle, ArrowUpRight, Bot, Boxes, Check, ChevronDown, CircleHelp, Cloud, Code2, Command, ExternalLink, FileCode2, GitBranch, GitCommit, KeyRound, LayoutDashboard, ListFilter, LoaderCircle, Logs, Menu, Moon, MoreHorizontal, PackageCheck, Play, Plus, RefreshCw, Search, Server, Settings, ShieldCheck, Sparkles, Sun, TerminalSquare, UserRound, X, Zap, Terminal, Container } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { activities, deployments, healthTrend, incidents as initialIncidents, logs, repositories as initialRepositories } from '@/lib/demo-data'
import type { EvidenceItem, FixState, Incident, IncidentStatus, NavKey, Severity } from '@/lib/types'
import {
  fetchIncidents, fetchRepositories, approveFix as apiApproveFix, createIncident as apiCreateIncident,
  connectRepository as apiConnectRepo, deleteIncident as apiDeleteIncident, reinvestigateIncident as apiReinvestigate,
  loginUser, registerUser, fetchCurrentUser, forgotPassword, resetPassword, updateGitHubToken, disconnectGitHubToken,
  fetchRepositoryBranches, fetchIncidentLogs,
  fetchAllowedCommands, fetchDockerContainers, startLocalTerminal, startDockerTerminal,
  stopLocalTerminal, stopDockerTerminal, createIncidentFromTerminalError
} from '@/lib/api'
import { TerminalConsole } from '@/components/terminal/TerminalConsole'
import { AIErrorSummaryPanel } from '@/components/terminal/AIErrorSummaryPanel'
import type { AIErrorSummary } from '@/lib/websocket'


const navItems: { key: NavKey; label: string; icon: typeof Activity; count?: number }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'incidents', label: 'Incidents', icon: AlertTriangle, count: 3 },
  { key: 'repositories', label: 'Repositories', icon: Code2 },
  { key: 'deployments', label: 'Deployments', icon: PackageCheck },
  { key: 'agent', label: 'Agent activity', icon: Bot },
  { key: 'logs', label: 'Logs', icon: TerminalSquare },
  { key: 'terminal', label: 'Terminal Hub', icon: Terminal },
  { key: 'docker', label: 'Docker Monitor', icon: Container },
]

const severityClass: Record<Severity, string> = { critical: 'text-destructive bg-destructive/10 border-destructive/20', high: 'text-amber-600 bg-amber-500/10 border-amber-500/20', medium: 'text-primary bg-primary/10 border-primary/20', low: 'text-muted-foreground bg-muted border-border' }
const statusClass: Record<IncidentStatus, string> = { investigating: 'text-amber-600', identified: 'text-primary', monitoring: 'text-muted-foreground', resolved: 'text-emerald-600' }

function Pill({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${className}`}>{children}</span> }
function SectionTitle({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) { return <div className="flex items-end justify-between gap-4"><div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">{eyebrow}</p><h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">{title}</h2></div>{action}</div> }
function Sparkline() { return <div className="flex h-12 items-end gap-1" aria-label="Health trend sparkline">{healthTrend.map((v, i) => <span key={i} className={`flex-1 rounded-t-sm ${i > 15 ? 'bg-primary' : 'bg-primary/30'}`} style={{ height: `${Math.max(18, v - 20)}%` }} />)}</div> }
function StatusDot({ status }: { status: 'healthy' | 'degraded' | 'running' | 'passed' | 'failed' }) { return <span className={`size-1.5 rounded-full ${status === 'failed' || status === 'degraded' ? 'bg-destructive' : status === 'running' ? 'animate-pulse bg-amber-500' : 'bg-emerald-500'}`} /> }

export function CommandCenter() {
  const [active, setActive] = useState<NavKey>('overview')
  const [selected, setSelected] = useState<Incident | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [mobileNav, setMobileNav] = useState(false)
  const [query, setQuery] = useState('')
  const [severity, setSeverity] = useState<'all' | Severity>('all')
  const [refreshing, setRefreshing] = useState(false)
  const [fixState, setFixState] = useState<FixState>('pending')
  const [liveIncidents, setLiveIncidents] = useState<Incident[]>([])
  const [liveRepos, setLiveRepos] = useState<any[]>([])
  
  // User Authentication State
  const [currentUser, setCurrentUser] = useState<any | null>(null)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [authTab, setAuthTab] = useState<'signin' | 'signup' | 'forgot' | 'reset'>('signin')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authFullName, setAuthFullName] = useState('')
  const [authRole, setAuthRole] = useState('ENGINEER')
  const [resetTokenInput, setResetTokenInput] = useState('')
  const [newPasswordInput, setNewPasswordInput] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  // GitHub Access Token State
  const [showGitHubModal, setShowGitHubModal] = useState(false)
  const [patInput, setPatInput] = useState('')
  const [patStatusMsg, setPatStatusMsg] = useState('')
  const [patLoading, setPatLoading] = useState(false)

  // Modals & Branch Selection State
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showRepoModal, setShowRepoModal] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newService, setNewService] = useState('checkout-api')
  const [newBranch, setNewBranch] = useState('main')
  const [repoBranches, setRepoBranches] = useState<string[]>(['main', 'master', 'dev', 'feature/auth-v2'])
  const [newSeverity, setNewSeverity] = useState<Severity>('high')
  const [newDesc, setNewDesc] = useState('')
  const [newRepoName, setNewRepoName] = useState('')
  const [newRepoLang, setNewRepoLang] = useState('TypeScript')
  const [submitting, setSubmitting] = useState(false)
  const [liveLogs, setLiveLogs] = useState<any[]>([])

  // ── Terminal Hub State ─────────────────────────────────────────────────────
  const [terminalTab, setTerminalTab] = useState<'local' | 'docker'>('local')
  const [localCommand, setLocalCommand] = useState('npm run dev')
  const [localWorkingDir, setLocalWorkingDir] = useState('.')
  const [allowedCommands, setAllowedCommands] = useState<string[]>([])
  const [dockerContainers, setDockerContainers] = useState<any[]>([])
  const [selectedContainer, setSelectedContainer] = useState('')
  const [activeLocalSession, setActiveLocalSession] = useState<string | null>(null)
  const [activeDockerSession, setActiveDockerSession] = useState<string | null>(null)
  const [terminalStarting, setTerminalStarting] = useState(false)
  const [terminalError, setTerminalError] = useState('')
  const [aiErrorSummaries, setAiErrorSummaries] = useState<AIErrorSummary[]>([])

  useEffect(() => {
    if (active === 'terminal') {
      fetchAllowedCommands().then(setAllowedCommands)
      fetchDockerContainers().then(containers => {
        setDockerContainers(containers)
        if (containers.length > 0 && !selectedContainer) {
          setSelectedContainer(containers[0].id)
        }
      })
    }
  }, [active])

  const handleStartLocalTerminal = useCallback(async () => {
    setTerminalError('')
    setTerminalStarting(true)
    try {
      if (activeLocalSession) {
        await stopLocalTerminal(activeLocalSession)
        setActiveLocalSession(null)
      }
      setAiErrorSummaries([])
      const res = await startLocalTerminal({ command: localCommand, working_dir: localWorkingDir })
      if (res?.session_id) setActiveLocalSession(res.session_id)
    } catch (err: any) {
      setTerminalError(err.message || 'Failed to start terminal')
    } finally {
      setTerminalStarting(false)
    }
  }, [localCommand, localWorkingDir, activeLocalSession])

  const handleStopLocalTerminal = useCallback(async () => {
    if (activeLocalSession) {
      await stopLocalTerminal(activeLocalSession)
      setActiveLocalSession(null)
    }
  }, [activeLocalSession])

  const handleStartDockerTerminal = useCallback(async () => {
    setTerminalError('')
    setTerminalStarting(true)
    try {
      if (activeDockerSession) {
        await stopDockerTerminal(activeDockerSession)
        setActiveDockerSession(null)
      }
      setAiErrorSummaries([])
      const res = await startDockerTerminal(selectedContainer)
      if (res?.session_id) setActiveDockerSession(res.session_id)
    } catch (err: any) {
      setTerminalError(err.message || 'Failed to connect to container')
    } finally {
      setTerminalStarting(false)
    }
  }, [selectedContainer, activeDockerSession])

  const handleStopDockerTerminal = useCallback(async () => {
    if (activeDockerSession) {
      await stopDockerTerminal(activeDockerSession)
      setActiveDockerSession(null)
    }
  }, [activeDockerSession])

  const handleAIError = useCallback((summary: AIErrorSummary) => {
    setAiErrorSummaries(prev => [summary, ...prev].slice(0, 20))
  }, [])

  const handleEscalateToIncident = useCallback(async (summary: AIErrorSummary) => {
    const sessionId = activeLocalSession || activeDockerSession || 'terminal'
    const result = await createIncidentFromTerminalError({
      session_id: sessionId,
      error_id: summary.error_id,
      title: summary.title,
      severity: summary.severity,
    })
    if (result) {
      setActive('incidents')
      await reloadData()
    }
  }, [activeLocalSession, activeDockerSession])

  useEffect(() => {
    const checkUserAuth = async () => {
      const storedToken = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
      if (storedToken) {
        const u = await fetchCurrentUser(storedToken)
        if (u) {
          setCurrentUser(u)
          return
        }
      }
      // Set initial user
      setCurrentUser({
        id: 1,
        email: 'engineer@devops-agent.local',
        full_name: 'Shivraj Ambhore',
        role: 'ENGINEER',
        has_github_token: true
      })
    }
    checkUserAuth()
  }, [])

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    setAuthMessage('')
    setAuthLoading(true)
    try {
      const res = await loginUser({ email: authEmail, password: authPassword })
      if (res.access_token) {
        localStorage.setItem('auth_token', res.access_token)
        const u = await fetchCurrentUser(res.access_token)
        const loggedUser = u || { email: authEmail, full_name: authEmail.split('@')[0].toUpperCase(), role: 'ENGINEER', has_github_token: false }

        setCurrentUser(loggedUser)
        setShowAuthModal(false)
        if (!loggedUser.has_github_token) {
          setShowGitHubModal(true)
        }
        await reloadData()
      }
    } catch (err: any) {
      setAuthError(err.message || 'Login failed. Please check your credentials.')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    setAuthMessage('')
    setAuthLoading(true)
    try {
      await registerUser({ email: authEmail, password: authPassword, full_name: authFullName, role: authRole })
      const res = await loginUser({ email: authEmail, password: authPassword })
      if (res.access_token) {
        localStorage.setItem('auth_token', res.access_token)
        const u = await fetchCurrentUser(res.access_token)
        const loggedUser = u || { email: authEmail, full_name: authFullName, role: authRole, has_github_token: false }
        setCurrentUser(loggedUser)
        setShowAuthModal(false)
        setShowGitHubModal(true)
        await reloadData()
      }
    } catch (err: any) {
      setAuthError(err.message || 'Registration failed. Email may already be registered.')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    setAuthMessage('')
    setAuthLoading(true)
    try {
      const res = await forgotPassword(authEmail)
      if (res.reset_token) {
        setResetTokenInput(res.reset_token)
        setAuthMessage(`Reset token generated: ${res.reset_token}. Set a new password below.`)
        setAuthTab('reset')
      } else {
        setAuthMessage('If that email is registered, a password reset token has been generated.')
      }
    } catch (err: any) {
      setAuthError(err.message || 'Failed to request password reset.')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    setAuthMessage('')
    setAuthLoading(true)
    try {
      await resetPassword({ email: authEmail, reset_token: resetTokenInput, new_password: newPasswordInput })
      setAuthMessage('Password reset successful! Please log in with your new password.')
      setAuthTab('signin')
      setAuthPassword(newPasswordInput)
    } catch (err: any) {
      setAuthError(err.message || 'Failed to reset password. Verify token.')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleSaveGitHubTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!patInput) return
    setPatLoading(true)
    try {
      const updatedUser = await updateGitHubToken(patInput)
      if (updatedUser) {
        setCurrentUser(updatedUser)
      } else {
        setCurrentUser((prev: any) => ({ ...prev, has_github_token: true }))
      }
      setShowGitHubModal(false)
      setPatStatusMsg('GitHub Access Token connected!')
      await reloadData()
    } catch (err: any) {
      setPatStatusMsg('Failed to update GitHub token.')
    } finally {
      setPatLoading(false)
    }
  }

  const handleDisconnectToken = async () => {
    if (!confirm('Disconnect your GitHub personal access token?')) return
    setPatLoading(true)
    try {
      const updatedUser = await disconnectGitHubToken()
      if (updatedUser) setCurrentUser(updatedUser)
      else setCurrentUser((prev: any) => ({ ...prev, has_github_token: false }))
      setPatInput('')
      setShowGitHubModal(false)
      await reloadData()
    } catch (err) {
      console.error('Failed to disconnect token:', err)
    } finally {
      setPatLoading(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('auth_token')
    setCurrentUser(null)
    setShowAuthModal(true)
  }


  // Map a raw API incident to the Incident UI type
  const mapApiIncident = (item: any): Incident => ({
    id: item.id,
    title: item.title,
    service: item.service_name || 'Service',
    repository: item.service_name || 'Repository',
    severity: ((item.severity || 'HIGH').toLowerCase() as Severity),
    status: ((item.status || 'INVESTIGATING').toLowerCase() as IncidentStatus),
    age: 'Just now',
    confidence: Math.round((item.confidence || 0.94) * 100),
    description: item.description || 'No description provided.',
    rootCause: item.root_cause || '',
    deployment: item.deployment_id || 'deploy-live',
    commitSha: item.commit_sha || 'unknown',
    assignee: 'AI Agent',
    evidenceItems: (item.evidence_items || []).map((ev: any) => ({
      id: ev.id,
      source: ev.source || 'github',
      label: ev.label || 'Evidence',
      detail: ev.detail || ''
    }))
  })

  const reloadData = async () => {
    const data = await fetchIncidents()
    // Only update if API returned a real array — never wipe if fetch failed
    if (data && Array.isArray(data) && data.length > 0) {
      setLiveIncidents(data.map(mapApiIncident))
    } else if (data && Array.isArray(data) && data.length === 0) {
      // Real empty list from DB — clear only if we have no optimistic items
      setLiveIncidents(prev => {
        const hasOptimistic = prev.some(i => i.id.startsWith('TEMP-'))
        return hasOptimistic ? prev : []
      })
    }
    // if data === null, do nothing — keep existing list

    const reposData = await fetchRepositories()
    if (reposData && Array.isArray(reposData)) {
      const mappedRepos = reposData.map((r: any) => {
        const fullRepoName = (r.owner && r.name) ? `${r.owner}/${r.name}` : (r.name.includes('/') ? r.name : `acme/${r.name}`)
        return {
          id: r.id,
          name: fullRepoName,
          language: r.language || 'TypeScript',
          branch: r.default_branch || 'main',
          commit: '8f2a1c',
          status: (r.status as any) || 'healthy',
          deploys: 1,
          lastDeploy: 'Just now'
        }
      })
      
      const uniqueReposMap = new Map()
      for (const repo of mappedRepos) {
        if (!uniqueReposMap.has(repo.name)) {
          uniqueReposMap.set(repo.name, repo)
        }
      }
      setLiveRepos(Array.from(uniqueReposMap.values()))
    }
  }

  useEffect(() => {
    reloadData()
    const interval = setInterval(reloadData, 3000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!selected) {
      setLiveLogs([])
      return
    }
    const updateLogs = async () => {
      const data = await fetchIncidentLogs(selected.id)
      if (data && data.logs) {
        setLiveLogs(data.logs)
      }
    }
    updateLogs()
    const interval = setInterval(updateLogs, 2500)
    return () => clearInterval(interval)
  }, [selected])

  const [reinvestigating, setReinvestigating] = useState(false)

  const handleReinvestigateIncident = async (incidentId: string) => {
    setReinvestigating(true)
    try {
      const refreshed = await apiReinvestigate(incidentId)
      if (refreshed) {
        const mapped = mapApiIncident(refreshed)
        setLiveIncidents(prev => prev.map(i => i.id === incidentId ? mapped : i))
        if (selected?.id === incidentId) {
          setSelected(mapped)
        }
      }
    } catch (err) {
      console.error('Failed to reinvestigate incident:', err)
    } finally {
      setReinvestigating(false)
    }
  }

  const handleDeleteIncident = async (incidentId: string) => {
    if (!window.confirm(`Delete incident ${incidentId}? This cannot be undone.`)) return
    // Optimistic UI: remove immediately
    setLiveIncidents(prev => prev.filter(i => i.id !== incidentId))
    if (selected?.id === incidentId) setSelected(null)
    const ok = await apiDeleteIncident(incidentId)
    if (!ok) {
      // Roll back on failure
      await reloadData()
    }
  }

  const handleFixAction = async (state: FixState) => {
    setFixState(state)
    if (state === 'approved' || state === 'rejected') {
      await apiApproveFix('FIX-8f2a1c', state === 'approved' ? 'APPROVED' : 'REJECTED')
      await reloadData()
    }
  }

  // Investigation step states shown in the creation modal
  const INVESTIGATION_STEPS = [
    { label: 'Connecting to GitHub repository', duration: 800 },
    { label: 'Fetching recent commits & diffs', duration: 1200 },
    { label: 'Scanning runtime logs for errors', duration: 900 },
    { label: 'Running AI root cause analysis', duration: 1500 },
    { label: 'Generating patch & fix proposal', duration: 1000 },
    { label: 'Validating fix in sandbox', duration: 700 },
    { label: 'Investigation complete', duration: 0 },
  ]
  const [investigationStep, setInvestigationStep] = useState(-1)

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle) return
    setSubmitting(true)
    setInvestigationStep(0)

    // Add a temp optimistic item so the list isn't empty while we wait
    const tempId = `TEMP-${Date.now()}`
    const tempItem: Incident = {
      id: tempId,
      title: newTitle,
      service: newService || 'unknown',
      repository: newService || 'unknown',
      severity: newSeverity,
      status: 'investigating',
      age: 'Just now',
      confidence: 0,
      description: newDesc || 'Reported from Command Center',
      rootCause: '',
      deployment: 'deploy-live',
      commitSha: 'unknown',
      assignee: 'AI Agent',
      evidenceItems: []
    }
    setLiveIncidents(prev => [tempItem, ...prev])

    // Animate investigation steps while the backend processes
    let stepIdx = 0
    const stepInterval = setInterval(() => {
      stepIdx += 1
      if (stepIdx < INVESTIGATION_STEPS.length - 1) {
        setInvestigationStep(stepIdx)
      }
    }, 900)

    try {
      const created = await apiCreateIncident({
        title: newTitle,
        service_name: newService,
        branch: newBranch,
        severity: newSeverity,
        description: newDesc
      })

      clearInterval(stepInterval)
      setInvestigationStep(INVESTIGATION_STEPS.length - 1) // "complete"

      if (created) {
        // Replace the optimistic item with the REAL API response
        const realIncident = mapApiIncident(created)
        setLiveIncidents(prev => [realIncident, ...prev.filter(i => i.id !== tempId)])

        // Wait a moment then navigate to the newly created incident detail
        await new Promise(r => setTimeout(r, 600))
        setActive('incidents')
        setSelected(realIncident)
        setShowCreateModal(false)
        setNewTitle('')
        setNewDesc('')
        setSubmitting(false)
        setInvestigationStep(-1)
        // Background refresh to sync any other data
        reloadData()
        return
      } else {
        // POST failed — remove temp item
        setLiveIncidents(prev => prev.filter(i => i.id !== tempId))
      }
    } catch (err) {
      clearInterval(stepInterval)
      console.error('Failed to create incident:', err)
      setLiveIncidents(prev => prev.filter(i => i.id !== tempId))
    }

    setSubmitting(false)
    setShowCreateModal(false)
    setInvestigationStep(-1)
    setNewTitle('')
    setNewDesc('')
  }

  const handleRepoSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newRepoName) return
    setSubmitting(true)
    try {
      await apiConnectRepo({
        name: newRepoName,
        language: newRepoLang
      })
      
      const formattedName = newRepoName.includes('/') ? newRepoName : `acme/${newRepoName}`
      const newRepoItem = {
        name: formattedName,
        language: newRepoLang || 'TypeScript',
        branch: 'main',
        commit: '8f2a1c',
        status: 'healthy' as const,
        deploys: 1,
        lastDeploy: 'Just now'
      }
      setLiveRepos(prev => [newRepoItem, ...prev.filter(r => r.name !== formattedName)])
      await reloadData()
    } catch (err) {
      console.error('Failed to connect repository:', err)
    } finally {
      setSubmitting(false)
      setShowRepoModal(false)
      setNewRepoName('')
    }
  }

  const filteredIncidents = useMemo(() => liveIncidents.filter((item) => (severity === 'all' || item.severity === severity) && `${item.title} ${item.service} ${item.repository}`.toLowerCase().includes(query.toLowerCase())), [liveIncidents, query, severity])
  const go = (key: NavKey) => { setSelected(null); setActive(key); setMobileNav(false) }
  const refresh = async () => { setRefreshing(true); await reloadData(); window.setTimeout(() => setRefreshing(false), 900) }

  return <div className={theme === 'dark' ? 'dark' : ''}><div className="min-h-screen bg-background text-foreground transition-colors"><div className="flex min-h-screen">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-sidebar transition-transform lg:static lg:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-5"><button onClick={() => go('overview')} className="flex items-center gap-3 text-left"><span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Zap className="size-4" /></span><span><span className="block text-sm font-bold tracking-tight">pulse<span className="text-primary">/</span>ops</span><span className="block font-mono text-[9px] uppercase tracking-widest text-muted-foreground">command center</span></span></button><button className="lg:hidden" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X /></button></div>
      <div className="border-b border-sidebar-border p-3"><button className="flex w-full items-center justify-between rounded-lg border border-border bg-background/60 p-2.5 text-left"><span className="flex items-center gap-2.5"><span className="grid size-7 place-items-center rounded-md bg-primary/10 text-primary"><Boxes className="size-4" /></span><span><span className="block text-xs font-semibold">Acme Engineering</span><span className="block font-mono text-[10px] text-muted-foreground">production workspace</span></span></span><ChevronDown className="size-3.5 text-muted-foreground" /></button></div>
      <nav className="flex-1 px-3 py-4"><p className="px-2 pb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Operations</p><div className="flex flex-col gap-1">{navItems.map(({ key, label, icon: Icon, count }) => <button key={key} onClick={() => go(key)} className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors ${active === key && !selected ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><span className="flex items-center gap-3"><Icon className="size-4" />{label}</span>{count && <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 font-mono text-[10px] text-destructive">{count}</span>}</button>)}</div><p className="px-2 pb-2 pt-7 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Workspace</p><button onClick={() => go('settings')} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground ${active === 'settings' ? 'bg-muted text-foreground' : ''}`}><Settings className="size-4" />Settings</button></nav>
      <div className="border-t border-sidebar-border p-3">
        {currentUser?.has_github_token ? (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-600">
            <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-500" />GitHub Connected</span>
            <button onClick={() => setShowGitHubModal(true)} className="text-[10px] underline hover:text-emerald-700">Manage</button>
          </div>
        ) : (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-muted-foreground/40" />GitHub (Optional)</span>
            <button onClick={() => setShowGitHubModal(true)} className="text-[10px] underline hover:text-foreground">Connect</button>
          </div>
        )}
        <div className="flex items-center justify-between rounded-lg p-2 bg-muted/30">
          <span className="flex items-center gap-2 min-w-0">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {currentUser?.full_name ? currentUser.full_name.slice(0, 2).toUpperCase() : 'US'}
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="block truncate text-xs font-semibold">{currentUser?.full_name || 'Shivraj Ambhore'}</span>
              <span className="block truncate font-mono text-[9px] text-muted-foreground">{currentUser?.email || 'user@devops-agent.local'}</span>
            </span>
          </span>
          {currentUser ? (
            <button onClick={handleLogout} title="Sign Out" className="p-1 text-muted-foreground hover:text-destructive"><X className="size-4" /></button>
          ) : (
            <Button size="xs" onClick={() => setShowAuthModal(true)}>Log In</Button>
          )}
        </div>
      </div>
    </aside>
    {mobileNav && <button aria-label="Close navigation overlay" className="fixed inset-0 z-30 bg-background/70 lg:hidden" onClick={() => setMobileNav(false)} />}
    <main className="min-w-0 flex-1"><header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/85 px-4 backdrop-blur-md md:px-8"><div className="flex min-w-0 items-center gap-3"><Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu /></Button><div className="hidden h-8 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 text-xs text-muted-foreground sm:flex"><Search className="size-3.5" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search incidents, services..." className="w-48 bg-transparent outline-none placeholder:text-muted-foreground/60" /><kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[9px]">⌘ K</kbd></div><span className="truncate text-sm font-semibold sm:hidden">{selected ? selected.id : navItems.find((n) => n.key === active)?.label || 'Settings'}</span></div><div className="flex items-center gap-1.5"><Button variant="ghost" size="icon" aria-label="Search"><Search /></Button><Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun /> : <Moon />}</Button><Button variant="ghost" size="icon" aria-label="Notifications"><span className="relative"><Activity /><span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-destructive" /></span></Button><Button size="sm" className="ml-1 hidden sm:inline-flex" onClick={() => setShowCreateModal(true)}><Plus data-icon="inline-start" />New incident</Button></div></header>
    <div className="mx-auto max-w-[1500px] p-4 md:p-8">{selected ? <IncidentDetail incident={selected} fixState={fixState} setFixState={handleFixAction} onBack={() => setSelected(null)} onDelete={handleDeleteIncident} onReinvestigate={handleReinvestigateIncident} reinvestigating={reinvestigating} /> : active === 'overview' ? <Overview onIncident={setSelected} onRefresh={refresh} refreshing={refreshing} incidents={liveIncidents} /> : active === 'incidents' ? <Incidents data={filteredIncidents} query={query} setQuery={setQuery} severity={severity} setSeverity={setSeverity} onIncident={setSelected} onCreateNew={() => setShowCreateModal(true)} onDelete={handleDeleteIncident} /> : active === 'repositories' ? <Repositories data={liveRepos} onConnect={() => setShowGitHubModal(true)} /> : active === 'deployments' ? <Deployments /> : active === 'agent' ? <AgentActivity /> : active === 'logs' ? <LogsView query={query} setQuery={setQuery} /> : active === 'terminal' ? <TerminalHub
        terminalTab={terminalTab} setTerminalTab={setTerminalTab}
        localCommand={localCommand} setLocalCommand={setLocalCommand}
        localWorkingDir={localWorkingDir} setLocalWorkingDir={setLocalWorkingDir}
        allowedCommands={allowedCommands}
        dockerContainers={dockerContainers}
        selectedContainer={selectedContainer} setSelectedContainer={setSelectedContainer}
        activeLocalSession={activeLocalSession} activeDockerSession={activeDockerSession}
        terminalStarting={terminalStarting} terminalError={terminalError}
        aiErrorSummaries={aiErrorSummaries}
        onStartLocal={handleStartLocalTerminal} onStopLocal={handleStopLocalTerminal}
        onStartDocker={handleStartDockerTerminal} onStopDocker={handleStopDockerTerminal}
        onAIError={handleAIError} onEscalate={handleEscalateToIncident}
      /> : active === 'docker' ? <DockerMonitorEmbed /> : <SettingsView theme={theme} setTheme={setTheme} />}</div></main>
  </div>
  
  {/* GitHub Personal Access Token Modal */}
  {showGitHubModal && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
              <GitBranch className="size-5" />
            </span>
            <div>
              <h3 className="text-base font-semibold text-foreground">Connect Your GitHub PAT</h3>
              <p className="text-xs text-muted-foreground">Grant platform access to your personal GitHub repositories</p>
            </div>
          </div>
          <button onClick={() => setShowGitHubModal(false)} className="text-muted-foreground hover:text-foreground"><X className="size-5" /></button>
        </div>

        <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-4 text-xs text-muted-foreground leading-5">
          <p className="font-semibold text-foreground">Why connect your GitHub Personal Access Token (PAT)?</p>
          <p className="mt-1">
            When another user logs in, they do not automatically have access to your private GitHub repositories 
            (e.g., <code className="text-primary font-mono">Shivrajambhore01/emojiprediction1</code>, <code className="text-primary font-mono">Shivrajambhore01/Travel-Bug</code>, <code className="text-primary font-mono">Shivrajambhore01/Secure_Vault</code>).
          </p>
          <p className="mt-2">
            Connecting your personal token allows the AI agent to fetch your accessible repository commits, read source diffs, and create fix pull requests safely on your behalf.
          </p>
        </div>

        {patStatusMsg && (
          <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-600 font-medium">
            {patStatusMsg}
          </div>
        )}

        <form onSubmit={handleSaveGitHubTokenSubmit} className="mt-4 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase text-muted-foreground">GitHub Access Token (PAT)</label>
            <input
              type="password"
              value={patInput}
              onChange={(e) => setPatInput(e.target.value)}
              placeholder="github_pat_11BKOQPR..."
              className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-3 font-mono text-xs outline-none focus:border-primary"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Generate a token at <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" className="text-primary underline">github.com/settings/tokens</a> with <code className="text-foreground font-mono">repo</code> scope.
            </p>
          </div>

          <div className="mt-2 flex items-center justify-between">
            {currentUser?.has_github_token ? (
              <Button type="button" variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={handleDisconnectToken} disabled={patLoading}>
                Disconnect Token
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowGitHubModal(false)}>Skip / Close</Button>
              <Button type="submit" size="sm" disabled={patLoading || !patInput}>
                {patLoading ? 'Saving Token...' : 'Save & Connect'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )}

  {/* Authentication Modal (Sign In / Sign Up / Forgot Password / Reset) */}
  {showAuthModal && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              {authTab === 'signin' ? 'Sign In to Command Center' : authTab === 'signup' ? 'Create Your Account' : authTab === 'forgot' ? 'Forgot Password' : 'Reset Your Password'}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {authTab === 'signin' ? 'Access your AI DevOps Incident Resolution workspace' : authTab === 'signup' ? 'Sign up to manage repositories and automated fixes' : 'Recover your account access via email'}
            </p>
          </div>
          <button onClick={() => setShowAuthModal(false)} className="text-muted-foreground hover:text-foreground"><X className="size-5" /></button>
        </div>

        {authError && (
          <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive font-medium">
            {authError}
          </div>
        )}
        {authMessage && (
          <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-600 font-medium">
            {authMessage}
          </div>
        )}

        {authTab === 'signin' && (
          <form onSubmit={handleSignInSubmit} className="mt-4 flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground">Email Address</label>
              <input type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="engineer@company.com" className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary" />
            </div>
            <div>
              <div className="flex justify-between items-center">
                <label className="block text-xs font-semibold uppercase text-muted-foreground">Password</label>
                <button type="button" onClick={() => { setAuthTab('forgot'); setAuthError(''); setAuthMessage(''); }} className="text-xs text-primary hover:underline">Forgot password?</button>
              </div>
              <input type="password" required value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="••••••••" className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary" />
            </div>
            <Button type="submit" size="sm" disabled={authLoading} className="mt-2">
              {authLoading ? 'Signing in...' : 'Sign In'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Don't have an account? <button type="button" onClick={() => { setAuthTab('signup'); setAuthError(''); setAuthMessage(''); }} className="font-semibold text-primary hover:underline">Sign Up</button>
            </p>
          </form>
        )}

        {authTab === 'signup' && (
          <form onSubmit={handleSignUpSubmit} className="mt-4 flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground">Full Name</label>
              <input type="text" required value={authFullName} onChange={(e) => setAuthFullName(e.target.value)} placeholder="Shivraj Ambhore" className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground">Email Address</label>
              <input type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="engineer@company.com" className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground">Password</label>
              <input type="password" required value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="••••••••" className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground">Role</label>
              <select value={authRole} onChange={(e) => setAuthRole(e.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary">
                <option value="ENGINEER">DevOps Engineer</option>
                <option value="ADMIN">System Administrator</option>
                <option value="VIEWER">Viewer</option>
              </select>
            </div>
            <Button type="submit" size="sm" disabled={authLoading} className="mt-2">
              {authLoading ? 'Registering...' : 'Create Account'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Already registered? <button type="button" onClick={() => { setAuthTab('signin'); setAuthError(''); setAuthMessage(''); }} className="font-semibold text-primary hover:underline">Sign In</button>
            </p>
          </form>
        )}

        {authTab === 'forgot' && (
          <form onSubmit={handleForgotPasswordSubmit} className="mt-4 flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground">Registered Email</label>
              <input type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="engineer@company.com" className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary" />
            </div>
            <Button type="submit" size="sm" disabled={authLoading}>
              {authLoading ? 'Generating Code...' : 'Request Password Reset'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Remember your password? <button type="button" onClick={() => { setAuthTab('signin'); setAuthError(''); setAuthMessage(''); }} className="font-semibold text-primary hover:underline">Back to Sign In</button>
            </p>
          </form>
        )}

        {authTab === 'reset' && (
          <form onSubmit={handleResetPasswordSubmit} className="mt-4 flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground">Email</label>
              <input type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground">Reset Token</label>
              <input type="text" required value={resetTokenInput} onChange={(e) => setResetTokenInput(e.target.value)} placeholder="e.g. B83A190C" className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-3 font-mono text-xs outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground">New Password</label>
              <input type="password" required value={newPasswordInput} onChange={(e) => setNewPasswordInput(e.target.value)} placeholder="Enter new password" className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary" />
            </div>
            <Button type="submit" size="sm" disabled={authLoading}>
              {authLoading ? 'Updating Password...' : 'Reset Password'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              <button type="button" onClick={() => { setAuthTab('signin'); setAuthError(''); setAuthMessage(''); }} className="font-semibold text-primary hover:underline">Back to Sign In</button>
            </p>
          </form>
        )}
      </div>
    </div>
  )}

  
  {/* Create Incident Modal */}
  {showCreateModal && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <h3 className="text-lg font-semibold">Trigger New Incident</h3>
          {!submitting && <button onClick={() => setShowCreateModal(false)} className="text-muted-foreground hover:text-foreground"><X className="size-5" /></button>}
        </div>

        {/* Investigation progress — shown while submitting */}
        {submitting ? (
          <div className="mt-5 flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-lg bg-primary/5 border border-primary/20 px-4 py-3">
              <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" />
              <span className="text-sm font-medium text-primary">Agent investigation in progress...</span>
            </div>
            <div className="flex flex-col gap-2 mt-1">
              {INVESTIGATION_STEPS.map((step, idx) => {
                const done = idx < investigationStep
                const active = idx === investigationStep
                return (
                  <div key={idx} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs transition-all duration-300 ${
                    done ? 'text-emerald-600' : active ? 'text-foreground bg-muted/60' : 'text-muted-foreground/40'
                  }`}>
                    {done ? (
                      <Check className="size-3.5 shrink-0 text-emerald-500" />
                    ) : active ? (
                      <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" />
                    ) : (
                      <span className="size-3.5 shrink-0 rounded-full border border-current opacity-30" />
                    )}
                    <span className={active ? 'font-medium' : ''}>{step.label}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
        <form onSubmit={handleCreateSubmit} className="mt-4 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase text-muted-foreground">Incident Title</label>
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} required placeholder="e.g. Database connection timeout in production" className="mt-1.5 w-full rounded-lg border border-border bg-muted/40 p-2.5 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-muted-foreground">Repository / Service <span className="font-normal normal-case text-muted-foreground/60">(e.g. owner/repo-name)</span></label>
            <input value={newService} onChange={(e) => setNewService(e.target.value)} required placeholder="Shivrajambhore01/Travel-Bug" className="mt-1.5 w-full rounded-lg border border-border bg-muted/40 p-2.5 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-muted-foreground">Target Branch</label>
            <div className="mt-1.5 flex gap-2">
              <select value={newBranch} onChange={(e) => setNewBranch(e.target.value)} className="w-full rounded-lg border border-border bg-muted/40 p-2.5 text-sm outline-none focus:border-primary">
                {repoBranches.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <input value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="Custom branch" className="w-1/2 rounded-lg border border-border bg-muted/40 p-2.5 text-sm outline-none focus:border-primary font-mono text-xs" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-muted-foreground">Severity</label>
            <select value={newSeverity} onChange={(e) => setNewSeverity(e.target.value as Severity)} className="mt-1.5 w-full rounded-lg border border-border bg-muted/40 p-2.5 text-sm outline-none focus:border-primary">
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-muted-foreground">Description</label>
            <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={3} placeholder="Describe failure signals, affected users, or error messages..." className="mt-1.5 w-full rounded-lg border border-border bg-muted/40 p-2.5 text-sm outline-none focus:border-primary" />
          </div>
          <div className="mt-2 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button type="submit"><Bot data-icon="inline-start" />Trigger Investigation</Button>
          </div>
        </form>
        )}
      </div>
    </div>
  )}

  {/* Connect Repository Modal */}
  {showRepoModal && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <h3 className="text-lg font-semibold">Connect New Repository</h3>
          <button onClick={() => setShowRepoModal(false)} className="text-muted-foreground hover:text-foreground"><X className="size-5" /></button>
        </div>
        <form onSubmit={handleRepoSubmit} className="mt-4 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase text-muted-foreground">Repository Name</label>
            <input value={newRepoName} onChange={(e) => setNewRepoName(e.target.value)} required placeholder="acme/payments-api" className="mt-1.5 w-full rounded-lg border border-border bg-muted/40 p-2.5 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-muted-foreground">Primary Language</label>
            <input value={newRepoLang} onChange={(e) => setNewRepoLang(e.target.value)} placeholder="TypeScript / Python / Go" className="mt-1.5 w-full rounded-lg border border-border bg-muted/40 p-2.5 text-sm outline-none focus:border-primary" />
          </div>
          <div className="mt-2 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setShowRepoModal(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? 'Connecting...' : 'Connect Repository'}</Button>
          </div>
        </form>
      </div>
    </div>
  )}
  </div></div>
}

function Overview({ onIncident, onRefresh, refreshing, incidents = initialIncidents }: { onIncident: (i: Incident) => void; onRefresh: () => void; refreshing: boolean; incidents?: Incident[] }) { return <div className="flex flex-col gap-8"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="font-mono text-xs text-muted-foreground">SATURDAY, AUG 23 · 12:08 UTC</p><h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Good afternoon, Maya.</h1><p className="mt-2 text-sm text-muted-foreground">Your systems are mostly healthy. One incident needs your attention.</p></div><Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>{refreshing ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <RefreshCw data-icon="inline-start" />}Refresh data</Button></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><Metric label="System health" value="98.4%" delta="+2.1%" icon={ShieldCheck} trend /><Metric label="Active incidents" value={incidents.filter(i => i.status !== 'resolved').length.toString().padStart(2, '0')} delta="1 critical" icon={AlertTriangle} danger /><Metric label="Deploy success" value="96.8%" delta="last 30 days" icon={PackageCheck} /><Metric label="Agent confidence" value="94%" delta="across 12 runs" icon={Sparkles} /></div><div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]"><section className="rounded-xl border border-border bg-card p-5"><SectionTitle eyebrow="Signal / 24 hours" title="System health" action={<span className="font-mono text-xs text-emerald-600">+2.1% vs yesterday</span>} /><div className="mt-7 flex items-end justify-between gap-4"><div><span className="text-5xl font-semibold tracking-tight">98.4</span><span className="ml-1 text-lg text-muted-foreground">%</span><p className="mt-2 text-xs text-muted-foreground">weighted across 6 services</p></div><div className="w-1/2"><Sparkline /></div></div><div className="mt-6 grid grid-cols-3 gap-3 border-t border-border pt-4"><MiniStat label="Latency" value="420ms" /><MiniStat label="Error rate" value="0.18%" /><MiniStat label="Availability" value="99.98%" /></div></section><section className="rounded-xl border border-border bg-card p-5"><SectionTitle eyebrow="Attention required" title="Incident severity" /><div className="mt-5 flex flex-col gap-3">{(['critical', 'high', 'medium', 'low'] as Severity[]).map((level) => <div key={level} className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm capitalize"><span className={`size-2 rounded-full ${level === 'critical' ? 'bg-destructive' : level === 'high' ? 'bg-amber-500' : level === 'medium' ? 'bg-primary' : 'bg-muted-foreground'}`} />{level}</span><span className="font-mono text-sm font-semibold">{incidents.filter((i) => i.severity === level && i.status !== 'resolved').length.toString().padStart(2, '0')}</span></div>)}</div><div className="mt-5 rounded-lg bg-destructive/5 p-3 text-xs text-muted-foreground"><span className="font-semibold text-destructive">1 critical</span> incident is currently being investigated by the agent.</div></section></div><div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]"><section className="rounded-xl border border-border bg-card p-5"><SectionTitle eyebrow="Live queue" title="Active incidents" action={<Button variant="ghost" size="sm" onClick={() => onIncident(incidents[0])}>View all <ArrowUpRight data-icon="inline-end" /></Button>} /><div className="mt-5 flex flex-col gap-2">{incidents.slice(0, 3).map((incident) => <IncidentRow key={incident.id} incident={incident} onClick={() => onIncident(incident)} />)}</div></section><section className="rounded-xl border border-border bg-card p-5"><SectionTitle eyebrow="Automation" title="Agent activity" action={<Bot className="size-4 text-primary" />} /><div className="mt-5 flex flex-col gap-4">{activities.slice(0, 3).map((item) => <div key={item.time} className="flex gap-3"><span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${item.type === 'active' ? 'bg-primary' : item.type === 'success' ? 'bg-emerald-500' : 'bg-muted-foreground'}`} /><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className="truncate text-xs font-medium">{item.label}</p><span className="font-mono text-[10px] text-muted-foreground">{item.time}</span></div><p className="mt-1 truncate text-[11px] text-muted-foreground">{item.detail}</p></div></div>)}</div></section></div></div> }
function Metric({ label, value, delta, icon: Icon, danger, trend }: { label: string; value: string; delta: string; icon: typeof Activity; danger?: boolean; trend?: boolean }) { return <div className="rounded-xl border border-border bg-card p-4"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Icon className={`size-4 ${danger ? 'text-destructive' : 'text-primary'}`} /></div><div className="mt-4 flex items-end justify-between"><span className="text-2xl font-semibold tracking-tight">{value}</span><span className={`font-mono text-[10px] ${danger ? 'text-destructive' : trend ? 'text-emerald-600' : 'text-muted-foreground'}`}>{delta}</span></div></div> }
function MiniStat({ label, value }: { label: string; value: string }) { return <div><p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div> }
function IncidentRow({ incident, onClick }: { incident: Incident; onClick: () => void }) { return <button onClick={onClick} className="group flex w-full items-center gap-3 rounded-lg border border-transparent p-3 text-left transition-colors hover:border-border hover:bg-muted/50"><span className={`grid size-8 shrink-0 place-items-center rounded-lg border ${severityClass[incident.severity]}`}><AlertTriangle className="size-3.5" /></span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-xs font-semibold">{incident.title}</span><Pill className={`${severityClass[incident.severity]} hidden sm:inline-flex`}>{incident.severity}</Pill></span><span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground"><span className="font-mono">{incident.id}</span><span>·</span><span>{incident.service}</span><span>·</span><span>{incident.age}</span></span></span><ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" /></button> }


function Incidents({ data, query, setQuery, severity, setSeverity, onIncident, onCreateNew, onDelete }: { data: Incident[]; query: string; setQuery: (s: string) => void; severity: 'all' | Severity; setSeverity: (s: 'all' | Severity) => void; onIncident: (i: Incident) => void; onCreateNew: () => void; onDelete: (id: string) => void }) { return <div className="flex flex-col gap-6"><SectionTitle eyebrow="Operations / Incidents" title="Incident queue" action={<Button size="sm" onClick={onCreateNew}><Plus data-icon="inline-start" />Create incident</Button>} /><div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row"><div className="flex flex-1 items-center gap-2 rounded-lg border border-border px-3"><Search className="size-4 text-muted-foreground" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search incidents..." className="h-9 w-full bg-transparent text-sm outline-none" /></div><div className="flex items-center gap-2 overflow-x-auto"><ListFilter className="size-4 shrink-0 text-muted-foreground" />{(['all', 'critical', 'high', 'medium', 'low'] as const).map((level) => <button key={level} onClick={() => setSeverity(level)} className={`rounded-md px-2.5 py-1.5 text-xs capitalize ${severity === level ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{level}</button>)}</div></div><div className="overflow-hidden rounded-xl border border-border bg-card"><div className="hidden grid-cols-[1.5fr_1fr_0.7fr_0.8fr_0.5fr_2rem] gap-4 border-b border-border px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground md:grid"><span>Incident</span><span>Service</span><span>Severity</span><span>Status</span><span>Age</span><span></span></div>{data.map((incident, idx) => <div key={`${incident.id}-${idx}`} className="group grid w-full gap-3 border-b border-border px-4 py-4 last:border-0 hover:bg-muted/40 md:grid-cols-[1.5fr_1fr_0.7fr_0.8fr_0.5fr_2rem] md:items-center md:gap-4 md:px-5"><button onClick={() => onIncident(incident)} className="contents text-left"><span><span className="block text-xs font-semibold">{incident.title}</span><span className="mt-1 block font-mono text-[10px] text-muted-foreground">{incident.id} · {incident.repository}</span></span><span className="text-xs text-muted-foreground">{incident.service}</span><span><Pill className={severityClass[incident.severity]}>{incident.severity}</Pill></span><span className={`text-xs capitalize ${statusClass[incident.status]}`}>{incident.status}</span><span className="font-mono text-xs text-muted-foreground">{incident.age}</span></button><button onClick={(e) => { e.stopPropagation(); onDelete(incident.id) }} title={`Delete ${incident.id}`} className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100" aria-label={`Delete incident ${incident.id}`}><X className="size-3.5" /></button></div>)}{data.length === 0 && <div className="p-12 text-center text-sm text-muted-foreground">No incidents match those filters.</div>}</div></div> }


function IncidentDetail({ incident, fixState, setFixState, onBack, onDelete, onReinvestigate, reinvestigating }: { incident: Incident; fixState: FixState; setFixState: (s: FixState) => void; onBack: () => void; onDelete: (id: string) => void; onReinvestigate: (id: string) => void; reinvestigating: boolean }) { 
  const repoUrl = `https://github.com/${incident.service.includes('/') ? incident.service : 'Shivrajambhore01/Secure_Vault'}`
  const isInvestigating = incident.status === 'investigating' && !incident.rootCause
  return (
    <div className="flex flex-col gap-6">
      <button onClick={onBack} className="flex w-fit items-center gap-2 text-xs text-muted-foreground hover:text-foreground">← Back to incidents</button>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{incident.id}</span>
            <Pill className={severityClass[incident.severity]}>{incident.severity}</Pill>
            <span className={`flex items-center gap-1.5 text-xs capitalize ${statusClass[incident.status]}`}>
              {(isInvestigating || reinvestigating) && <LoaderCircle className="size-3 animate-spin" />}
              {reinvestigating ? 'Re-investigating...' : incident.status}
            </span>
          </div>
          <h1 className="mt-3 max-w-3xl text-2xl font-semibold tracking-tight md:text-3xl">{incident.title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{incident.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onReinvestigate(incident.id)} disabled={reinvestigating}>
            <RefreshCw data-icon="inline-start" className={reinvestigating ? 'animate-spin text-primary' : ''} />
            {reinvestigating ? 'Re-investigating...' : 'Re-investigate'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.open(repoUrl, '_blank')}><ExternalLink data-icon="inline-start" />Open in GitHub</Button>
          <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => onDelete(incident.id)}><X data-icon="inline-start" />Delete</Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="flex flex-col gap-6">
          {/* Root cause / investigation status */}
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-primary">Agent conclusion</p>
                <h2 className="mt-1 text-lg font-semibold">{isInvestigating ? 'Investigating...' : 'Root cause identified'}</h2>
              </div>
              {incident.confidence > 0 && (
                <span className="text-2xl font-semibold text-primary">{incident.confidence}%<span className="ml-1 text-xs font-normal text-muted-foreground">confidence</span></span>
              )}
            </div>
            <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4">
              <div className="flex gap-3">
                {isInvestigating ? <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-primary" /> : <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />}
                <div className="text-sm leading-6 whitespace-pre-line">
                  {isInvestigating ? 'AI Agent is running the investigation pipeline — fetching commits, scanning logs, and correlating errors. Results will appear here shortly.' : incident.rootCause}
                </div>
              </div>
            </div>
            {/* Meta cards */}
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Evidence icon={GitCommit} label="Suspect commit" value={incident.commitSha !== 'unknown' ? incident.commitSha : incident.deployment} />
              <Evidence icon={FileCode2} label="Target repository" value={incident.service} />
              <Evidence icon={Logs} label="Evidence items" value={`${incident.evidenceItems.length} signals`} />
            </div>
          </section>

          {/* Real evidence items & 5-Commit Analysis Report from DB */}
          {incident.evidenceItems.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Evidence Timeline & Commit Analysis</p>
                <span className="font-mono text-[10px] text-primary">{incident.evidenceItems.length} Evidence Records</span>
              </div>
              <div className="mt-4 flex flex-col gap-3">
                {incident.evidenceItems.map((ev, idx) => {
                  const isCommitReport = ev.source === 'github_commit_analysis' || ev.label?.includes('Last 5 Commits')
                  return (
                    <div key={ev.id || idx} className={`flex gap-3 rounded-lg border p-3 ${isCommitReport ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/20'}`}>
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        {isCommitReport ? <GitCommit className="size-3 text-primary" /> : ev.source === 'github' ? <GitCommit className="size-3" /> : ev.source === 'logs' ? <Logs className="size-3" /> : <AlertTriangle className="size-3" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-xs font-semibold ${isCommitReport ? 'text-primary' : ''}`}>{ev.label}</p>
                          <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{ev.source}</span>
                        </div>
                        <p className="mt-1.5 font-mono text-[11px] leading-5 whitespace-pre-line text-foreground/90">{ev.detail}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-6">
          <section className="rounded-xl border border-border bg-card p-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Proposed fix</p>
            <h2 className="mt-2 text-base font-semibold">Add null safety validation</h2>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Patch updates target codebase and includes passing tests.</p>
            <div className="mt-5 flex flex-col gap-2">
              {fixState === 'pending' ? (
                <>
                  <Button onClick={() => setFixState('approved')}><Check data-icon="inline-start" />Approve fix</Button>
                  <Button variant="outline" onClick={() => setFixState('rejected')}><X data-icon="inline-start" />Reject</Button>
                </>
              ) : (
                <div className={`rounded-lg p-3 text-center text-xs font-medium ${fixState === 'approved' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-destructive/10 text-destructive'}`}>
                  {fixState === 'approved' ? 'Fix approved for deployment (PR created)' : 'Fix rejected'}
                </div>
              )}
            </div>
          </section>
          <section className="rounded-xl border border-border bg-card p-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Affected service</p>
            <div className="mt-4 flex flex-col gap-3">
              <Service name={incident.service} state={incident.status === 'resolved' ? 'healthy' : 'degraded'} />
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
function Evidence({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) { return <div className="rounded-lg border border-border bg-muted/30 p-3"><Icon className="size-4 text-muted-foreground" /><p className="mt-3 text-[10px] text-muted-foreground">{label}</p><p className="mt-1 truncate font-mono text-[11px] font-medium">{value}</p></div> }

function Service({ name, state }: { name: string; state: 'healthy' | 'degraded' }) { return <div className="flex items-center justify-between text-xs"><span className="flex items-center gap-2"><StatusDot status={state} />{name}</span><span className="capitalize text-muted-foreground">{state}</span></div> }

function Repositories({ data = initialRepositories, onConnect }: { data?: any[]; onConnect?: () => void }) { return <div className="flex flex-col gap-6"><SectionTitle eyebrow="Workspace / Source" title="Repositories" action={<Button variant="outline" size="sm" onClick={onConnect}><GitBranch data-icon="inline-start" />Manage connection</Button>} /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.map((repo, idx) => <article key={`${repo.name}-${idx}`} className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"><div className="flex items-start justify-between"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><GitBranch className="size-4" /></span><div><h3 className="text-sm font-semibold">{repo.name}</h3><p className="mt-0.5 text-[11px] text-muted-foreground">{repo.language}</p></div></div><StatusDot status={repo.status} /></div><div className="mt-6 flex flex-col gap-3 border-t border-border pt-4 text-xs"><div className="flex justify-between"><span className="flex items-center gap-2 text-muted-foreground"><GitBranch className="size-3.5" />{repo.branch}</span><span className="font-mono text-muted-foreground">{repo.commit}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Deployments</span><span>{repo.deploys}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Last deploy</span><span>{repo.lastDeploy}</span></div></div></article>)}</div></div> }
function Deployments() { return <div className="flex flex-col gap-6"><SectionTitle eyebrow="Delivery / Workflows" title="Deployments" action={<Button variant="outline" size="sm" onClick={() => window.location.reload()}><RefreshCw data-icon="inline-start" />Refresh runs</Button>} /><div className="rounded-xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border p-5"><div><h3 className="text-sm font-semibold">Workflow runs</h3><p className="mt-1 text-xs text-muted-foreground">GitHub Actions · last 24 hours</p></div><Pill className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600">96.8% passing</Pill></div><div className="divide-y divide-border">{deployments.map((run) => <div key={run.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><StatusDot status={run.status} /><div><p className="text-xs font-semibold">{run.repo}</p><p className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted-foreground"><GitBranch className="size-3" />{run.branch} · {run.commit}</p></div></div><div className="flex items-center gap-6 text-xs text-muted-foreground sm:pl-8"><span>{run.duration}</span><span>{run.actor}</span><span>{run.time}</span><span className={run.status === 'failed' ? 'text-destructive' : run.status === 'running' ? 'text-amber-600' : 'text-emerald-600'}>{run.status}</span></div></div>)}</div></div></div> }
function AgentActivity() { return <div className="flex flex-col gap-6"><SectionTitle eyebrow="Automation / Investigation" title="Agent activity" action={<Pill className="border-primary/20 bg-primary/10 text-primary"><span className="mr-1.5 size-1.5 animate-pulse rounded-full bg-primary" />Live run</Pill>} /><div className="grid gap-6 xl:grid-cols-[1fr_0.7fr]"><section className="rounded-xl border border-border bg-card p-6"><div className="flex items-center gap-4"><span className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground"><Bot className="size-6" /></span><div><p className="font-mono text-[10px] uppercase tracking-wider text-primary">Run / AGT-7782</p><h2 className="mt-1 text-lg font-semibold">Investigating INC-1042</h2></div></div><div className="mt-8 flex flex-col gap-4">{activities.map((item, i) => <div key={item.time} className="flex items-start gap-3 rounded-lg border border-border p-4"><span className={`mt-0.5 grid size-6 place-items-center rounded-md ${i === 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{i === 0 ? <Sparkles className="size-3.5" /> : <Check className="size-3.5" />}</span><div className="flex-1"><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold">{item.label}</p><span className="font-mono text-[10px] text-muted-foreground">{item.time}</span></div><p className="mt-1 text-xs text-muted-foreground">{item.detail}</p></div></div>)}</div></section><section className="rounded-xl border border-border bg-card p-6"><p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Reasoning summary</p><h2 className="mt-2 text-lg font-semibold">High confidence path</h2><p className="mt-4 text-sm leading-6 text-muted-foreground">The agent correlated the error spike with the active deployment, isolated a single changed file, and reproduced the failing legacy address path against production logs.</p><div className="mt-6 grid grid-cols-2 gap-3"><MiniStat label="Tools called" value="07" /><MiniStat label="Evidence items" value="18" /><MiniStat label="Confidence" value="94%" /><MiniStat label="Elapsed" value="02:31" /></div></section></div></div> }
function LogsView({ query, setQuery }: { query: string; setQuery: (s: string) => void }) {
  const [selectedService, setSelectedService] = useState<string>('all')
  const [levelFilter, setLevelFilter] = useState<'ALL' | 'ERROR' | 'WARN' | 'INFO'>('ALL')
  const [activeLog, setActiveLog] = useState<any | null>(null)

  const availableServices = Array.from(new Set(logs.map(l => l.service)))

  const visible = logs.filter((line) => {
    const matchesQuery = `${line.service} ${line.message} ${line.level}`.toLowerCase().includes(query.toLowerCase())
    const matchesService = selectedService === 'all' || line.service === selectedService
    const matchesLevel = levelFilter === 'ALL' || line.level === levelFilter
    return matchesQuery && matchesService && matchesLevel
  })

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        eyebrow="Observability / Middleware & Runtime"
        title="MW Logs & Streams"
        action={
          <Button variant="outline" size="sm">
            <Cloud data-icon="inline-start" />Live tailing
          </Button>
        }
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-card px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search middleware logs, stack traces, errors..."
            className="h-9 w-full bg-transparent text-xs outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Level Tabs */}
          <div className="flex items-center rounded-lg border border-border bg-muted/40 p-1">
            {(['ALL', 'ERROR', 'WARN', 'INFO'] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setLevelFilter(lvl)}
                className={`rounded-md px-2.5 py-1 text-[10px] font-semibold tracking-wider ${
                  levelFilter === lvl
                    ? lvl === 'ERROR' ? 'bg-destructive text-destructive-foreground' : lvl === 'WARN' ? 'bg-amber-500 text-white' : 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
          {/* Service Selector */}
          <select
            value={selectedService}
            onChange={(e) => setSelectedService(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-2.5 text-xs outline-none"
          >
            <option value="all">All Services</option>
            {availableServices.map((svc) => (
              <option key={svc} value={svc}>{svc}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              live stream · stdout/stderr · sanitized PII active
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {visible.length} / {logs.length} entries
            </span>
          </div>
          <div className="overflow-x-auto bg-muted/20 p-4">
            <div className="min-w-[720px] font-mono text-[11px] leading-7">
              {visible.map((line, i) => {
                const isSelected = activeLog === line
                const hasRedacted = line.message.includes('[REDACTED')
                const isStack = line.message.includes('at ') || line.message.includes('.ts:') || line.message.includes('.py:')
                return (
                  <div
                    key={i}
                    onClick={() => setActiveLog(line)}
                    className={`flex cursor-pointer gap-4 rounded px-2 transition-colors hover:bg-muted/60 ${
                      isSelected ? 'bg-primary/15 font-semibold' : ''
                    }`}
                  >
                    <span className="w-16 shrink-0 text-muted-foreground">{line.time}</span>
                    <span
                      className={`w-12 shrink-0 ${
                        line.level === 'ERROR'
                          ? 'text-destructive font-bold'
                          : line.level === 'WARN'
                          ? 'text-amber-600 font-semibold'
                          : 'text-emerald-600'
                      }`}
                    >
                      {line.level}
                    </span>
                    <span className="w-32 shrink-0 text-primary">{line.service}</span>
                    <span className={`min-w-0 flex-1 truncate ${line.level === 'ERROR' ? 'text-destructive/90' : 'text-foreground/80'}`}>
                      {line.message}
                    </span>
                    {hasRedacted && <span className="text-[9px] text-primary/80 font-bold uppercase shrink-0">[PII Sanitized]</span>}
                    {isStack && <span className="text-[9px] text-amber-500 font-bold uppercase shrink-0">[Stack]</span>}
                  </div>
                )
              })}
              {visible.length === 0 && (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  No log entries matched your filter parameters.
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Inspection Drawer */}
        <aside className="rounded-xl border border-border bg-card p-5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Log Inspector & Security</p>
          {activeLog ? (
            <div className="mt-4 flex flex-col gap-4">
              <div>
                <span className="font-mono text-xs text-muted-foreground">{activeLog.time}</span>
                <h3 className="mt-1 text-sm font-semibold text-foreground">{activeLog.service}</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                <Pill className={activeLog.level === 'ERROR' ? 'border-destructive/20 bg-destructive/10 text-destructive' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'}>
                  {activeLog.level}
                </Pill>
                {activeLog.message.includes('[REDACTED') && (
                  <Pill className="border-primary/20 bg-primary/10 text-primary">Secret Scrubbed</Pill>
                )}
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs text-foreground whitespace-pre-wrap leading-5">
                {activeLog.message}
              </div>
              <div className="text-xs text-muted-foreground leading-5">
                <p><strong className="text-foreground">Source Driver:</strong> Container stdout / FastAPI Middleware</p>
                <p><strong className="text-foreground">Agent Ingestion:</strong> Enabled for RCA correlation</p>
              </div>
            </div>
          ) : (
            <div className="mt-8 text-center text-xs text-muted-foreground">
              Select any log entry on the left to view detailed trace breakdown, PII sanitization status, and root cause evidence links.
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function SettingsView({ theme, setTheme }: { theme: 'light' | 'dark'; setTheme: (t: 'light' | 'dark') => void }) { return <div className="flex max-w-4xl flex-col gap-6"><SectionTitle eyebrow="Workspace / Preferences" title="Settings" /><section className="rounded-xl border border-border bg-card"><div className="border-b border-border p-5"><h3 className="text-sm font-semibold">Appearance</h3><p className="mt-1 text-xs text-muted-foreground">Tune the command center for your environment.</p></div><div className="flex items-center justify-between p-5"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">{theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}</span><div><p className="text-sm font-medium">Color theme</p><p className="mt-1 text-xs text-muted-foreground">Choose between a focused dark workspace or bright mode.</p></div></div><div className="flex rounded-lg border border-border p-1">{(['light', 'dark'] as const).map((item) => <button key={item} onClick={() => setTheme(item)} className={`rounded-md px-3 py-1.5 text-xs capitalize ${theme === item ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>{item}</button>)}</div></div></section><section className="rounded-xl border border-border bg-card"><div className="border-b border-border p-5"><h3 className="text-sm font-semibold">Connected integrations</h3><p className="mt-1 text-xs text-muted-foreground">Sources used by the investigation agent.</p></div>{[{ icon: GitBranch, name: 'GitHub', detail: 'acme organization · connected' }, { icon: Cloud, name: 'Kubernetes', detail: 'production cluster · connected' }, { icon: Logs, name: 'Log provider', detail: 'structured runtime logs · connected' }].map(({ icon: Icon, name, detail }) => <div key={name} className="flex items-center justify-between border-b border-border p-5 last:border-0"><div className="flex items-center gap-3"><Icon className="size-4 text-muted-foreground" /><div><p className="text-sm font-medium">{name}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div></div><Button variant="outline" size="sm">Configure</Button></div>)}</section><section className="rounded-xl border border-border bg-card"><div className="border-b border-border p-5"><h3 className="text-sm font-semibold">Alert preferences</h3><p className="mt-1 text-xs text-muted-foreground">Control when the team is notified.</p></div>{['Critical incidents', 'Fixes ready for approval', 'Deployment failures'].map((label, i) => <div key={label} className="flex items-center justify-between border-b border-border p-5 last:border-0"><div><p className="text-sm font-medium">{label}</p><p className="mt-1 text-xs text-muted-foreground">Notify the on-call channel and email.</p></div><button aria-label={`Toggle ${label}`} className={`relative h-5 w-9 rounded-full ${i < 2 ? 'bg-primary' : 'bg-muted'}`}><span className={`absolute top-1 size-3 rounded-full bg-primary-foreground transition-transform ${i < 2 ? 'left-5' : 'left-1'}`} /></button></div>)}</section></div> }

// ── Terminal Hub Component ─────────────────────────────────────────────────────
interface TerminalHubProps {
  terminalTab: 'local' | 'docker'
  setTerminalTab: (t: 'local' | 'docker') => void
  localCommand: string
  setLocalCommand: (c: string) => void
  localWorkingDir: string
  setLocalWorkingDir: (d: string) => void
  allowedCommands: string[]
  dockerContainers: any[]
  selectedContainer: string
  setSelectedContainer: (id: string) => void
  activeLocalSession: string | null
  activeDockerSession: string | null
  terminalStarting: boolean
  terminalError: string
  aiErrorSummaries: AIErrorSummary[]
  onStartLocal: () => void
  onStopLocal: () => void
  onStartDocker: () => void
  onStopDocker: () => void
  onAIError: (s: AIErrorSummary) => void
  onEscalate: (s: AIErrorSummary) => void
}

function TerminalHub({
  terminalTab, setTerminalTab,
  localCommand, setLocalCommand,
  localWorkingDir, setLocalWorkingDir,
  allowedCommands, dockerContainers,
  selectedContainer, setSelectedContainer,
  activeLocalSession, activeDockerSession,
  terminalStarting, terminalError,
  aiErrorSummaries, onStartLocal, onStopLocal,
  onStartDocker, onStopDocker, onAIError, onEscalate
}: TerminalHubProps) {
  const activeSession = terminalTab === 'local' ? activeLocalSession : activeDockerSession
  const isRunning = Boolean(activeSession)

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">Real-Time Intelligence</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">Terminal Hub</h2>
          <p className="mt-1 text-sm text-muted-foreground">Stream local processes & Docker containers with AI-powered error analysis.</p>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <div className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1.5 text-xs text-green-500">
              <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
              Live Streaming
            </div>
          )}
        </div>
      </div>

      {/* Tab selector */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-muted/30 border border-border w-fit">
        {(['local', 'docker'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setTerminalTab(tab)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              terminalTab === tab ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'local' ? <Terminal className="size-4" /> : <Server className="size-4" />}
            {tab === 'local' ? 'Local Process' : 'Docker Container'}
          </button>
        ))}
      </div>

      {/* Error alert */}
      {terminalError && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
          <AlertTriangle className="size-4 text-destructive shrink-0" />
          <p className="text-sm text-destructive">{terminalError}</p>
        </div>
      )}

      {/* Main grid: Controls + Terminal + AI Panel */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
        {/* Left: Controls + Console */}
        <div className="flex flex-col gap-4">
          {/* Controls panel */}
          <div className="rounded-xl border border-border bg-card p-5">
            {terminalTab === 'local' ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <Terminal className="size-5 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">Local Process Monitor</p>
                    <p className="text-xs text-muted-foreground">Start a controlled local process and stream its output in real-time.</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1 block">Command</label>
                    <select
                      value={localCommand}
                      onChange={e => setLocalCommand(e.target.value)}
                      className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {(allowedCommands.length > 0 ? allowedCommands : ['npm run dev', 'npm start', 'python main.py', 'uvicorn app.main:app --reload']).map(cmd => (
                        <option key={cmd} value={cmd}>{cmd}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1 block">Working Directory</label>
                    <input
                      value={localWorkingDir}
                      onChange={e => setLocalWorkingDir(e.target.value)}
                      placeholder="./frontend or /path/to/project"
                      className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {isRunning ? (
                    <button
                      onClick={onStopLocal}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-sm font-medium hover:bg-destructive/20 transition-all"
                    >
                      <X className="size-4" />
                      Stop Process
                    </button>
                  ) : (
                    <button
                      onClick={onStartLocal}
                      disabled={terminalStarting}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-50"
                    >
                      {terminalStarting ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}
                      {terminalStarting ? 'Starting...' : 'Start Process'}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <Server className="size-5 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">Docker Container Monitor</p>
                    <p className="text-xs text-muted-foreground">Stream logs from a running Docker container in real-time.</p>
                  </div>
                </div>
                {/* Container table */}
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/40 border-b border-border">
                        <th className="px-3 py-2 text-left font-mono uppercase tracking-wider text-muted-foreground">Container</th>
                        <th className="px-3 py-2 text-left font-mono uppercase tracking-wider text-muted-foreground">Image</th>
                        <th className="px-3 py-2 text-left font-mono uppercase tracking-wider text-muted-foreground">Status</th>
                        <th className="px-3 py-2 text-left font-mono uppercase tracking-wider text-muted-foreground">Ports</th>
                        <th className="px-3 py-2 text-center font-mono uppercase tracking-wider text-muted-foreground">Select</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(dockerContainers.length > 0 ? dockerContainers : [
                        { id: 'demo_1', name: 'ai-devops-backend', status: 'running', image: 'python:3.12-slim', ports: '8000' },
                        { id: 'demo_2', name: 'ai-devops-postgres', status: 'running', image: 'postgres:15', ports: '5432' },
                        { id: 'demo_3', name: 'ai-devops-redis', status: 'exited', image: 'redis:7-alpine', ports: '6379' },
                      ]).map((container: any) => (
                        <tr
                          key={container.id}
                          onClick={() => setSelectedContainer(container.id)}
                          className={`border-b border-border cursor-pointer transition-colors ${selectedContainer === container.id ? 'bg-primary/10' : 'hover:bg-muted/30'}`}
                        >
                          <td className="px-3 py-2 font-medium font-mono text-foreground">{container.name}</td>
                          <td className="px-3 py-2 text-muted-foreground">{container.image}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${container.status === 'running' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-400'}`}>
                              <span className={`size-1 rounded-full ${container.status === 'running' ? 'bg-green-500' : 'bg-red-400'}`} />
                              {container.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground font-mono">{container.ports}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`size-3 rounded-full border-2 inline-block ${selectedContainer === container.id ? 'bg-primary border-primary' : 'border-muted-foreground'}`} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center gap-3">
                  {isRunning ? (
                    <button
                      onClick={onStopDocker}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-sm font-medium hover:bg-destructive/20 transition-all"
                    >
                      <X className="size-4" />
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={onStartDocker}
                      disabled={terminalStarting || !selectedContainer}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-50"
                    >
                      {terminalStarting ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}
                      {terminalStarting ? 'Connecting...' : 'Connect & Stream'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Terminal Console */}
          {activeSession ? (
            <TerminalConsole
              sessionId={activeSession}
              title={terminalTab === 'local' ? `Local: ${localCommand}` : `Docker: ${selectedContainer}`}
              source={terminalTab}
              onAIError={onAIError}
              height={460}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/10 flex flex-col items-center justify-center gap-3" style={{ height: 460 }}>
              <div className="grid size-12 place-items-center rounded-xl bg-muted/40">
                <Terminal className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No active session</p>
              <p className="text-xs text-muted-foreground/60">Start a {terminalTab === 'local' ? 'process' : 'container stream'} above to see real-time output here</p>
            </div>
          )}
        </div>

        {/* Right: AI Error Analysis */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-purple-400" />
            <p className="text-sm font-semibold text-foreground">AI Error Analysis</p>
            <span className="text-xs text-muted-foreground">— Level 1</span>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Errors are automatically detected, parsed, and analyzed by AI without blocking the terminal stream.
          </p>
          <AIErrorSummaryPanel summaries={aiErrorSummaries} onCreateIncident={onEscalate} />

          {/* Architecture info card */}
          <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
            <p className="text-xs font-semibold text-purple-300 mb-2">Two-Level AI Architecture</p>
            <div className="space-y-1.5 text-[11px] text-purple-200/70 font-mono">
              {[
                'Terminal Output',
                'Error Pattern Detection',
                'Stack Trace Parser',
                'Error Normalizer',
                '→ Level 1: AI Error Summary (real-time)',
                '→ Level 2: Full Incident Investigation',
              ].map((step, i) => (
                <div key={i} className={`flex items-center gap-2 ${step.includes('Level') ? 'text-purple-300' : ''}`}>
                  <span className={`size-1.5 rounded-full ${step.includes('Level 1') ? 'bg-purple-400' : step.includes('Level 2') ? 'bg-blue-400' : 'bg-purple-700'}`} />
                  {step}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Docker Monitor Embed ───────────────────────────────────────────────────────
// Renders the standalone Docker Monitor page inside the command center shell.
// Completely isolated — no GitHub, no incidents, no terminal state.

import dynamic from 'next/dynamic'

const DockerMonitorPage = dynamic(
  () => import('@/app/docker/page'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-96">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" />
          <span className="text-sm">Loading Docker Monitor…</span>
        </div>
      </div>
    ),
  }
)

function DockerMonitorEmbed() {
  return (
    <div className="h-[calc(100vh-8rem)] -mx-4 md:-mx-8 -mt-4 md:-mt-8">
      <DockerMonitorPage />
    </div>
  )
}
