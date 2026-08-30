'use client'
import { useState } from 'react'
import { useDockerAutoConnect, ConnectedContainer } from '@/hooks/useDockerAutoConnect'
import { useDockerErrorStore } from '@/store/dockerErrorStore'
import { ContainerLogPanel } from '@/components/docker/ContainerLogPanel'
import { ErrorIntelligencePanel } from '@/components/docker/ErrorIntelligencePanel'
import { connectContainer } from '@/lib/docker-api'

export default function DockerMonitorPage() {
  const { containers, allContainers, isConnecting, error } = useDockerAutoConnect()
  const { unseenCount } = useDockerErrorStore()

  // For multi-container: track which container is selected in the left panel
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null)
  const [extraSessions, setExtraSessions] = useState<ConnectedContainer[]>([])

  // All connected = auto-connected + manually added
  const allConnected = [...containers, ...extraSessions]

  // Selected container for the focused view
  const selected =
    allConnected.find((c) => c.id === selectedContainerId) ?? allConnected[0] ?? null

  // Handle connecting a stopped container manually
  const handleConnect = async (containerId: string) => {
    try {
      const meta = allContainers.find((c) => c.id === containerId)
      if (!meta) return
      const res = await connectContainer(containerId)
      const newSession: ConnectedContainer = { ...meta, sessionId: res.session_id }
      setExtraSessions((prev) => [...prev, newSession])
      setSelectedContainerId(containerId)
    } catch (e: any) {
      console.error('Connect failed:', e.message)
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── LEFT: Container selector sidebar (if >1 container) + log stream ── */}
      <div className="flex-1 flex flex-col gap-0 min-w-0 overflow-hidden">

        {/* Page Header */}
        <div className="px-6 py-4 border-b border-[#2a2a3e] shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                <span className="text-2xl">🐳</span>
                Docker Monitor
              </h1>
              <p className="text-xs text-[#5c6370] mt-0.5">
                {isConnecting
                  ? 'Connecting to Docker daemon…'
                  : error
                  ? `⚠ ${error}`
                  : allConnected.length === 0
                  ? 'No running containers found'
                  : `${allConnected.length} container${allConnected.length !== 1 ? 's' : ''} streaming live`}
              </p>
            </div>
            {/* Error badge */}
            {unseenCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#e06c75]/10 border border-[#e06c75]/30 animate-pulse">
                <div className="w-1.5 h-1.5 rounded-full bg-[#e06c75]" />
                <span className="text-xs font-bold text-[#e06c75]">{unseenCount} new error{unseenCount !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>

          {/* Container selector tabs — only shown when >1 running container */}
          {allConnected.length > 1 && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {allConnected.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedContainerId(c.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono transition-all border ${
                    (selected?.id === c.id)
                      ? 'bg-[#1e1e2e] border-[#61afef] text-white'
                      : 'border-[#2a2a3e] text-[#5c6370] hover:text-white hover:border-[#3a3a4e]'
                  }`}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-[#98c379]" />
                  <span>{c.name}</span>
                  <span className="text-[9px] text-[#5c6370]">{c.image.split(':')[0]}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main content area */}
        <div className="flex-1 overflow-y-auto p-6">
          {isConnecting ? (
            <ConnectingState />
          ) : error && allConnected.length === 0 ? (
            <ErrorState error={error} />
          ) : allConnected.length === 0 ? (
            <EmptyState allContainers={allContainers} onConnect={handleConnect} />
          ) : selected ? (
            <div className="space-y-4">
              {/* Show selected container log panel */}
              <ContainerLogPanel key={selected.sessionId} container={selected} />

              {/* If only 1 container, show all other stopped containers for manual connect */}
              {allConnected.length === 1 && allContainers.length > 1 && (
                <StoppedContainerList
                  allContainers={allContainers}
                  connectedIds={allConnected.map((c) => c.id)}
                  onConnect={handleConnect}
                />
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── RIGHT: Error Intelligence Panel (fixed 400px) ── */}
      <div className="w-[400px] shrink-0 border-l border-[#2a2a3e] flex flex-col">
        <ErrorIntelligencePanel />
      </div>
    </div>
  )
}


// ── Loading state ──────────────────────────────────────────────────────────────

function ConnectingState() {
  return (
    <div className="space-y-4">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="h-[280px] rounded-xl border border-[#2a2a3e] bg-[#0a0a16] animate-pulse flex items-center justify-center"
        >
          <div className="text-[#3d3d52] text-sm flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#61afef] animate-bounce" />
            Auto-connecting to Docker…
          </div>
        </div>
      ))}
    </div>
  )
}


// ── Error state ────────────────────────────────────────────────────────────────

function ErrorState({ error }: { error: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-5xl mb-4">🐳</div>
      <p className="text-white font-bold text-lg">Docker daemon not reachable</p>
      <p className="text-[#5c6370] text-sm mt-2 max-w-sm">{error}</p>
      <div className="mt-6 p-4 bg-[#0e0e1a] rounded-xl border border-[#2a2a3e] text-left max-w-sm">
        <p className="text-[#e5c07b] text-xs font-bold mb-2">To fix this:</p>
        <code className="text-xs text-[#98c379] block font-mono">
          # Windows: Start Docker Desktop<br />
          # Linux/Mac: sudo systemctl start docker
        </code>
      </div>
    </div>
  )
}


// ── Empty state — no running containers ───────────────────────────────────────

function EmptyState({
  allContainers,
  onConnect,
}: {
  allContainers: { id: string; name: string; status: string; image: string }[]
  onConnect: (id: string) => void
}) {
  const stopped = allContainers.filter((c) => c.status !== 'running')

  return (
    <div className="text-center py-12">
      <div className="text-5xl mb-4">📦</div>
      <p className="text-white font-bold">No running containers</p>
      <p className="text-[#5c6370] text-sm mt-1 mb-6">
        Start a container to begin monitoring logs.
      </p>

      {stopped.length > 0 && (
        <div className="max-w-md mx-auto">
          <p className="text-xs text-[#5c6370] mb-3 font-semibold uppercase tracking-wider">
            Stopped containers
          </p>
          <div className="space-y-2">
            {stopped.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between px-4 py-3 rounded-lg border border-[#2a2a3e] bg-[#0a0a16]"
              >
                <div className="text-left">
                  <p className="text-sm text-white font-mono">{c.name}</p>
                  <p className="text-xs text-[#5c6370]">{c.image}</p>
                </div>
                <span className="text-xs text-[#e06c75] bg-[#e06c75]/10 px-2 py-1 rounded font-mono">
                  {c.status}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-[#5c6370] mt-4">
            Run <code className="text-[#98c379]">docker start &lt;name&gt;</code> to start a container.
          </p>
        </div>
      )}
    </div>
  )
}


// ── Stopped container list (shown alongside active panel) ─────────────────────

function StoppedContainerList({
  allContainers,
  connectedIds,
  onConnect,
}: {
  allContainers: { id: string; name: string; status: string; image: string; ports: string }[]
  connectedIds: string[]
  onConnect: (id: string) => void
}) {
  const others = allContainers.filter((c) => !connectedIds.includes(c.id))
  if (others.length === 0) return null

  return (
    <div>
      <p className="text-xs text-[#5c6370] font-semibold uppercase tracking-wider mb-2 px-1">
        Other containers
      </p>
      <div className="grid grid-cols-1 gap-2">
        {others.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between px-4 py-3 rounded-xl border border-[#2a2a3e] bg-[#0a0a16]"
          >
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${c.status === 'running' ? 'bg-[#98c379]' : 'bg-[#e06c75]'}`} />
              <div>
                <p className="text-sm font-mono text-white">{c.name}</p>
                <p className="text-xs text-[#5c6370]">{c.image}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                c.status === 'running' ? 'text-[#98c379] bg-[#98c379]/10' : 'text-[#e06c75] bg-[#e06c75]/10'
              }`}>
                {c.status}
              </span>
              {c.status === 'running' && (
                <button
                  onClick={() => onConnect(c.id)}
                  className="text-xs px-3 py-1 rounded-lg border border-[#61afef]/40 text-[#61afef] hover:bg-[#61afef]/10 transition-all"
                >
                  Connect
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
