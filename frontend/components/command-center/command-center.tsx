'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Activity, AlertTriangle, ArrowRight, Boxes, Check, ChevronDown, Container, ExternalLink,
  GitBranch, KeyRound, LayoutDashboard, LoaderCircle, Menu, Moon, Play,
  RefreshCw, Rocket, Search, Server, Settings, ShieldCheck, Sparkles, Sun,
  Terminal, UserRound, X, Zap
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { NavKey } from '@/lib/types'
import {
  fetchDockerStatus, fetchImages, fetchDockerErrors,
  type DockerDaemonStatus, type DockerImage, type DockerErrorWithSummary
} from '@/lib/docker-api'
import {
  getGitHubStatus, fetchGitHubRepos,
  type GitHubStatusResponse, type GitHubRepository
} from '@/lib/github-monitor-api'
import {
  getDeploymentStatus, fetchDeploymentProjects,
  type DeploymentStatusResponse
} from '@/lib/deployment-monitor-api'
import {
  loginUser, registerUser, fetchCurrentUser, forgotPassword, resetPassword,
  updateGitHubToken, disconnectGitHubToken,
  fetchAllowedCommands, fetchDockerContainers, startLocalTerminal, startDockerTerminal,
  stopLocalTerminal, stopDockerTerminal
} from '@/lib/api'
import { TerminalConsole } from '@/components/terminal/TerminalConsole'
import { AIErrorSummaryPanel } from '@/components/terminal/AIErrorSummaryPanel'
import type { AIErrorSummary } from '@/lib/websocket'
import dynamic from 'next/dynamic'

const navItems: { key: NavKey; label: string; icon: typeof Activity }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'terminal', label: 'Terminal Hub', icon: Terminal },
  { key: 'docker', label: 'Docker Monitor', icon: Container },
  { key: 'github-monitor', label: 'GitHub Monitor', icon: GitBranch },
  { key: 'deployment-monitor', label: 'Deployment Monitor', icon: Rocket },
]

