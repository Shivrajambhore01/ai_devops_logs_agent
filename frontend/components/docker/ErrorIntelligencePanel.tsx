'use client'
import { useState } from 'react'
import { useDockerErrorStore, LiveDockerError } from '@/store/dockerErrorStore'

const SEV_STYLE: Record<string, { dot: string; badge: string; border: string; bg: string }> = {
  CRITICAL: { dot: 'bg-[#e06c75]', badge: 'bg-[#e06c75]/20 text-[#e06c75]', border: 'border-[#e06c75]/40', bg: 'bg-[#e06c75]/5' },
  HIGH:     { dot: 'bg-[#e5984a]', badge: 'bg-[#e5984a]/20 text-[#e5984a]', border: 'border-[#e5984a]/40', bg: 'bg-[#e5984a]/5' },
  MEDIUM:   { dot: 'bg-[#e5c07b]', badge: 'bg-[#e5c07b]/20 text-[#e5c07b]', border: 'border-[#e5c07b]/40', bg: 'bg-[#e5c07b]/5' },
  LOW:      { dot: 'bg-[#98c379]', badge: 'bg-[#98c379]/20 text-[#98c379]', border: 'border-[#98c379]/40', bg: 'bg-[#98c379]/5' },
  ERROR:    { dot: 'bg-[#e06c75]', badge: 'bg-[#e06c75]/20 text-[#e06c75]', border: 'border-[#e06c75]/40', bg: 'bg-[#e06c75]/5' },
}

