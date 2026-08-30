'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useDockerStream, DockerLogLine, DockerAIEvent, DockerErrorEvent } from '@/hooks/useDockerStream'
import { useDockerErrorStore, LiveDockerError } from '@/store/dockerErrorStore'
import { ConnectedContainer } from '@/hooks/useDockerAutoConnect'

interface ContainerLogPanelProps {
  container: ConnectedContainer
}

const LEVEL_COLORS: Record<string, string> = {
  INFO:  '#98c379',
  WARN:  '#e5c07b',
  ERROR: '#e06c75',
  AI:    '#c678dd',
  DEBUG: '#56b6c2',
}

const LEVEL_BG: Record<string, string> = {
  INFO:  'bg-green-900/20 text-green-400',
  WARN:  'bg-yellow-900/20 text-yellow-400',
  ERROR: 'bg-red-900/20 text-red-400',
  AI:    'bg-purple-900/20 text-purple-400',
  DEBUG: 'bg-cyan-900/20 text-cyan-400',
}

export function ContainerLogPanel({ container }: ContainerLogPanelProps) {
  const [lines, setLines] = useState<DockerLogLine[]>([])
  const [wsStatus, setWsStatus] = useState('CONNECTING')
  const [autoScroll, setAutoScroll] = useState(true)
  const [levelFilter, setLevelFilter] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const { addError, attachSummary } = useDockerErrorStore()

  const onLine = useCallback((line: DockerLogLine) => {
    setLines((prev) => [...prev, line].slice(-2000))
  }, [])

  const onErrorDetected = useCallback((err: DockerErrorEvent) => {
    const rawMsg = err.error_type
      ? `${err.error_type}: ${err.error_message}`
      : err.error_message || 'Application runtime error'

    const entry: LiveDockerError = {
      error_id:        err.error_id || err.id,
      container_id:    container.id,
      container_name:  container.name,
      error_type:      err.error_type,
      error_message:   err.error_message,
      raw_message:     rawMsg,
      file_path:       err.file_path,
      line_number:     err.line_number,
      raw_stack_trace: err.raw_stack_trace,
      timestamp:       err.timestamp || new Date().toISOString(),
    }
    addError(entry)
  }, [container.id, container.name, addError])

  const onAISummary = useCallback((summary: DockerAIEvent) => {
    // Inject AI summary line into console
    const aiLine: DockerLogLine = {
      id:         'ai_' + summary.error_id,
      session_id: container.sessionId,
      timestamp:  summary.timestamp,
      level:      'AI',
      message:    `🤖 AI: ${summary.title}`,
      event_type: 'AI_ANALYSIS_COMPLETED',
    }
    setLines((prev) => [...prev, aiLine].slice(-2000))

    // Attach summary to the error entry in global store
    attachSummary(summary.error_id, {
      title:              summary.title,
      what_happened:      summary.what_happened,
      why_it_happened:    summary.why_it_happened,
      recommended_fix:    summary.recommended_fix,
      severity:           summary.severity,
      confidence:         summary.confidence,
      suggested_commands: summary.suggested_commands,
    })
  }, [container.sessionId, attachSummary])

  useDockerStream({
    sessionId:      container.sessionId,
    onLine,
    onErrorDetected,
    onAISummary,
    onStatusChange: setWsStatus,
  })

  // Auto-scroll
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, autoScroll])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
  }

  const filtered = levelFilter ? lines.filter((l) => l.level === levelFilter) : lines

  const statusColor =
    wsStatus === 'CONNECTED'          ? '#98c379'
    : wsStatus.startsWith('RECONNECT') ? '#e5c07b'
    : wsStatus === 'DISCONNECTED' || wsStatus === 'ERROR' ? '#e06c75'
    : '#56b6c2'

  const errorCount = lines.filter((l) => l.level === 'ERROR').length

  return (
    <div className="rounded-xl border border-[#2a2a3e] overflow-hidden flex flex-col bg-[#080810]" style={{ height: 280 }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#0e0e1a] border-b border-[#2a2a3e] shrink-0">
        <div className="flex items-center gap-3">
          {/* macOS dots */}
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#e06c75]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#e5c07b]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#98c379]" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white font-mono">{container.name}</span>
            <span className="text-[10px] text-[#5c6370]">{container.image}</span>
            {container.ports && container.ports !== 'N/A' && (
              <span className="text-[10px] font-mono text-[#61afef]">:{container.ports}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Error count badge */}
          {errorCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#e06c75]/20 text-[#e06c75]">
              {errorCount} err
            </span>
          )}
          {/* Level filter chips */}
          {(['ERROR', 'WARN', 'AI'] as const).map((lvl) => (
            <button
              key={lvl}
              onClick={() => setLevelFilter(levelFilter === lvl ? null : lvl)}
              className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold transition-all ${
                levelFilter === lvl ? LEVEL_BG[lvl] : 'text-[#5c6370] hover:text-[#abb2bf]'
              }`}
            >
              {lvl}
            </button>
          ))}
          {/* WS status dot */}
          <div className="flex items-center gap-1">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: statusColor, animation: wsStatus === 'CONNECTED' ? 'pulse 2s infinite' : 'none' }}
            />
            <span className="text-[9px] font-mono" style={{ color: statusColor }}>
              {wsStatus}
            </span>
          </div>
          {/* Clear */}
          <button
            onClick={() => setLines([])}
            className="text-[9px] font-mono text-[#5c6370] hover:text-[#e06c75] transition-colors"
          >
            CLR
          </button>
        </div>
      </div>

      {/* ── Log output ─────────────────────────────────────── */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto font-mono text-[11px] leading-5 bg-[#080810] p-2 space-y-px"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a2a3e transparent' }}
      >
        {filtered.length === 0 && (
          <div className="text-[#3d3d52] text-center mt-6 text-xs">
            {wsStatus === 'CONNECTING' || wsStatus === 'CONNECTED'
              ? 'Waiting for container logs…'
              : 'No output captured.'}
          </div>
        )}
        {filtered.map((line) => (
          <LogLine key={line.id} line={line} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── Footer ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-1 bg-[#0e0e1a] border-t border-[#2a2a3e] shrink-0">
        <span className="text-[9px] font-mono text-[#3d3d52]">
          {filtered.length} lines · {container.sessionId}
        </span>
        {!autoScroll && (
          <button
            onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
            className="text-[9px] font-mono text-[#61afef] hover:text-white transition-colors animate-bounce"
          >
            ↓ scroll to bottom
          </button>
        )}
      </div>
    </div>
  )
}

function LogLine({ line }: { line: DockerLogLine }) {
  const color = LEVEL_COLORS[line.level] || '#abb2bf'
  const ts = new Date(line.timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <div className="flex items-start gap-2 hover:bg-[#12122a] px-1 rounded-sm transition-colors group">
      <span className="text-[#3d3d52] shrink-0 select-none text-[9px] mt-px w-14">{ts}</span>
      <span
        className="shrink-0 text-[9px] font-bold w-7 mt-px opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color }}
      >
        {line.level.slice(0, 3)}
      </span>
      <span className="break-all whitespace-pre-wrap flex-1 text-[11px]" style={{ color }}>
        {line.message}
      </span>
    </div>
  )
}