function Pill({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${className}`}>{children}</span>
}

function SectionTitle({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">{eyebrow}</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      </div>
      {action}
    </div>
  )
}


export function CommandCenter() {
  const [active, setActive] = useState<NavKey>('overview')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [mobileNav, setMobileNav] = useState(false)
  const [query, setQuery] = useState('')

  // Synchronize and persist theme to localStorage and document root
  useEffect(() => {
    const saved = localStorage.getItem('app_theme') as 'light' | 'dark' | null
    if (saved === 'light' || saved === 'dark') {
      setTheme(saved)
    } else {
      setTheme('light')
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('app_theme', theme)
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
      document.documentElement.classList.remove('light')
    } else {
      document.documentElement.classList.remove('dark')
      document.documentElement.classList.add('light')
    }
    document.documentElement.style.colorScheme = theme
  }, [theme])

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
    fetchAllowedCommands().then(setAllowedCommands)
    fetchDockerContainers().then(containers => {
      setDockerContainers(containers)
      if (containers.length > 0 && !selectedContainer) {
        setSelectedContainer(containers[0].id)
      }
    })
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

  const go = (key: NavKey) => { setActive(key); setMobileNav(false) }

  return (
    <div className={theme === 'dark' ? 'dark' : ''}>
      <div className="min-h-screen bg-background text-foreground transition-colors">
        <div className="flex min-h-screen">
          {/* Sidebar */}
          <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-sidebar transition-transform lg:sticky lg:top-0 lg:h-screen lg:shrink-0 lg:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`}>
            <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-5">
              <button onClick={() => go('overview')} className="flex items-center gap-3 text-left">
                <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <Zap className="size-4" />
                </span>
                <span>
                  <span className="block text-sm font-bold tracking-tight">pulse<span className="text-primary">/</span>ops</span>
                  <span className="block font-mono text-[9px] uppercase tracking-widest text-muted-foreground">command center</span>
                </span>
              </button>
              <button className="lg:hidden" onClick={() => setMobileNav(false)} aria-label="Close navigation">
                <X />
              </button>
            </div>

            <div className="border-b border-sidebar-border p-3">
              <div className="flex w-full items-center justify-between rounded-lg border border-border bg-background/60 p-2.5 text-left">
                <span className="flex items-center gap-2.5">
                  <span className="grid size-7 place-items-center rounded-md bg-primary/10 text-primary">
                    <Boxes className="size-4" />
                  </span>
                  <span>
                    <span className="block text-xs font-semibold">DevOps Workspace</span>
                    <span className="block font-mono text-[10px] text-muted-foreground">Autonomous Monitors</span>
                  </span>
                </span>
              </div>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-4">
              <p className="px-2 pb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Core Monitors</p>
              <div className="flex flex-col gap-1">
                {navItems.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => go(key)}
                    className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      active === key ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="size-4" />
                      {label}
                    </span>
                  </button>
                ))}
              </div>

              <p className="px-2 pb-2 pt-7 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Workspace</p>
              <button
                onClick={() => go('settings')}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground ${
                  active === 'settings' ? 'bg-muted text-foreground' : ''
                }`}
              >
                <Settings className="size-4" />
                Settings
              </button>
            </nav>

            <div className="border-t border-sidebar-border p-3">
              {currentUser?.has_github_token ? (
                <div className="mb-2 flex items-center justify-between rounded-lg bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-600">
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-emerald-500" />GitHub Connected
                  </span>
                  <button onClick={() => setShowGitHubModal(true)} className="text-[10px] underline hover:text-emerald-700">Manage</button>
                </div>
              ) : (
                <div className="mb-2 flex items-center justify-between rounded-lg bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-muted-foreground/40" />GitHub (Optional)
                  </span>
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

          {/* Main Area */}
          <main className="min-w-0 flex-1">
            <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/85 px-4 backdrop-blur-md md:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open navigation">
                  <Menu />
                </Button>
                <div className="hidden h-8 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 text-xs text-muted-foreground sm:flex">
                  <Search className="size-3.5" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search commands, containers, commits..."
                    className="w-56 bg-transparent outline-none placeholder:text-muted-foreground/60"
                  />
                  <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[9px]">⌘ K</kbd>
                </div>
                <span className="truncate text-sm font-semibold sm:hidden">{navItems.find((n) => n.key === active)?.label || 'Settings'}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Toggle theme"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-all hover:bg-muted shadow-xs active:scale-95"
                >
                  {theme === 'dark' ? (
                    <>
                      <Sun className="size-4 text-amber-400" />
                      <span className="hidden sm:inline text-xs font-semibold">Light Mode</span>
                    </>
                  ) : (
                    <>
                      <Moon className="size-4 text-slate-700" />
                      <span className="hidden sm:inline text-xs font-semibold">Dark Mode</span>
                    </>
                  )}
                </button>
                <Button variant="ghost" size="icon" aria-label="Status">
                  <span className="relative">
                    <Activity />
                    <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-emerald-500" />
                  </span>
                </Button>
              </div>
            </header>

            <div className="mx-auto max-w-[1500px] p-4 md:p-8 min-w-0 overflow-x-hidden">
              {active === 'overview' ? (
                <Overview
                  onNavigate={go}
                  activeLocalSession={activeLocalSession}
                  activeDockerSession={activeDockerSession}
                  dockerContainers={dockerContainers}
                  allowedCommands={allowedCommands}
                  currentUser={currentUser}
                  onConnectGitHub={() => setShowGitHubModal(true)}
                />
              ) : active === 'terminal' ? (
                <TerminalHub
                  localCommand={localCommand} setLocalCommand={setLocalCommand}
                  localWorkingDir={localWorkingDir} setLocalWorkingDir={setLocalWorkingDir}
                  allowedCommands={allowedCommands}
                  activeLocalSession={activeLocalSession}
                  terminalStarting={terminalStarting} terminalError={terminalError}
                  aiErrorSummaries={aiErrorSummaries}
                  onStartLocal={handleStartLocalTerminal} onStopLocal={handleStopLocalTerminal}
                  onAIError={handleAIError}
                />
              ) : active === 'docker' ? (
                <DockerMonitorEmbed />
              ) : active === 'github-monitor' ? (
                <GitHubMonitorEmbed />
              ) : active === 'deployment-monitor' ? (
                <DeploymentMonitorEmbed />
              ) : (
                <SettingsView theme={theme} setTheme={setTheme} />
              )}
            </div>
          </main>
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
                  Connecting your token enables real-time commit monitoring, multi-branch diff inspection, and AI commit risk analysis across your personal or organizational repositories.
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
                    placeholder="ghp_xxxxxxxxxxxx..."
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

        {/* Authentication Modal */}
        {showAuthModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
            <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-border pb-4">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    {authTab === 'signin' ? 'Sign In to Command Center' : authTab === 'signup' ? 'Create Your Account' : authTab === 'forgot' ? 'Forgot Password' : 'Reset Your Password'}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {authTab === 'signin' ? 'Access your DevOps Monitoring Hub' : authTab === 'signup' ? 'Sign up to manage terminals and monitors' : 'Recover your account access via email'}
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
                    {authLoading ? 'Signing In...' : 'Sign In'}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground mt-2">
                    Don't have an account?{' '}
                    <button type="button" onClick={() => { setAuthTab('signup'); setAuthError(''); setAuthMessage(''); }} className="text-primary underline">Sign up</button>
                  </p>
                </form>
              )}

              {authTab === 'signup' && (
                <form onSubmit={handleSignUpSubmit} className="mt-4 flex flex-col gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-muted-foreground">Full Name</label>
                    <input type="text" required value={authFullName} onChange={(e) => setAuthFullName(e.target.value)} placeholder="Maya Lin" className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase text-muted-foreground">Email Address</label>
                    <input type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="engineer@company.com" className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase text-muted-foreground">Password</label>
                    <input type="password" required value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="••••••••" className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase text-muted-foreground">Role</label>
                    <select value={authRole} onChange={(e) => setAuthRole(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary">
                      <option value="ENGINEER">DevOps Engineer</option>
                      <option value="ADMIN">Team Lead / Admin</option>
                      <option value="VIEWER">Viewer / On-Call</option>
                    </select>
                  </div>
                  <Button type="submit" size="sm" disabled={authLoading} className="mt-2">
                    {authLoading ? 'Creating Account...' : 'Create Account'}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground mt-2">
                    Already have an account?{' '}
                    <button type="button" onClick={() => { setAuthTab('signin'); setAuthError(''); setAuthMessage(''); }} className="text-primary underline">Sign in</button>
                  </p>
                </form>
              )}

              {authTab === 'forgot' && (
                <form onSubmit={handleForgotPasswordSubmit} className="mt-4 flex flex-col gap-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-muted-foreground">Registered Email</label>
                    <input type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="engineer@company.com" className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary" />
                  </div>
                  <Button type="submit" size="sm" disabled={authLoading} className="mt-2">
                    {authLoading ? 'Sending Token...' : 'Generate Reset Token'}
                  </Button>
                  <div className="flex justify-between items-center text-xs text-muted-foreground mt-2">
                    <button type="button" onClick={() => setAuthTab('signin')} className="text-primary hover:underline">← Back to Sign In</button>
                    <button type="button" onClick={() => setAuthTab('reset')} className="text-primary hover:underline">Already have token?</button>
                  </div>
                </form>
              )}

              {authTab === 'reset' && (
                <form onSubmit={handleResetPasswordSubmit} className="mt-4 flex flex-col gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-muted-foreground">Email</label>
                    <input type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="engineer@company.com" className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase text-muted-foreground">Reset Token</label>
                    <input type="text" required value={resetTokenInput} onChange={(e) => setResetTokenInput(e.target.value)} placeholder="Paste token here" className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 font-mono text-xs outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase text-muted-foreground">New Password</label>
                    <input type="password" required value={newPasswordInput} onChange={(e) => setNewPasswordInput(e.target.value)} placeholder="••••••••" className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary" />
                  </div>
                  <Button type="submit" size="sm" disabled={authLoading} className="mt-2">
                    {authLoading ? 'Resetting Password...' : 'Reset Password'}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground mt-2">
                    <button type="button" onClick={() => setAuthTab('signin')} className="text-primary underline">← Back to Sign In</button>
                  </p>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Overview Component (100% Real DevOps Telemetry) ───────────────────────────

function Overview({
  onNavigate,
  activeLocalSession,
  activeDockerSession,
  dockerContainers,
  allowedCommands,
  currentUser,
  onConnectGitHub,
}: {
  onNavigate: (key: NavKey) => void
  activeLocalSession: string | null
  activeDockerSession: string | null
  dockerContainers: any[]
  allowedCommands: string[]
  currentUser: any
  onConnectGitHub: () => void
}) {
  // Real live telemetry states
  const [dockerStatus, setDockerStatus] = useState<DockerDaemonStatus | null>(null)
  const [dockerImages, setDockerImages] = useState<DockerImage[]>([])
  const [dockerErrors, setDockerErrors] = useState<DockerErrorWithSummary[]>([])
  const [githubStatus, setGithubStatus] = useState<GitHubStatusResponse | null>(null)
  const [githubRepos, setGithubRepos] = useState<GitHubRepository[]>([])
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatusResponse | null>(null)
  const [deploymentProjectsCount, setDeploymentProjectsCount] = useState<number>(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<string>('')

  const loadRealTelemetry = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const [dStatus, dImages, dErrors, ghStatus, ghRepos, depStatus] = await Promise.allSettled([
        fetchDockerStatus(),
        fetchImages(),
        fetchDockerErrors({ limit: 6 }),
        getGitHubStatus(),
        fetchGitHubRepos().catch(() => []),
        getDeploymentStatus(),
      ])

      if (dStatus.status === 'fulfilled') setDockerStatus(dStatus.value)
      if (dImages.status === 'fulfilled') setDockerImages(dImages.value)
      if (dErrors.status === 'fulfilled') setDockerErrors(dErrors.value)
      if (ghStatus.status === 'fulfilled') setGithubStatus(ghStatus.value)
      if (ghRepos.status === 'fulfilled') setGithubRepos(ghRepos.value)
      if (depStatus.status === 'fulfilled') {
        setDeploymentStatus(depStatus.value)
        if (depStatus.value.connected) {
          fetchDeploymentProjects()
            .then(res => setDeploymentProjectsCount(res.projects.length))
            .catch(() => setDeploymentProjectsCount(0))
        }
      }
      setLastUpdated(new Date().toLocaleTimeString())
    } catch (err) {
      console.error('Error loading real telemetry:', err)
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadRealTelemetry()
    // Periodic real data refresh every 15s
    const timer = setInterval(loadRealTelemetry, 15000)
    return () => clearInterval(timer)
  }, [loadRealTelemetry])

  const runningContainers = dockerContainers.filter(c => c.status === 'running').length
  const totalContainers = dockerContainers.length
  const hasLocalActive = Boolean(activeLocalSession)
  const hasDockerActive = Boolean(activeDockerSession)
  const isGitHubConnected = Boolean(githubStatus?.connected || currentUser?.has_github_token)
  const userName = currentUser?.full_name || githubStatus?.user?.name || githubStatus?.user?.login || 'Engineer'

  return (
    <div className="flex flex-col gap-8">
      {/* Welcome & Live Status Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
              REAL-TIME PRODUCTION TELEMETRY · LIVE DATA
            </p>
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl text-foreground">
            Welcome back, {userName}.
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Monitoring {totalContainers} container{totalContainers !== 1 ? 's' : ''}, {githubRepos.length} GitHub repos{githubStatus?.user?.login ? ` (@${githubStatus.user.login})` : ''}, and active runtime endpoints.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-[11px] font-mono text-muted-foreground">
              Synced {lastUpdated}
            </span>
          )}
          <button
            onClick={loadRealTelemetry}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted shadow-xs transition-all disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 text-primary ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Syncing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Primary KPI Grid (4 Pillars) */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Pillar 1: Terminal Hub */}
        <div
          onClick={() => onNavigate('terminal')}
          className="cursor-pointer rounded-xl border border-border bg-card p-5 transition-all hover:border-primary hover:shadow-md group shadow-xs"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Terminal Hub</span>
            <span className="size-8 grid place-items-center rounded-lg bg-primary/10 text-primary">
              <Terminal className="size-4" />
            </span>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-3xl font-bold tracking-tight text-foreground font-mono">
              {(hasLocalActive ? 1 : 0) + (hasDockerActive ? 1 : 0)}
            </span>
            <span className={`font-mono text-xs font-semibold ${hasLocalActive || hasDockerActive ? 'text-emerald-500' : 'text-muted-foreground'}`}>
              {hasLocalActive || hasDockerActive ? 'Session Active' : 'Standby'}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground font-mono truncate">
            {allowedCommands.length} allowed command{allowedCommands.length !== 1 ? 's' : ''} ready
          </p>
        </div>

        {/* Pillar 2: Docker Monitor */}
        <div
          onClick={() => onNavigate('docker')}
          className="cursor-pointer rounded-xl border border-border bg-card p-5 transition-all hover:border-blue-500 hover:shadow-md group shadow-xs"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Docker Monitor</span>
            <span className="size-8 grid place-items-center rounded-lg bg-blue-500/10 text-blue-500">
              <Container className="size-4" />
            </span>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-3xl font-bold tracking-tight text-foreground font-mono">
              {runningContainers} <span className="text-lg text-muted-foreground font-normal">/ {totalContainers}</span>
            </span>
            <span className={`font-mono text-xs font-semibold ${runningContainers > 0 ? 'text-emerald-500' : 'text-muted-foreground'}`}>
              {runningContainers > 0 ? 'Containers Up' : 'None Running'}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground font-mono truncate">
            {dockerImages.length} cached image{dockerImages.length !== 1 ? 's' : ''} · {dockerErrors.length} error{dockerErrors.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Pillar 3: GitHub Monitor */}
        <div
          onClick={() => onNavigate('github-monitor')}
          className="cursor-pointer rounded-xl border border-border bg-card p-5 transition-all hover:border-purple-500 hover:shadow-md group shadow-xs"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">GitHub Monitor</span>
            <span className="size-8 grid place-items-center rounded-lg bg-purple-500/10 text-purple-500">
              <GitBranch className="size-4" />
            </span>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-3xl font-bold tracking-tight text-foreground font-mono">
              {isGitHubConnected ? githubRepos.length : '0'}
            </span>
            <span className={`font-mono text-xs font-semibold ${isGitHubConnected ? 'text-purple-500' : 'text-amber-500'}`}>
              {isGitHubConnected ? 'Connected' : 'Token Required'}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground font-mono truncate">
            {isGitHubConnected && githubStatus?.user?.login ? `@${githubStatus.user.login}` : 'Connect PAT to sync repos'}
          </p>
        </div>

        {/* Pillar 4: Deployment Monitor */}
        <div
          onClick={() => onNavigate('deployment-monitor')}
          className="cursor-pointer rounded-xl border border-border bg-card p-5 transition-all hover:border-orange-500 hover:shadow-md group shadow-xs"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Deployment Monitor</span>
            <span className="size-8 grid place-items-center rounded-lg bg-orange-500/10 text-orange-500">
              <Rocket className="size-4" />
            </span>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-3xl font-bold tracking-tight text-foreground font-mono">
              {deploymentStatus?.connected ? deploymentProjectsCount : '—'}
            </span>
            <span className={`font-mono text-xs font-semibold ${deploymentStatus?.connected ? 'text-emerald-500' : 'text-muted-foreground'}`}>
              {deploymentStatus?.connected ? `${deploymentStatus.platform?.toUpperCase()}` : 'Disconnected'}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground font-mono truncate">
            {deploymentStatus?.connected ? 'Telemetry active' : 'Vercel, Railway, Render'}
          </p>
        </div>
      </div>

      {/* Autonomous DevOps Hubs Navigation */}
      <div>
        <SectionTitle eyebrow="Navigation" title="Autonomous DevOps Hubs" />
        <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {/* Terminal Hub */}
          <div
            onClick={() => onNavigate('terminal')}
            className="group cursor-pointer rounded-xl border border-border bg-card p-5 transition-all hover:border-primary hover:shadow-lg flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Terminal className="size-5" />
                </span>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
              </div>
              <h3 className="mt-3 text-base font-semibold text-foreground">Terminal Hub</h3>
              <p className="mt-1 text-xs text-muted-foreground leading-5">
                Execute local processes & commands with real-time stdout/stderr streaming and automated AI error diagnoses.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs font-mono">
              <span className="text-primary font-medium">
                {hasLocalActive ? '● 1 Session Active' : 'Standby'}
              </span>
              <span className="text-muted-foreground group-hover:text-primary">Open →</span>
            </div>
          </div>

          {/* Docker Monitor */}
          <div
            onClick={() => onNavigate('docker')}
            className="group cursor-pointer rounded-xl border border-border bg-card p-5 transition-all hover:border-blue-500 hover:shadow-lg flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-lg bg-blue-500/10 text-blue-500">
                  <Container className="size-5" />
                </span>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-blue-500" />
              </div>
              <h3 className="mt-3 text-base font-semibold text-foreground">Docker Monitor</h3>
              <p className="mt-1 text-xs text-muted-foreground leading-5">
                Inspect {totalContainers} local container{totalContainers !== 1 ? 's' : ''}, live log tailing, container connect, and AI root cause diagnosis.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs font-mono">
              <span className="text-blue-500 font-medium">
                {runningContainers} running · {totalContainers} total
              </span>
              <span className="text-muted-foreground group-hover:text-blue-500">Open →</span>
            </div>
          </div>

          {/* GitHub Monitor */}
          <div
            onClick={() => onNavigate('github-monitor')}
            className="group cursor-pointer rounded-xl border border-border bg-card p-5 transition-all hover:border-purple-500 hover:shadow-lg flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-lg bg-purple-500/10 text-purple-500">
                  <GitBranch className="size-5" />
                </span>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-purple-500" />
              </div>
              <h3 className="mt-3 text-base font-semibold text-foreground">GitHub Monitor</h3>
              <p className="mt-1 text-xs text-muted-foreground leading-5">
                Inspect multi-branch commits, real code diffs, and deep AI commit risk analysis across your personal repositories.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs font-mono">
              <span className="text-purple-500 font-medium truncate max-w-[140px]">
                {isGitHubConnected && githubStatus?.user?.login ? `@${githubStatus.user.login}` : 'Connect PAT'}
              </span>
              <span className="text-muted-foreground group-hover:text-purple-500">Open →</span>
            </div>
          </div>

          {/* Deployment Monitor */}
          <div
            onClick={() => onNavigate('deployment-monitor')}
            className="group cursor-pointer rounded-xl border border-border bg-card p-5 transition-all hover:border-orange-500 hover:shadow-lg flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-lg bg-orange-500/10 text-orange-500">
                  <Rocket className="size-5" />
                </span>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-orange-500" />
              </div>
              <h3 className="mt-3 text-base font-semibold text-foreground">Deployment Monitor</h3>
              <p className="mt-1 text-xs text-muted-foreground leading-5">
                Track live production builds, runtime errors, and cloud logs across Vercel, Railway, and Render with automated AI fixes.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs font-mono">
              <span className="text-orange-500 font-medium">
                {deploymentStatus?.connected ? 'Cloud Active' : 'Configure Cloud'}
              </span>
              <span className="text-muted-foreground group-hover:text-orange-500">Open →</span>
            </div>
          </div>
        </div>
      </div>

      {/* Real-Data Deep Insights Section */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Real Local Container Fleet */}
        <section className="rounded-xl border border-border bg-card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Docker Daemon</p>
                <h3 className="text-base font-semibold text-foreground mt-0.5">Container Fleet ({totalContainers})</h3>
              </div>
              <button
                onClick={() => onNavigate('docker')}
                className="text-xs text-primary hover:underline font-mono"
              >
                View all in Docker Monitor →
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {dockerContainers.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  <p>No containers detected on local Docker daemon.</p>
                  <p className="text-[11px] mt-1">Start Docker Desktop or run a container to stream live metrics.</p>
                </div>
              ) : (
                dockerContainers.slice(0, 6).map(c => {
                  const isRunning = c.status === 'running'
                  return (
                    <div
                      key={c.id}
                      onClick={() => onNavigate('docker')}
                      className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-muted/20 hover:bg-muted/50 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`size-2 rounded-full shrink-0 ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/50'}`} />
                        <div className="min-w-0">
                          <p className="text-xs font-mono font-semibold text-foreground truncate">{c.name}</p>
                          <p className="text-[10px] text-muted-foreground font-mono truncate">{c.image}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {c.ports && c.ports !== 'N/A' && (
                          <span className="text-[10px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                            :{c.ports}
                          </span>
                        )}
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase font-semibold ${
                          isRunning ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'
                        }`}>
                          {c.status}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Docker error telemetry */}
          {dockerErrors.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs font-mono text-muted-foreground">
              <span className="flex items-center gap-1.5 text-red-500 font-semibold">
                <AlertTriangle className="size-3.5" />
                {dockerErrors.length} recent error{dockerErrors.length !== 1 ? 's' : ''} captured
              </span>
              <button onClick={() => onNavigate('docker')} className="text-primary hover:underline">
                Inspect AI Analysis →
              </button>
            </div>
          )}
        </section>

        {/* Right: Real GitHub Repositories Discovered */}
        <section className="rounded-xl border border-border bg-card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-purple-500">GitHub Telemetry</p>
                <h3 className="text-base font-semibold text-foreground mt-0.5">
                  {isGitHubConnected ? `Discovered Repositories (${githubRepos.length})` : 'GitHub Integration'}
                </h3>
              </div>
              {isGitHubConnected ? (
                <button
                  onClick={() => onNavigate('github-monitor')}
                  className="text-xs text-purple-500 hover:underline font-mono"
                >
                  View in GitHub Monitor →
                </button>
              ) : (
                <button
                  onClick={onConnectGitHub}
                  className="text-xs text-primary font-semibold hover:underline"
                >
                  + Connect PAT Token
                </button>
              )}
            </div>

            <div className="mt-4 space-y-2">
              {!isGitHubConnected ? (
                <div className="p-6 rounded-xl border border-dashed border-border text-center space-y-2">
                  <GitBranch className="size-8 mx-auto text-muted-foreground opacity-60" />
                  <p className="text-sm font-semibold text-foreground">Connect your GitHub PAT</p>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                    Provide a Personal Access Token to enable real-time commit monitoring, multi-branch diffs, and automated AI code review.
                  </p>
                  <Button size="sm" onClick={onConnectGitHub} className="mt-2">
                    Connect GitHub Token
                  </Button>
                </div>
              ) : githubRepos.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  <p>Loading repositories from GitHub API…</p>
                </div>
              ) : (
                githubRepos.slice(0, 5).map(repo => (
                  <div
                    key={repo.id}
                    onClick={() => onNavigate('github-monitor')}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-muted/20 hover:bg-muted/50 transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-mono font-bold text-foreground truncate">{repo.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{repo.description || repo.full_name}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 font-mono text-[10px]">
                      {repo.language && (
                        <span className="text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                          {repo.language}
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        ★ {repo.stargazers_count}
                      </span>
                      <span className="text-muted-foreground/80 bg-muted px-1.5 py-0.5 rounded">
                        {repo.default_branch}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Subsystems Integration Status Bar */}
          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs font-mono text-muted-foreground">
            <span>
              Connected as: <strong className="text-foreground">{githubStatus?.user?.login ? `@${githubStatus.user.login}` : 'Local Session'}</strong>
            </span>
            <span className="text-emerald-500 font-semibold">
              ● API Ready
            </span>
          </div>
        </section>
      </div>
    </div>
  )
}

// ── Settings Component ────────────────────────────────────────────────────────

function SettingsView({ theme, setTheme }: { theme: 'light' | 'dark'; setTheme: (t: 'light' | 'dark') => void }) {
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <SectionTitle eyebrow="Workspace / Preferences" title="Settings" />
      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border p-5">
          <h3 className="text-sm font-semibold">Appearance</h3>
          <p className="mt-1 text-xs text-muted-foreground">Tune the command center for your environment.</p>
        </div>
        <div className="flex items-center justify-between p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
              {theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
            </span>
            <div>
              <p className="text-sm font-medium">Color theme</p>
              <p className="mt-1 text-xs text-muted-foreground">Choose between a focused dark workspace or bright mode.</p>
            </div>
          </div>
          <div className="flex rounded-lg border border-border p-1">
            {(['light', 'dark'] as const).map((item) => (
              <button
                key={item}
                onClick={() => setTheme(item)}
                className={`rounded-md px-3 py-1.5 text-xs capitalize ${theme === item ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border p-5">
          <h3 className="text-sm font-semibold">DevOps Monitored Services</h3>
          <p className="mt-1 text-xs text-muted-foreground">Active runtime connections powering the platform.</p>
        </div>
        {[
          { icon: Terminal, name: 'Local Terminal Hub', detail: 'Subprocess execution & streaming' },
          { icon: Container, name: 'Docker Monitor', detail: 'Container error ingestion & AI summaries' },
          { icon: GitBranch, name: 'GitHub Intelligence', detail: 'Branch commit inspection & diff analysis' },
        ].map(({ icon: Icon, name, detail }) => (
          <div key={name} className="flex items-center justify-between border-b border-border p-5 last:border-0">
            <div className="flex items-center gap-3">
              <Icon className="size-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
              </div>
            </div>
            <Pill className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600">Enabled</Pill>
          </div>
        ))}
      </section>
    </div>
  )
}

