'use client'
import { useState, useEffect } from 'react'
import { useDockerAutoConnect, ConnectedContainer } from '@/hooks/useDockerAutoConnect'
import { useDockerErrorStore } from '@/store/dockerErrorStore'
import { ContainerLogPanel } from '@/components/docker/ContainerLogPanel'
import { ErrorIntelligencePanel } from '@/components/docker/ErrorIntelligencePanel'
import { connectContainer, fetchImages, fetchImageDetail, DockerImage } from '@/lib/docker-api'

export default function DockerMonitorPage() {
  const { containers, allContainers, isConnecting, error } = useDockerAutoConnect()
  const { unseenCount } = useDockerErrorStore()

  // Navigation tab: 'containers' vs 'images'
  const [activeTab, setActiveTab] = useState<'containers' | 'images'>('containers')

  // Images state
  const [images, setImages] = useState<DockerImage[]>([])
  const [imagesLoading, setImagesLoading] = useState(false)
  const [inspectImageId, setInspectImageId] = useState<string | null>(null)
  const [imageDetail, setImageDetail] = useState<Record<string, any> | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Multi-container focus selection
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null)
  const [extraSessions, setExtraSessions] = useState<ConnectedContainer[]>([])

  const allConnected = [...containers, ...extraSessions]
  const selected = allConnected.find((c) => c.id === selectedContainerId) ?? allConnected[0] ?? null

  // Fetch cached images when switching to images tab
  useEffect(() => {
    if (activeTab === 'images' && images.length === 0) {
      setImagesLoading(true)
      fetchImages()
        .then((data) => setImages(data))
        .catch((err) => console.error('Failed to load images:', err))
        .finally(() => setImagesLoading(false))
    }
  }, [activeTab, images.length])

  // Handle on-demand image inspection
  const handleInspectImage = async (imageId: string) => {
    setInspectImageId(imageId)
    setDetailLoading(true)
    try {
      const detail = await fetchImageDetail(imageId)
      setImageDetail(detail)
    } catch (err) {
      console.error('Failed to inspect image:', err)
      setImageDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

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
    <div className="flex h-full overflow-hidden bg-background text-foreground">
      {/* ── LEFT: Main Workspace (Containers or Images) ── */}
      <div className="flex-1 flex flex-col gap-0 min-w-0 overflow-hidden">

        {/* Page Header */}
        <div className="px-6 py-4 border-b border-border shrink-0 bg-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div>
                <h1 className="text-xl font-bold text-foreground tracking-tight flex items-center gap-2">
                  <span className="text-2xl">🐳</span>
                  Docker Monitor
                </h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isConnecting
                    ? 'Connecting to Docker discovery…'
                    : error
                    ? `⚠ ${error}`
                    : `${allConnected.length} container${allConnected.length !== 1 ? 's' : ''} live · ${images.length > 0 ? images.length : allContainers.length} images cached`}
                </p>
              </div>

              {/* View Switcher: Containers vs Images */}
              <div className="flex items-center rounded-lg border border-border bg-muted/60 p-1">
                <button
                  onClick={() => setActiveTab('containers')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                    activeTab === 'containers'
                      ? 'bg-card text-foreground border border-border shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Containers ({allConnected.length})
                </button>
                <button
                  onClick={() => setActiveTab('images')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                    activeTab === 'images'
                      ? 'bg-card text-foreground border border-border shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Images ({images.length > 0 ? images.length : '…'})
                </button>
              </div>
            </div>

            {/* Error badge */}
            {unseenCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 animate-pulse">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                <span className="text-xs font-bold text-red-500">{unseenCount} new error{unseenCount !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>

          {/* Container selector tabs — shown in Containers view when >1 container */}
          {activeTab === 'containers' && allConnected.length > 1 && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {allConnected.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedContainerId(c.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono transition-all border ${
                    (selected?.id === c.id)
                      ? 'bg-primary/10 border-primary text-primary font-bold shadow-xs'
                      : 'border-border bg-card/60 text-muted-foreground hover:text-foreground hover:border-border'
                  }`}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>{c.name}</span>
                  <span className="text-[9px] text-muted-foreground">{c.image.split(':')[0]}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main content area */}
        <div className="flex-1 overflow-y-auto p-6 bg-background/50">
          {activeTab === 'images' ? (
            <ImagesView
              images={images}
              loading={imagesLoading}
              onInspect={handleInspectImage}
            />
          ) : isConnecting ? (
            <ConnectingState />
          ) : error && allConnected.length === 0 ? (
            <ErrorState error={error} />
          ) : allConnected.length === 0 ? (
            <EmptyState allContainers={allContainers} onConnect={handleConnect} />
          ) : selected ? (
            <div className="space-y-4">
              <ContainerLogPanel key={selected.sessionId} container={selected} />

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
      <div className="w-[400px] shrink-0 border-l border-border flex flex-col bg-card">
        <ErrorIntelligencePanel />
      </div>

      {/* ── On-Demand Image Inspection Modal / Drawer ── */}
      {inspectImageId && (
        <ImageInspectModal
          imageId={inspectImageId}
          detail={imageDetail}
          loading={detailLoading}
          onClose={() => { setInspectImageId(null); setImageDetail(null) }}
        />
      )}
    </div>
  )
}


// ── Images Explorer Component ──────────────────────────────────────────────────

function ImagesView({
  images,
  loading,
  onInspect,
}: {
  images: DockerImage[]
  loading: boolean
  onInspect: (id: string) => void
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <div className="w-2 h-2 rounded-full bg-primary animate-bounce mr-2" />
        <span className="text-xs">Loading cached Docker images…</span>
      </div>
    )
  }

  if (images.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-2">📦</div>
        <p className="text-sm font-semibold text-foreground">No local images found</p>
        <p className="text-xs text-muted-foreground mt-1">Docker daemon image cache is currently empty.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Local Image Inventory ({images.length})
        </span>
        <span className="text-[10px] text-muted-foreground">Cached from Docker daemon</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {images.map((img) => (
          <div
            key={img.id}
            className="p-4 rounded-xl border border-border bg-card hover:border-primary/40 transition-all flex flex-col justify-between shadow-xs hover:shadow-md"
          >
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-mono font-bold text-foreground truncate max-w-[240px]">
                  {img.repository}:{img.tag}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                  {img.size_mb} MB
                </span>
              </div>
              <p className="text-[11px] font-mono text-muted-foreground">ID: {img.id}</p>
            </div>

            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
              <span className="text-[10px] text-muted-foreground">
                Used by: <strong className="text-foreground">{img.containers_using}</strong> container{img.containers_using !== 1 ? 's' : ''}
              </span>
              <button
                onClick={() => onInspect(img.id)}
                className="text-xs font-mono text-primary hover:text-primary/80 px-2.5 py-1 rounded bg-muted/60 border border-border hover:border-primary transition-all font-semibold"
              >
                Inspect ↗
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}


// ── Image Inspection Modal ─────────────────────────────────────────────────────

function ImageInspectModal({
  imageId,
  detail,
  loading,
  onClose,
}: {
  imageId: string
  detail: Record<string, any> | null
  loading: boolean
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between border-b border-border pb-3 mb-4 shrink-0">
          <div>
            <h3 className="text-sm font-bold text-foreground font-mono flex items-center gap-2">
              <span>📦 Image Inspect:</span>
              <span className="text-primary">{imageId}</span>
            </h3>
            <p className="text-[10px] text-muted-foreground">On-demand metadata inspected via Docker SDK</p>
          </div>
          <button
            onClick={onClose}
            className="text-xs font-mono text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted"
          >
            ✕ CLOSE
          </button>
        </div>

        <div className="flex-1 overflow-y-auto font-mono text-[11px]">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce mr-2" />
              Inspecting image attributes…
            </div>
          ) : detail ? (
            <pre className="text-[11px] text-foreground bg-muted/60 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap leading-5 border border-border">
              {JSON.stringify(detail, null, 2)}
            </pre>
          ) : (
            <p className="text-xs text-destructive text-center py-10">Failed to load inspect data.</p>
          )}
        </div>
      </div>
    </div>
  )
}


// ── Loading & Error States ─────────────────────────────────────────────────────

function ConnectingState() {
  return (
    <div className="space-y-4">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="h-[280px] rounded-xl border border-border bg-card animate-pulse flex items-center justify-center"
        >
          <div className="text-muted-foreground text-sm flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary animate-bounce" />
            Connecting to Docker Discovery Cache…
          </div>
        </div>
      ))}
    </div>
  )
}

function ErrorState({ error }: { error: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-5xl mb-4">🐳</div>
      <p className="text-foreground font-bold text-lg">Docker daemon not reachable</p>
      <p className="text-muted-foreground text-sm mt-2 max-w-sm">{error}</p>
      <div className="mt-6 p-4 bg-card rounded-xl border border-border text-left max-w-sm shadow-xs">
        <p className="text-amber-500 text-xs font-bold mb-2">To fix this:</p>
        <code className="text-xs text-emerald-600 dark:text-emerald-400 block font-mono">
          # Windows: Start Docker Desktop<br />
          # Linux/Mac: sudo systemctl start docker
        </code>
      </div>
    </div>
  )
}

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
      <p className="text-foreground font-bold">No running containers</p>
      <p className="text-muted-foreground text-sm mt-1 mb-6">
        Start a container to begin streaming live logs.
      </p>

      {stopped.length > 0 && (
        <div className="max-w-md mx-auto">
          <p className="text-xs text-muted-foreground mb-3 font-semibold uppercase tracking-wider">
            Stopped containers ({stopped.length})
          </p>
          <div className="space-y-2">
            {stopped.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between px-4 py-3 rounded-lg border border-border bg-card shadow-xs"
              >
                <div className="text-left">
                  <p className="text-sm text-foreground font-mono font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.image}</p>
                </div>
                <span className="text-xs text-red-500 bg-red-500/10 px-2 py-1 rounded font-mono">
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StoppedContainerList({
  allContainers,
  connectedIds,
  onConnect,
}: {
  allContainers: { id: string; name: string; status: string; image: string; ports?: string }[]
  connectedIds: string[]
  onConnect: (id: string) => void
}) {
  const others = allContainers.filter((c) => !connectedIds.includes(c.id))
  if (others.length === 0) return null

  return (
    <div>
      <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-2 px-1">
        Other Containers
      </p>
      <div className="grid grid-cols-1 gap-2">
        {others.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between px-4 py-3 rounded-xl border border-border bg-card shadow-xs"
          >
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${c.status === 'running' ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <div>
                <p className="text-sm font-mono text-foreground font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">{c.image}</p>
              </div>
            </div>
            <span className="text-xs font-mono text-muted-foreground">{c.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
