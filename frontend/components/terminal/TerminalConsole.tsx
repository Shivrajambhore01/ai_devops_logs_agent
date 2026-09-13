"use client"
import { useState, useEffect, useRef, useCallback } from "react"
import { TerminalLine, AIErrorSummary, TerminalWebSocketClient } from "@/lib/websocket"

interface TerminalConsoleProps {
  sessionId: string
  title?: string
  source?: "local" | "docker"
  onAIError?: (summary: AIErrorSummary) => void
  height?: number
}

const LEVEL_COLORS: Record<string, string> = {
  INFO:  "#98c379",
  WARN:  "#e5c07b",
  ERROR: "#e06c75",
  AI:    "#c678dd",
  DEBUG: "#56b6c2",
}

const LEVEL_BADGES: Record<string, string> = {
  INFO:  "bg-green-900/30 text-green-400",
  WARN:  "bg-yellow-900/30 text-yellow-400",
  ERROR: "bg-red-900/30 text-red-400",
  AI:    "bg-purple-900/30 text-purple-400",
  DEBUG: "bg-cyan-900/30 text-cyan-400",
}

export function TerminalConsole({ sessionId, title, source, onAIError, height = 420 }: TerminalConsoleProps) {
  const [lines, setLines] = useState<TerminalLine[]>([])
  const [wsStatus, setWsStatus] = useState("CONNECTING")
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const clientRef = useRef<TerminalWebSocketClient | null>(null)

  const onLine = useCallback((line: TerminalLine) => {
    setLines(prev => {
      const next = [...prev, line]
      return next.slice(-2000) // Keep last 2000 lines
    })
  }, [])

  const onAISummary = useCallback((summary: AIErrorSummary) => {
    const aiLine: TerminalLine = {
      id: "ai_" + summary.error_id,
      session_id: sessionId,
      timestamp: summary.timestamp,
      source: source || "local",
      stream: "stdout",
      level: "AI",
      message: `🤖 AI Summary: ${summary.title}`,
      event_type: "AI_ANALYSIS_COMPLETED",
    }
    setLines(prev => [...prev, aiLine])
    onAIError?.(summary)
  }, [sessionId, source, onAIError])

  useEffect(() => {
    const client = new TerminalWebSocketClient(sessionId, onLine, onAISummary, setWsStatus)
    clientRef.current = client
    client.connect()
    return () => {
      client.disconnect()
    }
  }, [sessionId, onLine, onAISummary])

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [lines, autoScroll])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 35
    setAutoScroll(atBottom)
  }

  const filteredLines = filter ? lines.filter(l => l.level === filter) : lines

  const statusColor = wsStatus === "CONNECTED" ? "#98c379"
    : wsStatus.startsWith("RECONNECTING") ? "#e5c07b"
    : wsStatus === "ERROR" || wsStatus === "DISCONNECTED" ? "#e06c75"
    : "#56b6c2"

  return (
    <div className="rounded-xl border border-border overflow-hidden flex flex-col min-w-0 w-full bg-card shadow-xs" style={{ height }}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/60 border-b border-border min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex gap-1.5 shrink-0">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <div className="w-3 h-3 rounded-full bg-amber-500" />
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
          </div>
          <span className="text-xs font-mono text-foreground font-semibold truncate">{title || sessionId}</span>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Filter buttons */}
          {(["ERROR", "WARN", "AI"] as const).map(lvl => (
            <button
              key={lvl}
              onClick={() => setFilter(filter === lvl ? null : lvl)}
              className={`text-[10px] px-2 py-0.5 rounded font-mono transition-all ${filter === lvl ? LEVEL_BADGES[lvl] : "text-muted-foreground hover:text-foreground"}`}
            >
              {lvl}
            </button>
          ))}
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: statusColor }} />
            <span className="text-[10px] font-mono" style={{ color: statusColor }}>{wsStatus}</span>
          </div>
          <button
            onClick={() => setLines([])}
            className="text-[10px] font-mono text-muted-foreground hover:text-red-500 transition-colors"
          >
            CLEAR
          </button>
        </div>
      </div>

      {/* Terminal output */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden font-mono text-[12px] leading-6 bg-[#0a0f1d] p-3.5 space-y-px min-w-0"
        style={{ scrollbarWidth: "thin" }}
      >
        {filteredLines.length === 0 && (
          <div className="text-muted-foreground text-center mt-8 text-xs">
            {wsStatus === "CONNECTING" || wsStatus === "CONNECTED"
              ? "Waiting for terminal output..."
              : "No output captured."}
          </div>
        )}
        {filteredLines.map(line => (
          <TerminalLineRow key={line.id} line={line} />
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 bg-muted/60 border-t border-border min-w-0">
        <span className="text-[10px] font-mono text-muted-foreground">
          {filteredLines.length} lines · session:{sessionId.slice(0, 12)}
        </span>
        {!autoScroll && (
          <button
            onClick={() => {
              setAutoScroll(true)
              if (containerRef.current) {
                containerRef.current.scrollTop = containerRef.current.scrollHeight
              }
            }}
            className="text-[10px] font-mono text-primary hover:underline transition-colors animate-pulse font-medium"
          >
            ↓ Auto-scroll paused (click to resume)
          </button>
        )}
      </div>
    </div>
  )
}

function TerminalLineRow({ line }: { line: TerminalLine }) {
  const color = LEVEL_COLORS[line.level] || "#abb2bf"
  const ts = new Date(line.timestamp).toLocaleTimeString("en-US", { hour12: false })

  return (
    <div className="flex items-start gap-2 hover:bg-[#12122a] px-1 rounded-sm transition-colors group min-w-0">
      <span className="text-[#3d3d52] shrink-0 select-none text-[10px] mt-px">{ts}</span>
      <span
        className="shrink-0 text-[10px] font-bold w-8 mt-px opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color }}
      >
        {line.level.slice(0, 4)}
      </span>
      <span className="break-all whitespace-pre-wrap flex-1 min-w-0 overflow-hidden leading-snug" style={{ color }}>
        {line.message}
      </span>
    </div>
  )
}
