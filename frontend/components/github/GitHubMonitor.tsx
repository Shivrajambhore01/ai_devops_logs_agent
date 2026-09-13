'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  GitBranch,
  GitCommit,
  Search,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  KeyRound,
  Lock,
  Globe,
  ArrowRight,
  Eye,
  EyeOff,
  ChevronLeft,
  FolderGit2,
  FileCode2,
  Check,
  Copy,
  ChevronDown,
  ChevronUp,
  Zap,
} from 'lucide-react'
import {
  getGitHubStatus,
  connectGitHubToken,
  connectGitHubEnvToken,
  disconnectGitHub,
  fetchGitHubRepos,
  fetchBranchesWithCommits,
  fetchCommitDeepAnalysis,
  GitHubUserProfile,
  GitHubRepository,
  BranchesWithCommitsResponse,
  GitHubCommitItem,
  CommitDeepAnalysisResponse,
} from '@/lib/github-monitor-api'

function GithubIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  )
}

const RISK_BADGE: Record<string, { badge: string; border: string; bg: string; text: string }> = {
  CRITICAL: { badge: 'bg-[#e06c75]/20 text-[#e06c75] border-[#e06c75]/40', border: 'border-[#e06c75]/40', bg: 'bg-[#e06c75]/5', text: 'text-[#e06c75]' },
  HIGH:     { badge: 'bg-[#e5984a]/20 text-[#e5984a] border-[#e5984a]/40', border: 'border-[#e5984a]/40', bg: 'bg-[#e5984a]/5', text: 'text-[#e5984a]' },
  MEDIUM:   { badge: 'bg-[#e5c07b]/20 text-[#e5c07b] border-[#e5c07b]/40', border: 'border-[#e5c07b]/40', bg: 'bg-[#e5c07b]/5', text: 'text-[#e5c07b]' },
  LOW:      { badge: 'bg-[#98c379]/20 text-[#98c379] border-[#98c379]/40', border: 'border-[#98c379]/40', bg: 'bg-[#98c379]/5', text: 'text-[#98c379]' },
}

const CATEGORY_STYLES: Record<string, { label: string; badge: string; icon: string }> = {
  SECURITY:       { label: 'Security & Auth', badge: 'bg-[#e06c75]/15 text-[#e06c75] border-[#e06c75]/30', icon: '🛡️' },
  FEATURE:        { label: 'New Feature', badge: 'bg-[#98c379]/15 text-[#98c379] border-[#98c379]/30', icon: '✨' },
  BUG_FIX:        { label: 'Bug Fix', badge: 'bg-[#e5c07b]/15 text-[#e5c07b] border-[#e5c07b]/30', icon: '🐛' },
  INFRASTRUCTURE: { label: 'DevOps / Infra', badge: 'bg-[#c678dd]/15 text-[#c678dd] border-[#c678dd]/30', icon: '⚙️' },
  REFACTOR:       { label: 'Refactor / Clean', badge: 'bg-[#61afef]/15 text-[#61afef] border-[#61afef]/30', icon: '🔄' },
  TEST:           { label: 'Testing & QA', badge: 'bg-[#56b6c2]/15 text-[#56b6c2] border-[#56b6c2]/30', icon: '🧪' },
}

function parseLegacyWhatWasDone(text: string) {
  if (!text) return { lead: '', items: [] }
  const parts = text.split(/(?=\b\d+\)\s*)/g).map(s => s.trim()).filter(Boolean)
  if (parts.length > 1) {
    const lead = parts[0].replace(/\bSpecifically,\s*it introduces:\s*/i, '').replace(/:\s*$/, '').trim()
    const items = parts.slice(1).map(p => p.replace(/^\d+\)\s*/, '').trim())
    return { lead, items }
  }
  return { lead: text, items: [] }
}