// ── Terminal Hub Component ─────────────────────────────────────────────────────

interface TerminalHubProps {
  localCommand: string
  setLocalCommand: (c: string) => void
  localWorkingDir: string
  setLocalWorkingDir: (d: string) => void
  allowedCommands: string[]
  activeLocalSession: string | null
  terminalStarting: boolean
  terminalError: string
  aiErrorSummaries: AIErrorSummary[]
  onStartLocal: () => void
  onStopLocal: () => void
  onAIError: (s: AIErrorSummary) => void
}

function TerminalHub({
  localCommand, setLocalCommand,
  localWorkingDir, setLocalWorkingDir,
  allowedCommands,
  activeLocalSession,
  terminalStarting, terminalError,
  aiErrorSummaries, onStartLocal, onStopLocal,
  onAIError
}: TerminalHubProps) {
  const isRunning = Boolean(activeLocalSession)

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">Real-Time Intelligence</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">Terminal Hub</h2>
          <p className="mt-1 text-sm text-muted-foreground">Run local processes & commands with real-time AI error diagnosis & automated fix suggestions.</p>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <div className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1.5 text-xs text-green-500 font-mono">
              <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
              Live Streaming
            </div>
          )}
        </div>
      </div>

      {/* Error alert */}
      {terminalError && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
          <AlertTriangle className="size-4 text-destructive shrink-0" />
          <p className="text-sm text-destructive">{terminalError}</p>
        </div>
      )}

      {/* Main grid: Controls + Terminal + AI Panel */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6 min-w-0">
        {/* Left: Controls + Console */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* Controls panel */}
          <div className="rounded-xl border border-border bg-card p-5 min-w-0">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Terminal className="size-5 text-primary" />
                <div>
                  <p className="text-sm font-semibold">Local Process Monitor</p>
                  <p className="text-xs text-muted-foreground">Start a local process or dev server and monitor stdout/stderr with continuous AI analysis.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1 block">Command</label>
                  <input
                    list="allowed-commands-list"
                    value={localCommand}
                    onChange={e => setLocalCommand(e.target.value)}
                    placeholder="e.g. npm start, python main.py, make dev"
                    className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40"
                  />
                  <datalist id="allowed-commands-list">
                    {(allowedCommands.length > 0 ? allowedCommands : [
                      'npm run dev', 'npm start', 'npm test', 'npm run build',
                      'python main.py', 'python app.py', 'uvicorn app.main:app --reload',
                      'make dev', 'make start', 'git status', 'git log'
                    ]).map(cmd => (
                      <option key={cmd} value={cmd} />
                    ))}
                  </datalist>
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
          </div>

          {/* Terminal Console */}
          {activeLocalSession ? (
            <TerminalConsole
              sessionId={activeLocalSession}
              title={`Local: ${localCommand}`}
              source="local"
              onAIError={onAIError}
              height={460}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/10 flex flex-col items-center justify-center gap-3" style={{ height: 460 }}>
              <div className="grid size-12 place-items-center rounded-xl bg-muted/40">
                <Terminal className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No active process</p>
              <p className="text-xs text-muted-foreground/60">Choose a command and click Start Process to stream live output and activate AI diagnostics</p>
            </div>
          )}
        </div>

        {/* Right: AI Error Analysis with Hybrid Sticky Layout */}
        <div className="flex flex-col gap-4 min-w-0 xl:sticky xl:top-20 xl:self-start">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-purple-400" />
            <p className="text-sm font-semibold text-foreground">AI Error Analysis</p>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Errors are automatically detected, parsed, and analyzed with root causes and recommended fixes.
          </p>
          <AIErrorSummaryPanel summaries={aiErrorSummaries} onSelectCommand={setLocalCommand} />
        </div>
      </div>
    </div>
  )
}