export function ErrorIntelligencePanel() {
  const { errors, unseenCount, markSeen, clear } = useDockerErrorStore()
  const [tab, setTab] = useState<'list' | 'ai'>('list')
  const [severityFilter, setSeverityFilter] = useState<string | null>(null)
  const [containerFilter, setContainerFilter] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Unique container names for filter chips
  const containerNames = [...new Set(errors.map((e) => e.container_name))]

  const filtered = errors.filter((e) => {
    const sev = e.summary?.severity || 'HIGH'
    if (severityFilter && sev !== severityFilter) return false
    if (containerFilter && e.container_name !== containerFilter) return false
    return true
  })

  const withSummary = filtered.filter((e) => !!e.summary)

  return (
    <div className="rounded-xl border border-[#2a2a3e] bg-[#0a0a16] flex flex-col h-full overflow-hidden">
      {/* ── Panel Header ────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-[#2a2a3e] shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white">Error Intelligence</span>
            {unseenCount > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#e06c75]/20 text-[#e06c75] animate-pulse">
                +{unseenCount} new
              </span>
            )}
          </div>
          <button
            onClick={() => { clear(); setExpandedId(null) }}
            className="text-[10px] font-mono text-[#5c6370] hover:text-[#e06c75] transition-colors"
          >
            CLEAR ALL
          </button>
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
                className={`text-[9px] font-bold px-2 py-0.5 rounded-full transition-all ${
                  active ? s.badge : 'text-[#5c6370] hover:text-white border border-[#2a2a3e]'
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
                className={`text-[9px] px-2 py-0.5 rounded-full transition-all font-mono ${
                  containerFilter === name
                    ? 'bg-[#61afef]/20 text-[#61afef]'
                    : 'text-[#5c6370] hover:text-white border border-[#2a2a3e]'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Tabs ──────────────────────────────────────────────── */}
      <div className="flex border-b border-[#2a2a3e] shrink-0">
        <button
          onClick={() => { setTab('list'); markSeen() }}
          className={`flex-1 py-2 text-xs font-semibold transition-colors ${
            tab === 'list'
              ? 'text-white border-b-2 border-[#61afef]'
              : 'text-[#5c6370] hover:text-[#abb2bf]'
          }`}
        >
          Error Log ({filtered.length})
        </button>
        <button
          onClick={() => { setTab('ai'); markSeen() }}
          className={`flex-1 py-2 text-xs font-semibold transition-colors ${
            tab === 'ai'
              ? 'text-white border-b-2 border-[#c678dd]'
              : 'text-[#5c6370] hover:text-[#abb2bf]'
          }`}
        >
          🤖 AI Analysis ({withSummary.length})
        </button>
      </div>

      {/* ── Content ────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a2a3e transparent' }}>
        {tab === 'list' ? (
          <ErrorListTab
            errors={filtered}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
          />
        ) : (
          <AISummaryTab errors={withSummary} />
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
}: {
  errors: LiveDockerError[]
  expandedId: string | null
  setExpandedId: (id: string | null) => void
}) {
  if (errors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-6">
        <div className="text-4xl mb-3">✅</div>
        <p className="text-white font-semibold text-sm">No errors detected</p>
        <p className="text-[#5c6370] text-xs mt-1">
          Container logs are streaming — errors will appear here automatically.
        </p>
      </div>
    )
  }

  return (
    <div className="p-2 space-y-1">
      {errors.map((entry) => {
        const sev = entry.summary?.severity || 'HIGH'
        const s = SEV_STYLE[sev] || SEV_STYLE.HIGH
        const isExpanded = expandedId === entry.error_id
        const displayTitle = entry.summary?.title || entry.raw_message

        return (
          <div key={entry.error_id} className={`rounded-lg border ${isExpanded ? s.border + ' ' + s.bg : 'border-[#2a2a3e]'} transition-all`}>
            {/* Row */}
            <button
              onClick={() => setExpandedId(isExpanded ? null : entry.error_id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#12122a] rounded-lg transition-colors"
            >
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
              <span className="text-[9px] font-mono text-[#5c6370] shrink-0 w-14">
                {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0 ${s.badge}`}>
                {sev}
              </span>
              {entry.occurrences && entry.occurrences > 1 && (
                <span className="text-[9px] font-mono font-bold px-1 py-0.5 rounded bg-[#e5984a]/20 text-[#e5984a] shrink-0">
                  ×{entry.occurrences}
                </span>
              )}
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#1e1e2e] text-[#61afef] shrink-0 truncate max-w-[70px]">
                {entry.container_name}
              </span>
              <span className="text-[11px] text-[#abb2bf] truncate flex-1 font-mono">
                {displayTitle}
              </span>
              <span className="shrink-0 text-[9px]">
                {entry.summary
                  ? <span className="text-[#98c379] font-bold">AI✓</span>
                  : <span className="text-[#5c6370] animate-pulse">…</span>}
              </span>
              <span className="text-[#5c6370] text-xs shrink-0">{isExpanded ? '↑' : '↓'}</span>
            </button>

            {/* Expanded AI detail */}
            {isExpanded && entry.summary && (
              <div className="px-4 pb-3 pt-1 space-y-2 border-t border-[#2a2a3e]">
                <p className="text-[11px] text-[#abb2bf] leading-relaxed">
                  <span className="text-[#e5c07b] font-semibold">What: </span>
                  {entry.summary.what_happened}
                </p>
                <p className="text-[11px] text-[#abb2bf] leading-relaxed">
                  <span className="text-[#e5984a] font-semibold">Why: </span>
                  {entry.summary.why_it_happened}
                </p>
                <p className="text-[11px] text-[#98c379] leading-relaxed">
                  <span className="font-semibold">Fix: </span>
                  {entry.summary.recommended_fix}
                </p>
                {entry.summary.suggested_commands.length > 0 && (
                  <div className="space-y-1 mt-1">
                    {entry.summary.suggested_commands.map((cmd, i) => (
                      <div key={i} className="flex items-center gap-2 bg-[#0d0d1a] rounded px-2 py-1 border border-[#2a2a3e]">
                        <span className="text-[#56b6c2] text-[10px]">$</span>
                        <code className="text-[10px] text-[#abb2bf] font-mono flex-1">{cmd}</code>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            navigator.clipboard.writeText(cmd)
                          }}
                          className="text-[9px] text-[#5c6370] hover:text-[#61afef] transition-colors"
                        >
                          COPY
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {entry.raw_stack_trace && (
                  <div className="mt-2 pt-2 border-t border-[#2a2a3e]/50">
                    <p className="text-[9px] font-mono uppercase text-[#5c6370] mb-1">Stack Trace</p>
                    <pre className="text-[10px] font-mono text-[#7f848e] bg-[#090912] p-2 rounded max-h-32 overflow-y-auto whitespace-pre-wrap">
                      {entry.raw_stack_trace}
                    </pre>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <div className="w-full bg-[#2a2a3e] rounded-full h-1">
                    <div
                      className="h-1 rounded-full bg-[#61afef]"
                      style={{ width: `${Math.round(entry.summary.confidence * 100)}%` }}
                    />
                  </div>
                  <span className="text-[9px] font-mono text-[#5c6370] shrink-0">
                    {Math.round(entry.summary.confidence * 100)}% confidence
                  </span>
                </div>
              </div>
            )}

            {/* Expanded but no summary yet */}
            {isExpanded && !entry.summary && (
              <div className="px-4 pb-3 pt-2 space-y-2 border-t border-[#2a2a3e]">
                <div className="text-[#5c6370] text-xs animate-pulse flex items-center gap-2">
                  <span>🤖</span> AI analysis in progress…
                </div>
                {entry.raw_stack_trace && (
                  <pre className="text-[10px] font-mono text-[#7f848e] bg-[#090912] p-2 rounded max-h-32 overflow-y-auto whitespace-pre-wrap">
                    {entry.raw_stack_trace}
                  </pre>
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

function AISummaryTab({ errors }: { errors: LiveDockerError[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (errors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-6">
        <div className="text-4xl mb-3">🤖</div>
        <p className="text-white font-semibold text-sm">AI Error Analyzer is watching…</p>
        <p className="text-[#5c6370] text-xs mt-1">
          Errors detected in container logs will be automatically analyzed here.
        </p>
      </div>
    )
  }

  return (
    <div className="p-3 space-y-3">
      {errors.map((entry) => {
        const sev = entry.summary!.severity
        const s = SEV_STYLE[sev] || SEV_STYLE.HIGH
        const isOpen = expanded === entry.error_id

        return (
          <div
            key={entry.error_id}
            className={`rounded-xl border ${s.border} ${s.bg} overflow-hidden transition-all`}
          >
            <button
              onClick={() => setExpanded(isOpen ? null : entry.error_id)}
              className="w-full flex items-start justify-between px-4 py-3 text-left"
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <span className="text-base mt-0.5">⚠️</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white truncate">{entry.summary!.title}</p>
                  <p className="text-[10px] text-[#5c6370] mt-0.5">
                    {new Date(entry.timestamp).toLocaleTimeString()} ·{' '}
                    <span className="text-[#61afef] font-mono">{entry.container_name}</span> ·{' '}
                    {Math.round(entry.summary!.confidence * 100)}% confidence
                    {entry.occurrences && entry.occurrences > 1 && (
                      <span className="ml-2 px-1 py-0.2 rounded bg-[#e5984a]/20 text-[#e5984a] font-mono font-bold">
                        ×{entry.occurrences}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-2 shrink-0">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${s.badge}`}>{sev}</span>
                <span className="text-[#5c6370]">{isOpen ? '↑' : '↓'}</span>
              </div>
            </button>

            {isOpen && (
              <div className="px-4 pb-4 pt-3 space-y-3 border-t border-[#2a2a3e]">
                <AiSection icon="🔍" title="What Happened">
                  <p className="text-xs text-[#abb2bf] leading-relaxed">{entry.summary!.what_happened}</p>
                </AiSection>
                <AiSection icon="🎯" title="Root Cause">
                  <p className="text-xs text-[#abb2bf] leading-relaxed">{entry.summary!.why_it_happened}</p>
                </AiSection>
                <AiSection icon="🛠️" title="Fix">
                  <p className="text-xs text-[#98c379] leading-relaxed">{entry.summary!.recommended_fix}</p>
                </AiSection>
                {entry.summary!.suggested_commands.length > 0 && (
                  <AiSection icon="💻" title="Commands">
                    <div className="space-y-1">
                      {entry.summary!.suggested_commands.map((cmd, i) => (
                        <div key={i} className="flex items-center gap-2 bg-[#0d0d1a] rounded px-2 py-1.5 border border-[#2a2a3e]">
                          <span className="text-[#56b6c2] text-[10px]">$</span>
                          <code className="text-[10px] text-[#abb2bf] font-mono flex-1">{cmd}</code>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              navigator.clipboard.writeText(cmd)
                            }}
                            className="text-[9px] text-[#5c6370] hover:text-[#61afef]"
                          >
                            COPY
                          </button>
                        </div>
                      ))}
                    </div>
                  </AiSection>
                )}
                {entry.raw_stack_trace && (
                  <AiSection icon="📋" title="Raw Trace">
                    <pre className="text-[10px] font-mono text-[#7f848e] bg-[#090912] p-2 rounded max-h-32 overflow-y-auto whitespace-pre-wrap">
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
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-xs">{icon}</span>
        <span className="text-[9px] font-bold text-[#5c6370] uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </div>
  )
}