export function GitHubMonitor() {
  // Connection state
  const [isConnected, setIsConnected] = useState<boolean | null>(null)
  const [userProfile, setUserProfile] = useState<GitHubUserProfile | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState('')

  // Repository Selection state
  const [repositories, setRepositories] = useState<GitHubRepository[]>([])
  const [reposLoading, setReposLoading] = useState(false)
  const [repoSearch, setRepoSearch] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'public' | 'private'>('all')
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepository | null>(null)
  const [manualRepoInput, setManualRepoInput] = useState('')

  // Branch & Commits state
  const [branchesData, setBranchesData] = useState<BranchesWithCommitsResponse | null>(null)
  const [activeBranch, setActiveBranch] = useState<string>('')
  const [loadingCommits, setLoadingCommits] = useState(false)

  // Selected Commit Deep AI Analysis state
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null)
  const [deepAnalysisMap, setDeepAnalysisMap] = useState<Record<string, CommitDeepAnalysisResponse>>({})
  const [loadingDeepAnalysis, setLoadingDeepAnalysis] = useState(false)
  const [expandedDiffFiles, setExpandedDiffFiles] = useState<Record<string, boolean>>({})
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null)
  const [activeDetailTab, setActiveDetailTab] = useState<'story' | 'diff' | 'devops'>('story')
  const [hasSystemToken, setHasSystemToken] = useState(false)

  // Check initial connection status on mount
  useEffect(() => {
    checkStatus()
  }, [])

  const checkStatus = async () => {
    try {
      const res = await getGitHubStatus()
      setIsConnected(res.connected)
      setUserProfile(res.user)
      if (res.has_system_token !== undefined) {
        setHasSystemToken(res.has_system_token)
      }
      if (res.connected) {
        loadRepositories()
      }
    } catch {
      setIsConnected(false)
    }
  }

  const loadRepositories = async (searchQuery?: string) => {
    setReposLoading(true)
    try {
      const repos = await fetchGitHubRepos(searchQuery)
      setRepositories(repos)
      // DO NOT auto-select repo: let user explicitly choose!
    } catch (err: any) {
      console.error('Failed to load GitHub repos:', err)
    } finally {
      setReposLoading(false)
    }
  }

  const handleConnectToken = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = tokenInput.trim()
    if (!trimmed) return
    setConnecting(true)
    setConnectError('')
    try {
      const res = await connectGitHubToken(trimmed)
      setIsConnected(true)
      setUserProfile(res.user)
      setTokenInput('')
      setRepositories([])
      setSelectedRepo(null)
      setBranchesData(null)
      setSelectedCommitSha(null)
      setDeepAnalysisMap({})
      setConnecting(false)
      loadRepositories()
    } catch (err: any) {
      setConnectError(err.message || 'Failed to connect GitHub token')
      setConnecting(false)
    }
  }

  const handleConnectEnvToken = async () => {
    setConnecting(true)
    setConnectError('')
    try {
      const res = await connectGitHubEnvToken()
      setIsConnected(true)
      setUserProfile(res.user)
      setTokenInput('')
      setRepositories([])
      setSelectedRepo(null)
      setBranchesData(null)
      setSelectedCommitSha(null)
      setDeepAnalysisMap({})
      setConnecting(false)
      loadRepositories()
    } catch (err: any) {
      setConnectError(err.message || 'Failed to connect using environment token')
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('Disconnect your GitHub account from GitHub Monitor?')) return
    try {
      await disconnectGitHub()
      setIsConnected(false)
      setUserProfile(null)
      setRepositories([])
      setSelectedRepo(null)
      setBranchesData(null)
      setSelectedCommitSha(null)
      setDeepAnalysisMap({})
      setTokenInput('')
    } catch (err: any) {
      console.error('Failed to disconnect GitHub:', err)
    }
  }

  const handleSelectRepo = async (repo: GitHubRepository) => {
    setSelectedRepo(repo)
    setLoadingCommits(true)
    setSelectedCommitSha(null)
    try {
      const data = await fetchBranchesWithCommits(repo.owner.login, repo.name)
      setBranchesData(data)
      const initialBranch = data.default_branch || data.branches[0]?.name || 'main'
      setActiveBranch(initialBranch)

      // Auto-select the first commit of the initial branch
      const branchObj = data.branches.find(b => b.name === initialBranch)
      if (branchObj && branchObj.commits.length > 0) {
        handleSelectCommit(repo.owner.login, repo.name, branchObj.commits[0].sha)
      }
    } catch (err: any) {
      console.error('Failed to load branches & commits:', err)
    } finally {
      setLoadingCommits(false)
    }
  }

  const handleManualRepoSelect = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = manualRepoInput.trim()
    if (!trimmed.includes('/')) {
      alert('Please enter a valid format: owner/repo (e.g. Shivrajambhore01/ai_devops_logs_agent)')
      return
    }
    const [owner, repoName] = trimmed.split('/')
    const dummyRepo: GitHubRepository = {
      id: Date.now(),
      name: repoName,
      full_name: trimmed,
      owner: { login: owner, avatar_url: '' },
      private: false,
      html_url: `https://github.com/${trimmed}`,
      default_branch: 'main',
      updated_at: new Date().toISOString(),
      language: 'Unknown',
      stargazers_count: 0,
      forks_count: 0,
      open_issues_count: 0,
    }
    handleSelectRepo(dummyRepo)
  }

  const handleSelectBranch = (branchName: string) => {
    setActiveBranch(branchName)
    const branchObj = branchesData?.branches.find(b => b.name === branchName)
    if (branchObj && branchObj.commits.length > 0 && selectedRepo) {
      handleSelectCommit(selectedRepo.owner.login, selectedRepo.name, branchObj.commits[0].sha)
    } else {
      setSelectedCommitSha(null)
    }
  }

  const handleSelectCommit = async (owner: string, repoName: string, commitSha: string) => {
    setSelectedCommitSha(commitSha)
    if (deepAnalysisMap[commitSha]) {
      return // Already cached
    }

    setLoadingDeepAnalysis(true)
    try {
      const deep = await fetchCommitDeepAnalysis(owner, repoName, commitSha)
      setDeepAnalysisMap(prev => ({ ...prev, [commitSha]: deep }))
    } catch (err: any) {
      console.error(`Failed to load deep commit analysis for ${commitSha}:`, err)
    } finally {
      setLoadingDeepAnalysis(false)
    }
  }

  const handleCopyCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd)
    setCopiedCmd(cmd)
    setTimeout(() => setCopiedCmd(null), 2000)
  }

  const toggleDiffFile = (filename: string) => {
    setExpandedDiffFiles(prev => ({ ...prev, [filename]: !prev[filename] }))
  }

  const filteredRepos = useMemo(() => {
    let list = repositories
    if (filterType === 'public') list = list.filter(r => !r.private)
    if (filterType === 'private') list = list.filter(r => r.private)
    if (!repoSearch.trim()) return list
    const q = repoSearch.toLowerCase()
    return list.filter(
      r => r.full_name.toLowerCase().includes(q) || (r.description && r.description.toLowerCase().includes(q))
    )
  }, [repositories, repoSearch, filterType])

  const currentBranchData = branchesData?.branches.find(b => b.name === activeBranch)
  const currentDeep = selectedCommitSha ? deepAnalysisMap[selectedCommitSha] : null

  return (
    <div className="flex flex-col h-full bg-[#0a0a14] text-foreground overflow-hidden">
      {/* ── Top Header Bar ── */}
      <div className="px-6 py-4 border-b border-[#2a2a3e] shrink-0 bg-[#0e0e1a] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl bg-gradient-to-br from-[#c678dd]/30 to-[#61afef]/20 border border-[#c678dd]/40 grid place-items-center text-[#c678dd]">
            <GithubIcon className="size-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              GitHub Monitor
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#c678dd]/15 text-[#c678dd] border border-[#c678dd]/30 font-semibold">
                Multi-Branch AI Intelligence
              </span>
            </h1>
            <p className="text-xs text-[#5c6370]">
              Automated code risk evaluation &amp; deep diff-based AI analysis across commits
            </p>
          </div>
        </div>

        {/* Right Header Status / Account Chip */}
        <div className="flex items-center gap-2">
          {isConnected && userProfile ? (
            <div className="flex items-center gap-2 rounded-lg border border-[#2a2a3e] bg-[#090912] px-3 py-1.5">
              {userProfile.avatar_url && (
                <img src={userProfile.avatar_url} alt={userProfile.login} className="size-5 rounded-full border border-[#2a2a3e]" />
              )}
              <span className="text-xs font-mono font-medium text-white">@{userProfile.login}</span>
              <span className="size-1.5 rounded-full bg-[#98c379]" />
              <button
                onClick={handleDisconnect}
                className="text-[10px] text-[#5c6370] hover:text-[#e06c75] font-mono ml-2 transition-colors"
                title="Disconnect GitHub"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-lg border border-[#e5c07b]/30 bg-[#e5c07b]/10 px-3 py-1.5 text-xs text-[#e5c07b]">
              <AlertTriangle className="size-3.5" />
              <span>GitHub Not Connected</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Main Workspace Body ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* ─────────────────────────────────────────────────────────────
            STAGE 1: NOT CONNECTED (Step-by-Step Onboarding Guide)
        ───────────────────────────────────────────────────────────── */}
        {!isConnected ? (
          <div className="flex-1 overflow-y-auto p-6 md:p-10 flex justify-center">
            <div className="w-full max-w-3xl space-y-6">
              <div className="p-6 rounded-2xl border border-[#2a2a3e] bg-[#0e0e1a] shadow-xl relative overflow-hidden">
                <div className="absolute -right-10 -top-10 size-48 rounded-full bg-[#61afef]/5 blur-3xl" />
                <div className="flex items-start gap-4">
                  <div className="size-12 rounded-xl bg-primary/10 border border-primary/30 grid place-items-center text-primary shrink-0">
                    <KeyRound className="size-6 text-[#61afef]" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">Connect Your GitHub Credentials</h2>
                    <p className="text-xs text-[#abb2bf] mt-1 leading-relaxed">
                      To enable real-time commit monitoring, actual code diff inspection, and multi-branch AI risk analysis,
                      connect your GitHub Personal Access Token (PAT).
                    </p>
                  </div>
                </div>

                {/* Step-by-Step Guide */}
                <div className="mt-6 pt-6 border-t border-[#2a2a3e] grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-xl border border-[#2a2a3e] bg-[#090912]/80 flex flex-col justify-between">
                    <div>
                      <div className="size-6 rounded-full bg-[#61afef]/20 text-[#61afef] text-xs font-mono font-bold grid place-items-center mb-2">1</div>
                      <p className="text-xs font-semibold text-white">Open Token Page</p>
                      <p className="text-[11px] text-[#5c6370] mt-1">Visit GitHub developer settings to create a new token.</p>
                    </div>
                    <a
                      href="https://github.com/settings/tokens/new?scopes=repo,read:user&description=AI-DevOps-Agent-Monitor"
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-mono text-[#61afef] hover:underline"
                    >
                      <span>1-Click Generate</span>
                      <ExternalLink className="size-3" />
                    </a>
                  </div>

                  <div className="p-3.5 rounded-xl border border-[#2a2a3e] bg-[#090912]/80">
                    <div className="size-6 rounded-full bg-[#61afef]/20 text-[#61afef] text-xs font-mono font-bold grid place-items-center mb-2">2</div>
                    <p className="text-xs font-semibold text-white">Select Scopes</p>
                    <p className="text-[11px] text-[#5c6370] mt-1">
                      Check <code className="text-[#98c379] font-mono">repo</code> (full repository access) and <code className="text-[#98c379] font-mono">read:user</code>.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-[#2a2a3e] bg-[#090912]/80">
                    <div className="size-6 rounded-full bg-[#61afef]/20 text-[#61afef] text-xs font-mono font-bold grid place-items-center mb-2">3</div>
                    <p className="text-xs font-semibold text-white">Generate Token</p>
                    <p className="text-[11px] text-[#5c6370] mt-1">Click &quot;Generate token&quot; at the bottom and copy your key.</p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-[#2a2a3e] bg-[#090912]/80">
                    <div className="size-6 rounded-full bg-[#61afef]/20 text-[#61afef] text-xs font-mono font-bold grid place-items-center mb-2">4</div>
                    <p className="text-xs font-semibold text-white">Paste &amp; Connect</p>
                    <p className="text-[11px] text-[#5c6370] mt-1">Paste your token below to start AI commit monitoring.</p>
                  </div>
                </div>

                {/* Pre-configured Token Quick Connect */}
                {hasSystemToken && (
                  <div className="mt-6 p-4 rounded-xl border border-[#61afef]/30 bg-[#61afef]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="size-9 rounded-lg bg-[#61afef]/20 text-[#61afef] grid place-items-center shrink-0">
                        <KeyRound className="size-4" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-white">Pre-configured Environment Token Detected</p>
                        <p className="text-[11px] text-[#abb2bf] mt-0.5">A valid GITHUB_TOKEN is found in your server .env configuration.</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleConnectEnvToken}
                      disabled={connecting}
                      className="px-4 py-2 rounded-xl bg-[#61afef] text-black font-semibold text-xs hover:bg-[#61afef]/90 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0 shadow-md shadow-[#61afef]/10"
                    >
                      {connecting ? <RefreshCw className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                      <span>1-Click Connect (.env)</span>
                    </button>
                  </div>
                )}

                {/* Token Input Form */}
                <form onSubmit={handleConnectToken} className="mt-6 pt-4 border-t border-[#2a2a3e] space-y-4">
                  {connectError && (
                    <div className="p-3.5 rounded-xl border border-[#e06c75]/40 bg-[#e06c75]/10 text-[#e06c75] text-xs space-y-1">
                      <div className="flex items-center gap-2 font-semibold">
                        <AlertTriangle className="size-4 shrink-0 text-[#e06c75]" />
                        <span>{connectError}</span>
                      </div>
                      <p className="text-[11px] text-[#e06c75]/80 pl-6 leading-relaxed">
                        If GitHub returned &ldquo;Bad credentials&rdquo;, verify there are no mistyped characters (e.g. digit <code className="font-mono bg-black/30 px-1 py-0.5 rounded">1</code> instead of letter <code className="font-mono bg-black/30 px-1 py-0.5 rounded">l</code> or <code className="font-mono bg-black/30 px-1 py-0.5 rounded">i</code>), or generate a new token with <code className="font-mono bg-black/30 px-1 py-0.5 rounded">repo</code> scope.
                      </p>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold font-mono text-white">
                        GitHub Personal Access Token (PAT)
                      </label>
                      {hasSystemToken && (
                        <button
                          type="button"
                          onClick={handleConnectEnvToken}
                          className="text-[11px] text-[#61afef] hover:underline flex items-center gap-1"
                        >
                          <Zap className="size-3" />
                          <span>Use token from .env</span>
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type={showToken ? 'text' : 'password'}
                        value={tokenInput}
                        onChange={e => setTokenInput(e.target.value)}
                        placeholder="ghp_... or github_pat_..."
                        className="w-full h-11 rounded-xl border border-[#2a2a3e] bg-[#090912] px-4 pr-11 font-mono text-xs text-white placeholder:text-[#5c6370] focus:border-[#61afef] focus:outline-none transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken(!showToken)}
                        className="absolute right-3.5 top-3 text-[#5c6370] hover:text-white"
                      >
                        {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <span className="text-[11px] text-[#5c6370] flex items-center gap-1.5">
                      <ShieldCheck className="size-3.5 text-[#98c379]" />
                      Token is securely verified and stored for your user session.
                    </span>
                    <button
                      type="submit"
                      disabled={connecting || !tokenInput.trim()}
                      className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#61afef] to-[#c678dd] text-black font-semibold text-xs hover:opacity-95 transition-opacity disabled:opacity-50 flex items-center gap-2"
                    >
                      {connecting ? (
                        <>
                          <RefreshCw className="size-3.5 animate-spin" />
                          <span>Verifying with GitHub…</span>
                        </>
                      ) : (
                        <>
                          <span>Verify &amp; Connect Repository Access</span>
                          <ArrowRight className="size-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        ) : !selectedRepo ? (
          /* ─────────────────────────────────────────────────────────────
              STAGE 2: REPOSITORY SELECTION (Pick A Repo First)
          ───────────────────────────────────────────────────────────── */
          <div className="flex-1 overflow-y-auto p-6 md:p-10">
            <div className="max-w-6xl mx-auto space-y-6">
              {/* Header Title Banner */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl border border-[#2a2a3e] bg-[#0e0e1a]">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <FolderGit2 className="size-5 text-[#61afef]" />
                    Select a Repository to Monitor
                  </h2>
                  <p className="text-xs text-[#abb2bf] mt-1">
                    Choose one of your GitHub repositories below. Our platform will inspect its branches,
                    retrieve the latest 5 commits, and generate real diff-based AI code reviews.
                  </p>
                </div>

                {/* Direct Manual Entry Form */}
                <form onSubmit={handleManualRepoSelect} className="flex items-center gap-2 shrink-0">
                  <input
                    type="text"
                    value={manualRepoInput}
                    onChange={e => setManualRepoInput(e.target.value)}
                    placeholder="owner/repo (e.g. org/project)"
                    className="h-9 px-3 rounded-lg border border-[#2a2a3e] bg-[#090912] font-mono text-xs text-white focus:outline-none focus:border-[#61afef] w-56"
                  />
                  <button
                    type="submit"
                    className="h-9 px-3.5 rounded-lg bg-[#61afef] text-black font-semibold text-xs hover:bg-[#61afef]/90 transition-colors"
                  >
                    Load Repo
                  </button>
                </form>
              </div>

              {/* Search & Filter Toolbar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="size-4 absolute left-3 top-2.5 text-[#5c6370]" />
                  <input
                    type="text"
                    value={repoSearch}
                    onChange={e => setRepoSearch(e.target.value)}
                    placeholder="Search repositories by name or description…"
                    className="w-full h-9 pl-9 pr-4 rounded-xl border border-[#2a2a3e] bg-[#0e0e1a] font-mono text-xs text-white placeholder:text-[#5c6370] focus:border-[#61afef] focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-1.5 bg-[#0e0e1a] p-1 rounded-xl border border-[#2a2a3e]">
                  {(['all', 'public', 'private'] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => setFilterType(type)}
                      className={`px-3 py-1 rounded-lg text-xs font-mono capitalize transition-all ${
                        filterType === type
                          ? 'bg-[#1e1e2e] text-white border border-[#61afef]/40 font-bold'
                          : 'text-[#5c6370] hover:text-white'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Repository Cards Grid */}
              {reposLoading ? (
                <div className="py-24 text-center">
                  <RefreshCw className="size-6 animate-spin mx-auto text-[#61afef] mb-2" />
                  <p className="text-xs text-[#5c6370] font-mono">Loading repositories from GitHub…</p>
                </div>
              ) : filteredRepos.length === 0 ? (
                <div className="py-20 text-center p-8 rounded-2xl border border-[#2a2a3e] bg-[#0e0e1a]">
                  <FolderGit2 className="size-10 mx-auto text-[#5c6370] mb-2" />
                  <h3 className="text-sm font-semibold text-white">No repositories found</h3>
                  <p className="text-xs text-[#5c6370] mt-1">Try adjusting your search query or connect a token with access.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredRepos.map(repo => (
                    <div
                      key={repo.id}
                      className="p-5 rounded-2xl border border-[#2a2a3e] bg-[#0e0e1a] hover:border-[#61afef]/50 transition-all flex flex-col justify-between group shadow-sm hover:shadow-md hover:shadow-[#61afef]/5"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h3 className="text-sm font-bold text-white font-mono truncate group-hover:text-[#61afef] transition-colors">
                            {repo.name}
                          </h3>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#1e1e2e] text-[#abb2bf] border border-[#2a2a3e] shrink-0 flex items-center gap-1">
                            {repo.private ? (
                              <>
                                <Lock className="size-3 text-[#e5984a]" />
                                <span>Private</span>
                              </>
                            ) : (
                              <>
                                <Globe className="size-3 text-[#98c379]" />
                                <span>Public</span>
                              </>
                            )}
                          </span>
                        </div>

                        <p className="text-xs text-[#abb2bf] line-clamp-2 min-h-[32px] mb-4">
                          {repo.description || 'No description provided for this repository.'}
                        </p>
                      </div>

                      <div className="pt-3 border-t border-[#2a2a3e]/60 space-y-3">
                        <div className="flex items-center gap-3 text-[11px] text-[#5c6370] font-mono flex-wrap">
                          <span className="text-[#98c379] font-medium">{repo.language}</span>
                          <span>·</span>
                          <span>★ {repo.stargazers_count}</span>
                          <span>·</span>
                          <span className="text-[#61afef]">{repo.default_branch}</span>
                        </div>

                        <button
                          onClick={() => handleSelectRepo(repo)}
                          className="w-full py-2 px-3 rounded-xl bg-[#1e1e2e] hover:bg-[#61afef] text-[#61afef] hover:text-black font-semibold font-mono text-xs transition-all flex items-center justify-center gap-1.5 border border-[#61afef]/30 group-hover:border-[#61afef]"
                        >
                          <span>Select &amp; Monitor Repository</span>
                          <ArrowRight className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ─────────────────────────────────────────────────────────────
              STAGE 3: 3-PANEL REPO WORKSPACE
              Panel 1: Branches List
              Panel 2: Commits List (click commit to inspect)
              Panel 3: Deep AI Code Diff Analysis (What was done, files, diff)
          ───────────────────────────────────────────────────────────── */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Repo Header & Back Switcher Bar */}
            <div className="px-6 py-3 border-b border-[#2a2a3e] bg-[#0e0e1a] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setSelectedRepo(null)}
                  className="px-2.5 py-1.5 rounded-lg border border-[#2a2a3e] bg-[#090912] text-xs font-mono text-[#61afef] hover:bg-[#61afef]/10 transition-colors flex items-center gap-1.5"
                  title="Return to repository selection"
                >
                  <ChevronLeft className="size-3.5" />
                  <span>Switch Repository</span>
                </button>

                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-white font-mono">{selectedRepo.full_name}</h2>
                  <a
                    href={selectedRepo.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#5c6370] hover:text-[#61afef]"
                    title="View on GitHub"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1e1e2e] text-[#98c379] border border-[#2a2a3e]">
                    {selectedRepo.language}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSelectRepo(selectedRepo)}
                  className="px-3 py-1.5 rounded-lg border border-[#2a2a3e] bg-[#090912] text-[#5c6370] hover:text-white font-mono text-xs flex items-center gap-1.5 transition-colors"
                  title="Refresh branch commits"
                >
                  <RefreshCw className="size-3.5" />
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            {/* 3-Column Split Layout */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* ── COLUMN 1: List of Branches (220px) ── */}
              <div className="w-56 shrink-0 border-r border-[#2a2a3e] bg-[#0a0a16] flex flex-col">
                <div className="p-3 border-b border-[#2a2a3e] bg-[#0e0e1a]/60">
                  <span className="text-xs font-mono font-bold uppercase text-white flex items-center gap-1.5">
                    <GitBranch className="size-4 text-[#61afef]" />
                    Branches ({branchesData?.branches.length || 0})
                  </span>
                  <p className="text-[10px] text-[#5c6370] mt-0.5 font-mono">Select branch</p>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1" style={{ scrollbarWidth: 'thin' }}>
                  {loadingCommits ? (
                    <div className="py-12 text-center text-xs text-[#5c6370] animate-pulse font-mono">
                      Loading…
                    </div>
                  ) : branchesData?.branches.map(b => {
                    const isActive = activeBranch === b.name

                    return (
                      <button
                        key={b.name}
                        onClick={() => handleSelectBranch(b.name)}
                        className={`w-full text-left px-3 py-2 rounded-xl font-mono text-xs transition-all flex flex-col gap-0.5 border ${
                          isActive
                            ? 'bg-[#61afef]/15 text-white border-[#61afef]/50 shadow-sm'
                            : 'text-[#abb2bf] hover:bg-[#12122a] border-transparent hover:border-[#2a2a3e]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-bold truncate flex items-center gap-1.5">
                            <span className="size-1.5 rounded-full bg-[#61afef] shrink-0" />
                            <span className="truncate">{b.name}</span>
                          </span>
                          {b.is_default && (
                            <span className="text-[9px] px-1 rounded bg-[#1e1e2e] text-[#61afef] border border-[#61afef]/30 font-semibold shrink-0">
                              default
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-[#5c6370] pl-3">
                          {b.commits.length} commits
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* ── COLUMN 2: Commits List for '{activeBranch}' (350px) ── */}
              <div className="w-80 shrink-0 border-r border-[#2a2a3e] bg-[#090912] flex flex-col">
                <div className="p-3 border-b border-[#2a2a3e] bg-[#0e0e1a]/60">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold uppercase text-white flex items-center gap-1.5">
                      <GitCommit className="size-4 text-[#61afef]" />
                      Commits on &lsquo;{activeBranch}&rsquo;
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1e1e2e] text-[#5c6370]">
                      {currentBranchData?.commits.length || 0}
                    </span>
                  </div>
                  <p className="text-[10px] text-[#5c6370] mt-0.5 font-mono">
                    Click any commit to view deep AI analysis
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-2" style={{ scrollbarWidth: 'thin' }}>
                  {loadingCommits ? (
                    <div className="py-12 text-center text-xs text-[#5c6370] animate-pulse font-mono">
                      Fetching commits…
                    </div>
                  ) : !currentBranchData || currentBranchData.commits.length === 0 ? (
                    <div className="p-6 text-center text-xs text-[#5c6370]">
                      No commits found on this branch.
                    </div>
                  ) : (
                    currentBranchData.commits.map(c => {
                      const isSelected = selectedCommitSha === c.sha
                      const cached = deepAnalysisMap[c.sha]
                      const riskLevel = cached?.analysis.risk_level || 'LOW'
                      const risk = RISK_BADGE[riskLevel] || RISK_BADGE.LOW

                      return (
                        <button
                          key={c.sha}
                          onClick={() => handleSelectCommit(selectedRepo.owner.login, selectedRepo.name, c.sha)}
                          className={`w-full text-left p-3 rounded-xl border transition-all flex flex-col gap-1.5 ${
                            isSelected
                              ? 'border-[#61afef] bg-[#61afef]/10 shadow-md shadow-[#61afef]/5 ring-1 ring-[#61afef]/50'
                              : 'border-[#2a2a3e] bg-[#0e0e1a]/90 hover:border-[#3e4451] hover:bg-[#12122a]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {c.author_avatar ? (
                                <img src={c.author_avatar} alt={c.author_name} className="size-5 rounded-full border border-[#2a2a3e] shrink-0" />
                              ) : (
                                <div className="size-5 rounded-full bg-[#1e1e2e] grid place-items-center text-[9px] font-mono font-bold text-white shrink-0">
                                  {c.author_name.slice(0, 2).toUpperCase()}
                                </div>
                              )}
                              <span className="text-xs font-mono font-bold text-white truncate max-w-[140px]">
                                {c.author_name}
                              </span>
                            </div>

                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#1e1e2e] text-[#61afef] shrink-0">
                              {c.short_sha}
                            </span>
                          </div>

                          <p className="text-xs font-mono text-white line-clamp-2 leading-snug">
                            {c.message}
                          </p>

                          <div className="flex items-center justify-between pt-1 border-t border-[#2a2a3e]/50 text-[10px] text-[#5c6370]">
                            <span>{c.date ? new Date(c.date).toLocaleDateString() : 'recent'}</span>
                            {cached ? (
                              <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold border ${risk.badge}`}>
                                {riskLevel}
                              </span>
                            ) : (
                              <span className="text-[9px] text-[#5c6370] font-mono">click to analyze</span>
                            )}
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>

              {/* ── COLUMN 3: Deep AI Commit Intelligence & Code Walkthrough (flex-1) ── */}
              <div className="flex-1 flex flex-col bg-[#0a0a14] overflow-hidden">
                {loadingDeepAnalysis ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                    <div className="relative size-16 mb-4">
                      <div className="absolute inset-0 rounded-full border-2 border-[#61afef]/20 animate-ping" />
                      <div className="size-16 rounded-full bg-[#0e0e1a] border border-[#61afef]/40 grid place-items-center text-2xl">
                        ⚡
                      </div>
                    </div>
                    <h3 className="text-sm font-bold text-white font-mono">Analyzing Actual Code Diff</h3>
                    <p className="text-xs text-[#5c6370] mt-1 max-w-sm font-mono">
                      Gemini AI is inspecting code patches, modified functions, and file changes for commit {selectedCommitSha?.slice(0, 7)}…
                    </p>
                  </div>
                ) : currentDeep ? (
                  <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    {/* Commit Header Banner */}
                    <div className="p-4 border-b border-[#2a2a3e] bg-[#0e0e1a] shrink-0">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1e1e2e] text-[#61afef] border border-[#61afef]/30 font-bold">
                              {currentDeep.short_sha}
                            </span>
                            <span className="text-xs font-mono text-[#abb2bf]">
                              by <strong className="text-white">{currentDeep.author_name}</strong>
                            </span>
                            <span className="text-[10px] text-[#5c6370]">
                              on {currentDeep.date ? new Date(currentDeep.date).toLocaleString() : 'recently'}
                            </span>
                            <a
                              href={currentDeep.html_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] font-mono text-[#61afef] hover:underline inline-flex items-center gap-1"
                            >
                              <span>GitHub</span>
                              <ExternalLink className="size-2.5" />
                            </a>
                          </div>

                          <h2 className="text-sm font-bold text-white font-mono leading-snug pt-1">
                            {currentDeep.message}
                          </h2>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-[10px] font-mono px-2.5 py-1 rounded-full font-bold border ${RISK_BADGE[currentDeep.analysis.risk_level]?.badge}`}>
                            {currentDeep.analysis.risk_level} RISK
                          </span>
                        </div>
                      </div>

                      {/* Stats row */}
                      <div className="mt-3 pt-2.5 border-t border-[#2a2a3e]/60 flex items-center gap-4 text-xs font-mono text-[#5c6370]">
                        <span>
                          Files changed: <strong className="text-white">{currentDeep.files.length}</strong>
                        </span>
                        <span>·</span>
                        <span className="text-[#98c379]">+{currentDeep.stats.additions || 0} additions</span>
                        <span>·</span>
                        <span className="text-[#e06c75]">-{currentDeep.stats.deletions || 0} deletions</span>
                      </div>
                    </div>

                    {/* Navigation Tab Bar for Details */}
                    <div className="flex items-center gap-1 border-b border-[#2a2a3e] bg-[#0c0c18] px-4 pt-1 shrink-0">
                      <button
                        onClick={() => setActiveDetailTab('story')}
                        className={`pb-2.5 px-3 font-mono text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                          activeDetailTab === 'story'
                            ? 'border-[#61afef] text-[#61afef]'
                            : 'border-transparent text-[#5c6370] hover:text-white'
                        }`}
                      >
                        <span>💡</span>
                        <span>AI Story &amp; Changes</span>
                      </button>
                      <button
                        onClick={() => setActiveDetailTab('diff')}
                        className={`pb-2.5 px-3 font-mono text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                          activeDetailTab === 'diff'
                            ? 'border-[#61afef] text-[#61afef]'
                            : 'border-transparent text-[#5c6370] hover:text-white'
                        }`}
                      >
                        <FileCode2 className="size-3.5" />
                        <span>Changed Files &amp; Diffs ({currentDeep.files.length})</span>
                      </button>
                      <button
                        onClick={() => setActiveDetailTab('devops')}
                        className={`pb-2.5 px-3 font-mono text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                          activeDetailTab === 'devops'
                            ? 'border-[#61afef] text-[#61afef]'
                            : 'border-transparent text-[#5c6370] hover:text-white'
                        }`}
                      >
                        <span>⚙️</span>
                        <span>DevOps &amp; Testing</span>
                      </button>
                    </div>

                    {/* Scrollable Tab Content */}
                    <div className="flex-1 overflow-y-auto p-5 space-y-5" style={{ scrollbarWidth: 'thin' }}>
                      {activeDetailTab === 'story' && (
                        <>
                          {/* 1. Plain-English Executive Summary */}
                          {(() => {
                            const legacy = parseLegacyWhatWasDone(currentDeep.analysis.what_was_done)
                            const summaryText = currentDeep.analysis.summary || legacy.lead || currentDeep.analysis.what_was_done

                            return (
                              <div className="p-5 rounded-2xl border border-[#61afef]/30 bg-gradient-to-br from-[#61afef]/10 via-[#0e0e1a] to-[#0e0e1a] space-y-3 shadow-lg shadow-[#61afef]/5">
                                <div className="flex items-center justify-between">
                                  <h3 className="text-xs font-bold uppercase font-mono tracking-wider text-[#61afef] flex items-center gap-2">
                                    <span>✨</span> Plain-English Executive Summary
                                  </h3>
                                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#61afef]/15 text-[#61afef] border border-[#61afef]/30">
                                    Human Understandable
                                  </span>
                                </div>

                                <p className="text-xs md:text-sm text-white leading-relaxed font-sans font-medium">
                                  {summaryText}
                                </p>

                                {/* Key Takeaways Bullets */}
                                {currentDeep.analysis.key_takeaways && currentDeep.analysis.key_takeaways.length > 0 && (
                                  <div className="pt-3 border-t border-[#2a2a3e]/80 space-y-2">
                                    <span className="text-[11px] font-bold text-[#abb2bf] uppercase tracking-wider block font-mono">
                                      Key Highlights at a Glance:
                                    </span>
                                    <div className="grid grid-cols-1 gap-1.5">
                                      {currentDeep.analysis.key_takeaways.map((t, tidx) => (
                                        <div key={tidx} className="flex items-start gap-2.5 text-xs text-[#abb2bf] bg-[#090912]/80 p-2.5 rounded-xl border border-[#2a2a3e]/60">
                                          <span className="text-[#98c379] font-bold shrink-0">✓</span>
                                          <span className="text-white font-medium">{t}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })()}

                          {/* 2. Structured What Changed & Why Cards */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h3 className="text-xs font-bold uppercase font-mono tracking-wider text-white flex items-center gap-2">
                                <span>📋</span> Detailed Changes Breakdown
                              </h3>
                              <span className="text-[10px] text-[#5c6370] font-mono">
                                What was changed &amp; why
                              </span>
                            </div>

                            {/* If changes_breakdown is present */}
                            {currentDeep.analysis.changes_breakdown && currentDeep.analysis.changes_breakdown.length > 0 ? (
                              <div className="space-y-3">
                                {currentDeep.analysis.changes_breakdown.map((change, cidx) => {
                                  const category = CATEGORY_STYLES[change.category] || CATEGORY_STYLES.REFACTOR

                                  return (
                                    <div
                                      key={cidx}
                                      className="p-4 rounded-2xl border border-[#2a2a3e] bg-[#0e0e1a] space-y-3 hover:border-[#61afef]/40 transition-colors"
                                    >
                                      <div className="flex items-start justify-between gap-3 flex-wrap">
                                        <div className="flex items-center gap-2">
                                          <span className="text-lg">{category.icon}</span>
                                          <h4 className="text-xs font-bold text-white font-mono">{change.title}</h4>
                                        </div>
                                        <span className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full font-bold border ${category.badge}`}>
                                          {category.label}
                                        </span>
                                      </div>

                                      <p className="text-xs text-[#abb2bf] leading-relaxed">
                                        {change.user_explanation}
                                      </p>

                                      {/* Before vs After comparison */}
                                      {change.before_and_after && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 text-xs">
                                          <div className="p-3 rounded-xl bg-[#e06c75]/5 border border-[#e06c75]/25 text-[#abb2bf]">
                                            <span className="text-[10px] uppercase font-bold text-[#e06c75] flex items-center gap-1 mb-1">
                                              <span>🔴</span> Before this change
                                            </span>
                                            <span className="leading-snug block">{change.before_and_after.before}</span>
                                          </div>
                                          <div className="p-3 rounded-xl bg-[#98c379]/5 border border-[#98c379]/25 text-[#abb2bf]">
                                            <span className="text-[10px] uppercase font-bold text-[#98c379] flex items-center gap-1 mb-1">
                                              <span>🟢</span> With this change
                                            </span>
                                            <span className="leading-snug block text-white">{change.before_and_after.after}</span>
                                          </div>
                                        </div>
                                      )}

                                      {/* Under-the-hood code location */}
                                      {change.technical_detail && (
                                        <div className="text-[11px] font-mono text-[#5c6370] pt-1 flex items-center gap-2 border-t border-[#2a2a3e]/50">
                                          <span className="text-[#61afef] font-semibold shrink-0">Code modified:</span>
                                          <span className="text-[#abb2bf] truncate">{change.technical_detail}</span>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            ) : (() => {
                              // Legacy items fallback
                              const legacy = parseLegacyWhatWasDone(currentDeep.analysis.what_was_done)
                              if (legacy.items.length > 0) {
                                return (
                                  <div className="space-y-2.5">
                                    {legacy.items.map((item, idx) => {
                                      const isSec = item.toLowerCase().includes('security') || item.toLowerCase().includes('auth') || item.toLowerCase().includes('hash') || item.toLowerCase().includes('forbidden')
                                      const isDocker = item.toLowerCase().includes('docker') || item.toLowerCase().includes('env')
                                      const isTest = item.toLowerCase().includes('test') || item.toLowerCase().includes('script')
                                      const cat = isSec ? CATEGORY_STYLES.SECURITY : isDocker ? CATEGORY_STYLES.INFRASTRUCTURE : isTest ? CATEGORY_STYLES.TEST : CATEGORY_STYLES.FEATURE

                                      return (
                                        <div key={idx} className="p-3.5 rounded-xl border border-[#2a2a3e] bg-[#0e0e1a] space-y-1.5">
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="text-xs font-bold text-white font-mono flex items-center gap-1.5">
                                              <span>{cat.icon}</span>
                                              <span>Item #{idx + 1}</span>
                                            </span>
                                            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${cat.badge}`}>
                                              {cat.label}
                                            </span>
                                          </div>
                                          <p className="text-xs text-[#abb2bf] font-mono leading-relaxed">
                                            {item}
                                          </p>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )
                              }
                              return (
                                <div className="p-4 rounded-xl border border-[#2a2a3e] bg-[#0e0e1a] text-xs font-mono text-[#abb2bf] leading-relaxed">
                                  {currentDeep.analysis.what_was_done}
                                </div>
                              )
                            })()}
                          </div>

                          {/* 3. Risk & Security Card */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-4 rounded-2xl border border-[#2a2a3e] bg-[#0e0e1a] space-y-2">
                              <h3 className="text-xs font-bold uppercase font-mono tracking-wider text-[#e5c07b] flex items-center gap-2">
                                <AlertTriangle className="size-4 text-[#e5c07b]" />
                                Breaking Changes &amp; Security
                              </h3>
                              <div className="space-y-2 text-xs font-mono">
                                <div className="p-3 rounded-xl bg-[#090912] border border-[#2a2a3e]/60">
                                  <span className="text-[10px] uppercase font-bold text-[#5c6370] block mb-1">Breaking Changes</span>
                                  <p className="text-white">{currentDeep.analysis.breaking_changes || 'None detected'}</p>
                                </div>
                                <div className="p-3 rounded-xl bg-[#090912] border border-[#2a2a3e]/60">
                                  <span className="text-[10px] uppercase font-bold text-[#5c6370] block mb-1">Security Findings</span>
                                  <p className="text-white">{currentDeep.analysis.security_analysis || 'No security regressions observed.'}</p>
                                </div>
                              </div>
                            </div>

                            <div className="p-4 rounded-2xl border border-[#2a2a3e] bg-[#0e0e1a] space-y-2">
                              <h3 className="text-xs font-bold uppercase font-mono tracking-wider text-[#98c379] flex items-center gap-2">
                                <ShieldCheck className="size-4 text-[#98c379]" />
                                Risk Rating Rationale
                              </h3>
                              <div className="p-3 rounded-xl bg-[#090912] border border-[#2a2a3e]/60 text-xs font-mono space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${RISK_BADGE[currentDeep.analysis.risk_level]?.badge}`}>
                                    {currentDeep.analysis.risk_level} RISK
                                  </span>
                                </div>
                                <p className="text-[#abb2bf] leading-relaxed">
                                  {currentDeep.analysis.risk_justification || 'Standard code modification without critical security or operational regressions.'}
                                </p>
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      {activeDetailTab === 'diff' && (
                        /* Tab 2: Changed Files & Diffs */
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-xs font-bold uppercase font-mono tracking-wider text-white flex items-center gap-2">
                              <FileCode2 className="size-4 text-[#98c379]" />
                              Changed Files ({currentDeep.files.length})
                            </h3>
                            <span className="text-[11px] font-mono text-[#5c6370]">
                              Click any file to view code diff patch
                            </span>
                          </div>

                          <div className="space-y-2">
                            {currentDeep.files.map(file => {
                              const isExpanded = !!expandedDiffFiles[file.filename]

                              return (
                                <div
                                  key={file.filename}
                                  className="rounded-xl border border-[#2a2a3e] bg-[#090912] overflow-hidden"
                                >
                                  <div
                                    onClick={() => toggleDiffFile(file.filename)}
                                    className="p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-[#12122a] transition-colors"
                                  >
                                    <div className="flex items-center gap-2 font-mono text-xs truncate">
                                      <span className="size-1.5 rounded-full bg-[#61afef]" />
                                      <span className="text-white font-semibold truncate">{file.filename}</span>
                                      <span className="text-[10px] px-1.5 rounded bg-[#1e1e2e] text-[#abb2bf]">
                                        {file.status}
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-2 font-mono text-[11px] shrink-0">
                                      <span className="text-[#98c379]">+{file.additions}</span>
                                      <span className="text-[#e06c75]">-{file.deletions}</span>
                                      {file.patch && (
                                        <span className="text-[#5c6370] pl-1">
                                          {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Patch Diff Box */}
                                  {isExpanded && file.patch && (
                                    <div className="border-t border-[#2a2a3e] p-3 bg-black/80 font-mono text-[11px] overflow-x-auto max-h-96" style={{ scrollbarWidth: 'thin' }}>
                                      <pre className="space-y-0.5">
                                        {file.patch.split('\n').map((line, li) => {
                                          const isAdd = line.startsWith('+') && !line.startsWith('+++')
                                          const isDel = line.startsWith('-') && !line.startsWith('---')
                                          const isHunk = line.startsWith('@@')

                                          const lineClass = isAdd
                                            ? 'bg-[#98c379]/15 text-[#98c379]'
                                            : isDel
                                            ? 'bg-[#e06c75]/15 text-[#e06c75]'
                                            : isHunk
                                            ? 'text-[#61afef] font-bold'
                                            : 'text-[#7f848e]'

                                          return (
                                            <div key={li} className={`px-2 py-0.2 rounded-sm ${lineClass}`}>
                                              {line}
                                            </div>
                                          )
                                        })}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {activeDetailTab === 'devops' && (
                        /* Tab 3: DevOps & Testing */
                        <div className="space-y-5">
                          {/* DevOps & Infrastructure Impact */}
                          <div className="p-5 rounded-2xl border border-[#2a2a3e] bg-[#0e0e1a] space-y-3">
                            <h3 className="text-xs font-bold uppercase font-mono tracking-wider text-[#c678dd] flex items-center gap-2">
                              <span>⚙️</span> DevOps &amp; Infrastructure Impact
                            </h3>
                            <ul className="space-y-2 text-xs font-mono">
                              {currentDeep.analysis.devops_impact.map((d, di) => (
                                <li key={di} className="p-3 rounded-xl bg-[#090912] border border-[#2a2a3e]/60 flex items-start gap-2 text-white">
                                  <span className="text-[#c678dd] font-bold">▸</span>
                                  <span>{d}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Recommended Verification Tests */}
                          <div className="p-5 rounded-2xl border border-[#2a2a3e] bg-[#0e0e1a] space-y-3">
                            <h3 className="text-xs font-bold uppercase font-mono tracking-wider text-[#98c379] flex items-center gap-2">
                              <Check className="size-4 text-[#98c379]" />
                              Recommended Verification &amp; Testing Commands
                            </h3>
                            <div className="space-y-2">
                              {currentDeep.analysis.recommended_tests.map((cmd, ci) => (
                                <div
                                  key={ci}
                                  className="p-3 rounded-xl bg-[#090912] border border-[#2a2a3e]/60 flex items-center justify-between gap-3"
                                >
                                  <code className="text-xs font-mono text-[#98c379] flex-1 break-all">
                                    {cmd}
                                  </code>
                                  <button
                                    onClick={() => handleCopyCommand(cmd)}
                                    className="px-2.5 py-1 rounded bg-[#1e1e2e] hover:bg-[#61afef]/20 text-[#61afef] text-[10px] font-mono flex items-center gap-1 shrink-0 transition-colors"
                                  >
                                    {copiedCmd === cmd ? <Check className="size-3 text-[#98c379]" /> : <Copy className="size-3" />}
                                    <span>{copiedCmd === cmd ? 'Copied' : 'Copy'}</span>
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                    <div className="size-14 rounded-2xl bg-[#0e0e1a] border border-[#2a2a3e] grid place-items-center text-2xl mb-3">
                      👈
                    </div>
                    <h3 className="text-sm font-bold text-white font-mono">Select a Commit to Analyze</h3>
                    <p className="text-xs text-[#5c6370] mt-1 max-w-sm font-mono">
                      Click any commit from the middle column to inspect its full code diff and generate an in-depth AI breakdown.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
