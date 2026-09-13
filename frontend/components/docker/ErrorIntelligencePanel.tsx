'use client'
import { useState } from 'react'
import { useDockerErrorStore, LiveDockerError } from '@/store/dockerErrorStore'
import { clearDockerErrors, reanalyzeDockerError, reanalyzeAllDockerErrors, fetchDockerErrors } from '@/lib/docker-api'

export type TimeFilterOption = '1h' | '6h' | '24h' | 'all'

const SEV_STYLE: Record<string, { dot: string; badge: string; border: string; bg: string }> = {
  CRITICAL: { dot: 'bg-red-500', badge: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30', border: 'border-red-500/40', bg: 'bg-red-500/5' },
  HIGH:     { dot: 'bg-amber-500', badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30', border: 'border-amber-500/40', bg: 'bg-amber-500/5' },
  MEDIUM:   { dot: 'bg-yellow-500', badge: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30', border: 'border-yellow-500/40', bg: 'bg-yellow-500/5' },
  LOW:      { dot: 'bg-emerald-500', badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30', border: 'border-emerald-500/40', bg: 'bg-emerald-500/5' },
  ERROR:    { dot: 'bg-red-500', badge: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30', border: 'border-red-500/40', bg: 'bg-red-500/5' },
}

export function ErrorIntelligencePanel() {
  const { errors, unseenCount, markSeen, clear, attachSummary, loadHistory } = useDockerErrorStore()
  const [tab, setTab] = useState<'list' | 'ai'>('list')
  const [severityFilter, setSeverityFilter] = useState<string | null>(null)
  const [containerFilter, setContainerFilter] = useState<string | null>(null)
  const [timeFilter, setTimeFilter] = useState<TimeFilterOption>('1h')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [isReanalyzingAll, setIsReanalyzingAll] = useState(false)
  const [reanalyzingId, setReanalyzingId] = useState<string | null>(null)

  // Unique container names for filter chips
  const containerNames = [...new Set(errors.map((e) => e.container_name).filter(Boolean))]

  const now = Date.now()
  const filtered = errors.filter((e) => {
    const sev = e.summary?.severity || e.error_type || 'HIGH'
    if (severityFilter && sev !== severityFilter) return false
    if (containerFilter && e.container_name !== containerFilter) return false

    // Time window filter (default: last 1 hour)
    if (timeFilter !== 'all') {
      const timeStr = e.last_seen || e.timestamp
      if (timeStr) {
        const errTime = new Date(timeStr).getTime()
        if (!isNaN(errTime)) {
          const maxHours = timeFilter === '1h' ? 1 : timeFilter === '6h' ? 6 : 24
          const maxAgeMs = maxHours * 60 * 60 * 1000
          if (now - errTime > maxAgeMs) return false
        }
      }
    }
    return true
  })

  const withSummary = filtered.filter((e) => !!e.summary)

  const handleTimeFilterChange = async (tf: TimeFilterOption) => {
    setTimeFilter(tf)
    if (tf !== '1h') {
      try {
        const hours = tf === '6h' ? 6 : tf === '24h' ? 24 : undefined
        const history = await fetchDockerErrors({ limit: 100, hours })
        const entries: LiveDockerError[] = history.map((h) => ({
          error_id:       h.error.id,
          container_id:   h.error.container_id,
          container_name: h.error.container_name,
          error_type:     h.error.error_type || undefined,
          file_path:      h.error.file_path || undefined,
          line_number:    h.error.line_number || undefined,
          raw_stack_trace: h.error.raw_stack_trace || undefined,
          raw_message:    h.error.error_message,
          timestamp:      h.error.created_at,
          summary:        h.summary
            ? {
                title:             h.summary.title,
                what_happened:     h.summary.what_happened,
                why_it_happened:   h.summary.why_it_happened,
                recommended_fix:   h.summary.recommended_fix,
                severity:          h.summary.severity,
                confidence:        h.summary.confidence,
                suggested_commands: h.summary.suggested_commands,
              }
            : undefined,
        }))
        loadHistory(entries)
      } catch (err) {
        console.error('Failed to load history for selected time range:', err)
      }
    }
  }

  const handleReanalyzeSingle = async (errorId: string, containerName?: string) => {
    setReanalyzingId(errorId)
    try {
      const summary = await reanalyzeDockerError(errorId)
      if (summary) {
        attachSummary(errorId, {
          title: summary.title,
          what_happened: summary.what_happened,
          why_it_happened: summary.why_it_happened,
          recommended_fix: summary.recommended_fix,
          severity: summary.severity,
          confidence: summary.confidence,
          suggested_commands: summary.suggested_commands,
        }, {
          container_name: containerName,
        })
      }
    } catch (err) {
      console.error('Re-analysis failed:', err)
    } finally {
      setReanalyzingId(null)
    }
  }

  const handleReanalyzeAll = async () => {
    setIsReanalyzingAll(true)
    try {
      const res = await reanalyzeAllDockerErrors()
      if (res && res.summaries) {
        for (const s of res.summaries) {
          attachSummary(s.error_id, {
            title: s.title,
            what_happened: s.what_happened,
            why_it_happened: s.why_it_happened,
            recommended_fix: s.recommended_fix,
            severity: s.severity,
            confidence: s.confidence,
            suggested_commands: s.suggested_commands,
          }, {
            container_id: s.container_id,
            container_name: s.container_name,
          })
        }
      }
    } catch (err) {
      console.error('Batch re-analysis failed:', err)
    } finally {
      setIsReanalyzingAll(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card flex flex-col h-full overflow-hidden">
      {/* ── Panel Header ────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-border shrink-0 bg-card">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-foreground">Error Intelligence</span>
            {unseenCount > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-500 animate-pulse">
                +{unseenCount} new
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReanalyzeAll}
              disabled={isReanalyzingAll || errors.length === 0}
              className={`text-[10px] font-mono px-2 py-0.5 rounded transition-colors flex items-center gap-1 ${
                isReanalyzingAll
                  ? 'bg-primary/20 text-primary animate-pulse'
                  : 'text-primary hover:bg-primary/10 border border-primary/30'
              }`}
              title="Re-analyze all recorded errors with live AI"
            >
              <span>⚡</span> {isReanalyzingAll ? 'Analyzing…' : 'AI Re-analyze All'}
            </button>
            <button
              onClick={() => {
                clear()
                setExpandedId(null)
                clearDockerErrors().catch(() => {})
              }}
              className="text-[10px] font-mono text-muted-foreground hover:text-destructive transition-colors"
            >
              CLEAR ALL
            </button>
          </div>
        </div>

        {/* Severity filter chips */}
        <div className="flex flex-wrap gap-1.5">
          {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((sev) => {
            const s = SEV_STYLE[sev]
            const active = severityFilter === sev
            return (
              <button
                key={sev}
                onClick={() => setSeverityFilter(active ? null : sev)}
                className={`text-[9px] font-bold px-2 py-0.5 rounded-full transition-all border ${
                  active ? s.badge + ' shadow-xs' : 'text-muted-foreground hover:text-foreground border-border bg-card/60'
                }`}
              >
                {sev}
              </button>
            )
          })}
        </div>

        {/* Container filter chips */}
        {containerNames.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {containerNames.map((name) => (
              <button
                key={name}
                onClick={() => setContainerFilter(containerFilter === name ? null : name)}
                className={`text-[9px] px-2 py-0.5 rounded-full transition-all font-mono border ${
                  containerFilter === name
                    ? 'bg-primary/15 text-primary border-primary/30 font-bold'
                    : 'text-muted-foreground hover:text-foreground border-border bg-card/60'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        {/* Time Window selector */}
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border">
          <span className="text-[10px] text-muted-foreground font-mono mr-0.5 flex items-center gap-1">
            <span>⏱</span> Window:
          </span>
          {(['1h', '6h', '24h', 'all'] as const).map((tf) => {
            const active = timeFilter === tf
            const label = tf === '1h' ? 'Last 1h' : tf === '6h' ? '6h' : tf === '24h' ? '24h' : 'All'
            return (
              <button
                key={tf}
                onClick={() => handleTimeFilterChange(tf)}
                className={`text-[9px] font-mono px-2 py-0.5 rounded-full transition-all border ${
                  active
                    ? 'bg-primary/20 text-primary border-primary/50 font-bold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground border-border hover:border-muted-foreground/30'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────── */}
      <div className="flex border-b border-border shrink-0 bg-muted/40">
        <button
          onClick={() => { setTab('list'); markSeen() }}
          className={`flex-1 py-2 text-xs font-semibold transition-colors ${
            tab === 'list'
              ? 'text-foreground border-b-2 border-primary bg-card font-bold shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Error Log ({filtered.length})
        </button>
        <button
          onClick={() => { setTab('ai'); markSeen() }}
          className={`flex-1 py-2 text-xs font-semibold transition-colors ${
            tab === 'ai'
              ? 'text-foreground border-b-2 border-purple-500 bg-card font-bold shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          🤖 AI Analysis ({withSummary.length})
        </button>
      </div>

      {/* ── Content ────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        {tab === 'list' ? (
          <ErrorListTab
            errors={filtered}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            onReanalyze={handleReanalyzeSingle}
            reanalyzingId={reanalyzingId}
            timeFilter={timeFilter}
          />
        ) : (
          <AISummaryTab
            errors={withSummary}
            onReanalyze={handleReanalyzeSingle}
            reanalyzingId={reanalyzingId}
            timeFilter={timeFilter}
          />
        )}
      </div>
    </div>
  )
}


// ── Error List Tab ─────────────────────────────────────────────────────────────

function ErrorListTab({
  errors,
  expandedId,
  setExpandedId,
  onReanalyze,
  reanalyzingId,
  timeFilter,
}: {
  errors: LiveDockerError[]
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  onReanalyze: (errorId: string, containerName?: string) => void
  reanalyzingId: string | null
  timeFilter: TimeFilterOption
}) {
  if (errors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-6">
        <div className="text-4xl mb-3">✅</div>
        <p className="text-foreground font-semibold text-sm">
          {timeFilter === 'all'
            ? 'No errors detected'
            : `No errors in the last ${timeFilter === '1h' ? '1 hour' : timeFilter}`}
        </p>
        <p className="text-muted-foreground text-xs mt-1">
          Container logs are streaming — new errors will appear here automatically.
        </p>
      </div>
    )
  }

  return (
    <div className="p-2 space-y-1.5">
      {errors.map((entry, idx) => {
        const sev = entry.summary?.severity || 'HIGH'
        const s = SEV_STYLE[sev] || SEV_STYLE.HIGH
        const isExpanded = expandedId === entry.error_id
        const displayTitle = entry.summary?.title || entry.error_type || entry.raw_message
        const isAnalyzing = reanalyzingId === entry.error_id
        const fileBasename = entry.file_path ? entry.file_path.split('/').pop()?.split('\\').pop() : null

        return (
          <div
            key={`${entry.error_id}-${idx}`}
            className={`rounded-lg border ${isExpanded ? s.border + ' ' + s.bg : 'border-border bg-card'} transition-all overflow-hidden shadow-xs`}
          >
            {/* Row */}
            <button
              onClick={() => setExpandedId(isExpanded ? null : entry.error_id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 rounded-lg transition-colors"
            >
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
              <span className="text-[9px] font-mono text-muted-foreground shrink-0 w-14">
                {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0 border ${s.badge}`}>
                {sev}
              </span>
              {entry.occurrences && entry.occurrences > 1 && (
                <span className="text-[9px] font-mono font-bold px-1 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
                  ×{entry.occurrences}
                </span>
              )}
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-primary shrink-0 truncate max-w-[80px]">
                {entry.container_name}
              </span>
              <span className="text-[11px] text-foreground/90 truncate flex-1 font-mono">
                {displayTitle}
              </span>
              <span className="shrink-0 text-[9px]">
                {entry.summary
                  ? <span className="text-emerald-600 dark:text-emerald-400 font-bold">AI✓</span>
                  : <span className="text-muted-foreground animate-pulse">…</span>}
              </span>
              <span className="text-muted-foreground text-xs shrink-0">{isExpanded ? '↑' : '↓'}</span>
            </button>

            {/* Expanded AI detail */}
            {isExpanded && (
              <div className="px-4 pb-3 pt-2 space-y-2.5 border-t border-border bg-muted/20">
                {/* Meta details bar */}
                <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-b border-border pb-2">
                  <div className="flex items-center gap-2 flex-wrap text-[10px]">
                    <span className="px-2 py-0.5 rounded bg-muted text-foreground font-mono font-semibold border border-border">
                      {entry.error_type || 'RuntimeError'}
                    </span>
                    {fileBasename && (
                      <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-mono border border-primary/20">
                        📁 {fileBasename}{entry.line_number ? `:${entry.line_number}` : ''}
                      </span>
                    )}
                    <span className="text-muted-foreground font-mono">
                      in {entry.container_name}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onReanalyze(entry.error_id, entry.container_name)
                    }}
                    disabled={isAnalyzing}
                    className="text-[9px] font-mono px-2 py-1 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/30 hover:bg-purple-500/20 transition-all flex items-center gap-1 font-semibold"
                  >
                    <span>⚡</span> {isAnalyzing ? 'Analyzing…' : 'Re-analyze with AI'}
                  </button>
                </div>

                {entry.summary ? (
                  <>
                    <div className="space-y-2">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 block mb-0.5">
                          🔍 What Happened:
                        </span>
                        <p className="text-[11px] text-foreground/90 leading-relaxed">
                          {entry.summary.what_happened}
                        </p>
                      </div>

                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400 block mb-0.5">
                          🎯 Root Cause:
                        </span>
                        <p className="text-[11px] text-foreground/90 leading-relaxed">
                          {entry.summary.why_it_happened}
                        </p>
                      </div>

                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 block mb-0.5">
                          🛠️ Recommended Fix:
                        </span>
                        <FormattedFixText text={entry.summary.recommended_fix} />
                      </div>
                    </div>

                    {entry.summary.suggested_commands.length > 0 && (
                      <div className="space-y-1 mt-2">
                        <span className="text-[9px] font-mono uppercase text-cyan-600 dark:text-cyan-400 block font-semibold">Suggested Commands:</span>
                        {entry.summary.suggested_commands.map((cmd, i) => (
                          <div key={i} className="flex items-center gap-2 bg-card rounded px-2 py-1 border border-border shadow-xs">
                            <span className="text-cyan-600 dark:text-cyan-400 text-[10px] font-bold">$</span>
                            <code className="text-[10px] text-foreground font-mono flex-1">{cmd}</code>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                navigator.clipboard.writeText(cmd)
                              }}
                              className="text-[9px] text-muted-foreground hover:text-primary transition-colors font-medium"
                            >
                              COPY
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-2 border-t border-border">
                      <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.round(entry.summary.confidence * 100)}%` }}
                        />
                      </div>
                      <span className="text-[9px] font-mono text-muted-foreground shrink-0">
                        {Math.round(entry.summary.confidence * 100)}% confidence
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="py-3 text-center">
                    <div className="text-muted-foreground text-xs animate-pulse flex items-center justify-center gap-2">
                      <span>🤖</span> AI analysis in progress…
                    </div>
                  </div>
                )}

                {entry.raw_stack_trace && (
                  <div className="mt-2 pt-2 border-t border-border">
                    <p className="text-[9px] font-mono uppercase text-muted-foreground mb-1 font-semibold">Raw Error / Stack Trace</p>
                    <pre className="text-[10px] font-mono text-muted-foreground bg-muted/60 p-2 rounded max-h-32 overflow-y-auto whitespace-pre-wrap border border-border">
                      {entry.raw_stack_trace}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}


// ── AI Summary Tab ─────────────────────────────────────────────────────────────

function AISummaryTab({
  errors,
  onReanalyze,
  reanalyzingId,
  timeFilter,
}: {
  errors: LiveDockerError[]
  onReanalyze: (errorId: string, containerName?: string) => void
  reanalyzingId: string | null
  timeFilter: TimeFilterOption
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (errors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-6">
        <div className="text-4xl mb-3">🤖</div>
        <p className="text-foreground font-semibold text-sm">
          {timeFilter === 'all'
            ? 'No AI analyses found'
            : `No AI analyses in the last ${timeFilter === '1h' ? '1 hour' : timeFilter}`}
        </p>
        <p className="text-muted-foreground text-xs mt-1">
          Errors detected in container logs will be automatically analyzed here.
        </p>
      </div>
    )
  }

  return (
    <div className="p-3 space-y-3">
      {errors.map((entry, idx) => {
        const sev = entry.summary!.severity
        const s = SEV_STYLE[sev] || SEV_STYLE.HIGH
        const isOpen = expanded === entry.error_id
        const isAnalyzing = reanalyzingId === entry.error_id
        const fileBasename = entry.file_path ? entry.file_path.split('/').pop()?.split('\\').pop() : null

        return (
          <div
            key={`${entry.error_id}-${idx}`}
            className={`rounded-xl border ${s.border} ${s.bg} overflow-hidden transition-all shadow-xs`}
          >
            <button
              onClick={() => setExpanded(isOpen ? null : entry.error_id)}
              className="w-full flex items-start justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <span className="text-base mt-0.5">⚠️</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-foreground truncate">{entry.summary!.title}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="text-[10px] text-primary font-mono px-1.5 py-0.2 rounded bg-primary/10 border border-primary/20">
                      {entry.container_name}
                    </span>
                    {fileBasename && (
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">
                        {fileBasename}{entry.line_number ? `:${entry.line_number}` : ''}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      · {Math.round(entry.summary!.confidence * 100)}% confidence
                    </span>
                    {entry.occurrences && entry.occurrences > 1 && (
                      <span className="px-1 py-0.2 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 font-mono text-[9px] font-bold">
                        ×{entry.occurrences}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-2 shrink-0">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${s.badge}`}>{sev}</span>
                <span className="text-muted-foreground">{isOpen ? '↑' : '↓'}</span>
              </div>
            </button>

            {isOpen && (
              <div className="px-4 pb-4 pt-3 space-y-3 border-t border-border bg-card">
                {/* Actions bar */}
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border">
                      ID: {entry.error_id}
                    </span>
                    {entry.file_path && (
                      <span className="text-[10px] font-mono text-primary truncate max-w-[220px]">
                        {entry.file_path}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => onReanalyze(entry.error_id, entry.container_name)}
                    disabled={isAnalyzing}
                    className="text-[9px] font-mono px-2 py-1 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/30 hover:bg-purple-500/20 transition-all flex items-center gap-1 font-semibold"
                  >
                    <span>⚡</span> {isAnalyzing ? 'Analyzing…' : 'Re-analyze'}
                  </button>
                </div>

                <AiSection icon="🔍" title="What Happened">
                  <p className="text-xs text-foreground/90 leading-relaxed">{entry.summary!.what_happened}</p>
                </AiSection>

                <AiSection icon="🎯" title="Technical Root Cause">
                  <p className="text-xs text-foreground/90 leading-relaxed">{entry.summary!.why_it_happened}</p>
                </AiSection>

                <AiSection icon="🛠️" title="Recommended Solution & Fix">
                  <FormattedFixText text={entry.summary!.recommended_fix} />
                </AiSection>

                {entry.summary!.suggested_commands.length > 0 && (
                  <AiSection icon="💻" title="Actionable Terminal Commands">
                    <div className="space-y-1">
                      {entry.summary!.suggested_commands.map((cmd, i) => (
                        <div key={i} className="flex items-center gap-2 bg-muted/60 rounded px-2 py-1.5 border border-border">
                          <span className="text-cyan-600 dark:text-cyan-400 text-[10px] font-bold">$</span>
                          <code className="text-[10px] text-foreground font-mono flex-1">{cmd}</code>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              navigator.clipboard.writeText(cmd)
                            }}
                            className="text-[9px] text-muted-foreground hover:text-primary font-medium"
                          >
                            COPY
                          </button>
                        </div>
                      ))}
                    </div>
                  </AiSection>
                )}

                {entry.raw_stack_trace && (
                  <AiSection icon="📋" title="Raw Stack Trace / Log Line">
                    <pre className="text-[10px] font-mono text-muted-foreground bg-muted/60 p-2.5 rounded max-h-36 overflow-y-auto whitespace-pre-wrap border border-border">
                      {entry.raw_stack_trace}
                    </pre>
                  </AiSection>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AiSection({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-xs">{icon}</span>
        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </div>
  )
}

/** Component to render multi-step fix text cleanly with code highlights and step badges */
function FormattedFixText({ text }: { text: string }) {
  if (!text) return null

  // Split lines
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

  return (
    <div className="space-y-1.5 text-xs text-emerald-600 dark:text-emerald-400 leading-relaxed font-sans">
      {lines.map((line, i) => {
        const stepMatch = line.match(/^(\d+[\.\)])\s*(.*)$/)
        if (stepMatch) {
          const [, stepNum, stepContent] = stepMatch
          return (
            <div key={i} className="flex items-start gap-2 bg-emerald-500/5 dark:bg-emerald-500/10 p-2 rounded border border-emerald-500/20">
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 shrink-0">
                {stepNum}
              </span>
              <span className="text-[11px] text-foreground/90 flex-1 leading-relaxed">
                {renderCodeSpans(stepContent)}
              </span>
            </div>
          )
        }

        // Code block / snippet line
        if (line.startsWith('with ') || line.startsWith('import ') || line.startsWith('from ') || line.startsWith('docker ') || line.startsWith('git ')) {
          return (
            <pre key={i} className="font-mono text-[10px] text-primary bg-muted p-2 rounded border border-border">
              {line}
            </pre>
          )
        }

        return (
          <p key={i} className="text-[11px] text-foreground/90 leading-relaxed">
            {renderCodeSpans(line)}
          </p>
        )
      })}
    </div>
  )
}

function renderCodeSpans(str: string) {
  const parts = str.split(/(`[^`]+`)/g)
  return parts.map((part, idx) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={idx} className="font-mono text-[10px] bg-muted text-amber-600 dark:text-amber-400 px-1 py-0.5 rounded border border-border font-medium">
          {part.slice(1, -1)}
        </code>
      )
    }
    return part
  })
}