// ── Docker Monitor Embed ───────────────────────────────────────────────────────

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

// ── GitHub Monitor Embed ───────────────────────────────────────────────────────

const GitHubMonitorComponent = dynamic(
  () => import('@/components/github/GitHubMonitor').then(mod => mod.GitHubMonitor),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-96">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" />
          <span className="text-sm">Loading GitHub Monitor…</span>
        </div>
      </div>
    ),
  }
)

function GitHubMonitorEmbed() {
  return (
    <div className="h-[calc(100vh-8rem)] -mx-4 md:-mx-8 -mt-4 md:-mt-8">
      <GitHubMonitorComponent />
    </div>
  )
}

// ── Deployment Monitor Embed ──────────────────────────────────────────────────

const DeploymentMonitorComponent = dynamic(
  () => import('@/components/deployment/DeploymentMonitor').then(mod => mod.DeploymentMonitor),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-96">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-orange-400 animate-bounce" />
          <span className="text-sm">Loading Deployment Monitor…</span>
        </div>
      </div>
    ),
  }
)

function DeploymentMonitorEmbed() {
  return (
    <div className="min-h-[calc(100vh-8rem)] -mx-4 md:-mx-8 -mt-4 md:-mt-8 p-4 md:p-8">
      <DeploymentMonitorComponent />
    </div>
  )
}
