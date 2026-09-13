"use client"
import { useState, useEffect } from "react"
import { AIErrorSummary } from "@/lib/websocket"
import {
  X,
  Sparkles,
  AlertTriangle,
  Copy,
  Check,
  Terminal,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  ArrowUpRight,
} from "lucide-react"

interface AIErrorSummaryPanelProps {
  summaries: AIErrorSummary[]
  onSelectCommand?: (command: string) => void
}

const SEVERITY_STYLES: Record<string, { border: string; bg: string; badge: string; text: string; glow: string }> = {
  CRITICAL: {
    border: "border-red-500/40 hover:border-red-500/80",
    bg: "bg-red-500/5 hover:bg-red-500/10",
    badge: "bg-red-500/20 text-red-400 border border-red-500/30",
    text: "text-red-400",
    glow: "shadow-[0_0_20px_rgba(239,68,68,0.15)]",
  },
  HIGH: {
    border: "border-amber-500/40 hover:border-amber-500/80",
    bg: "bg-amber-500/5 hover:bg-amber-500/10",
    badge: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
    text: "text-amber-400",
    glow: "shadow-[0_0_20px_rgba(245,158,11,0.15)]",
  },
  MEDIUM: {
    border: "border-yellow-500/40 hover:border-yellow-500/80",
    bg: "bg-yellow-500/5 hover:bg-yellow-500/10",
    badge: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
    text: "text-yellow-400",
    glow: "shadow-[0_0_20px_rgba(234,179,8,0.15)]",
  },
  LOW: {
    border: "border-emerald-500/40 hover:border-emerald-500/80",
    bg: "bg-emerald-500/5 hover:bg-emerald-500/10",
    badge: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
    text: "text-emerald-400",
    glow: "shadow-[0_0_20px_rgba(16,185,129,0.15)]",
  },
}

export function AIErrorSummaryPanel({ summaries, onSelectCommand }: AIErrorSummaryPanelProps) {
  const [selectedErrorId, setSelectedErrorId] = useState<string | null>(null)
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null)

  // Find active error summary for full side view
  const selectedSummary = summaries.find(s => s.error_id === selectedErrorId) || null
  const selectedIndex = selectedSummary ? summaries.indexOf(selectedSummary) : -1

  // Handle ESC key to close drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedErrorId(null)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const copyToClipboard = (cmd: string) => {
    navigator.clipboard.writeText(cmd)
    setCopiedCmd(cmd)
    setTimeout(() => setCopiedCmd(null), 2000)
  }

  if (summaries.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card/60 p-6 text-center">
        <div className="text-3xl mb-2">🤖</div>
        <p className="text-sm font-medium text-foreground">AI Error Analyzer is watching...</p>
        <p className="text-xs text-muted-foreground mt-1">
          Errors detected in the terminal stream will appear here with automatic root cause analysis.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {/* Subheader */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Detected Issues</span>
          <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-mono font-bold">
            {summaries.length}
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">Click card for full analysis</span>
      </div>

      {/* Hybrid independent scroll list: scrolling errors does NOT scroll the middle terminal */}
      <div
        className="flex flex-col gap-3 max-h-[calc(100vh-14rem)] overflow-y-auto pr-1"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#2a2a3e transparent" }}
      >
        {summaries.map(summary => {
          const sev = summary.severity || "HIGH"
          const style = SEVERITY_STYLES[sev] || SEVERITY_STYLES.HIGH
          const isSelected = selectedErrorId === summary.error_id

          return (
            <div
              key={summary.error_id}
              onClick={() => setSelectedErrorId(summary.error_id)}
              className={`group rounded-xl border p-4 cursor-pointer transition-all duration-200 ${style.border} ${style.bg} ${
                isSelected ? `ring-2 ring-primary ${style.glow}` : "hover:translate-y-[-1px]"
              }`}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <div className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-md ${style.badge}`}>
                    <AlertTriangle className="size-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                      {summary.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                      {new Date(summary.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      {" · "}
                      <span className="font-semibold">{Math.round(summary.confidence * 100)}% confidence</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md uppercase ${style.badge}`}>
                    {sev}
                  </span>
                  <div className="p-1 rounded-md text-muted-foreground group-hover:text-foreground group-hover:bg-muted/50 transition-colors">
                    <ArrowUpRight className="size-3.5" />
                  </div>
                </div>
              </div>

              {/* Brief preview */}
              <p className="mt-2.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                {summary.what_happened}
              </p>

              {/* Action indicator */}
              <div className="mt-3 pt-2.5 border-t border-border/40 flex items-center justify-between text-[11px]">
                <span className="text-primary font-medium flex items-center gap-1">
                  <Sparkles className="size-3" />
                  View Full Diagnosis
                </span>
                {summary.suggested_commands?.length > 0 && (
                  <span className="text-muted-foreground font-mono text-[10px]">
                    {summary.suggested_commands.length} fix cmd{summary.suggested_commands.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── FULL SIDE DRAWER FOR COMPLETE AI INVESTIGATION ─────────────────── */}
      {selectedSummary && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setSelectedErrorId(null)}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity animate-in fade-in"
          />

          {/* Slide-over Full-Side Drawer */}
          <aside
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-300"
            role="dialog"
            aria-modal="true"
          >
            {/* Top Navigation Bar */}
            <div className="flex h-16 items-center justify-between border-b border-border px-6 bg-card/90 backdrop-blur-md shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary shrink-0">
                  <Sparkles className="size-4" />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-foreground">AI Error Investigation</h3>
                  <p className="text-xs font-mono text-muted-foreground">
                    Issue {selectedIndex + 1} of {summaries.length} · ID: {selectedSummary.error_id.slice(0, 10)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Navigation through errors */}
                {summaries.length > 1 && (
                  <div className="flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
                    <button
                      disabled={selectedIndex <= 0}
                      onClick={() => setSelectedErrorId(summaries[selectedIndex - 1]?.error_id)}
                      className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30 rounded-md transition-colors"
                      title="Previous Error"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <button
                      disabled={selectedIndex >= summaries.length - 1}
                      onClick={() => setSelectedErrorId(summaries[selectedIndex + 1]?.error_id)}
                      className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30 rounded-md transition-colors"
                      title="Next Error"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                )}

                <button
                  onClick={() => setSelectedErrorId(null)}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  aria-label="Close panel"
                >
                  <X className="size-5" />
                </button>
              </div>
            </div>

            {/* Scrollable Full Side Analysis Body */}
            <div
              className="flex-1 overflow-y-auto p-6 space-y-6"
              style={{ scrollbarWidth: "thin", scrollbarColor: "#2a2a3e transparent" }}
            >
              {/* Title & Metadata Header Card */}
              {(() => {
                const sev = selectedSummary.severity || "HIGH"
                const style = SEVERITY_STYLES[sev] || SEVERITY_STYLES.HIGH
                return (
                  <div className={`rounded-xl border p-5 ${style.border} ${style.bg}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <AlertTriangle className={`size-5 mt-0.5 shrink-0 ${style.text}`} />
                        <div>
                          <h4 className="text-lg font-bold text-foreground leading-snug break-words">
                            {selectedSummary.title}
                          </h4>
                          <p className="text-xs font-mono text-muted-foreground mt-1">
                            Logged at {new Date(selectedSummary.timestamp).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <span className={`text-xs font-bold font-mono px-2.5 py-1 rounded-md uppercase ${style.badge}`}>
                          {sev} SEVERITY
                        </span>
                        <span className="text-[11px] font-mono text-muted-foreground">
                          {Math.round(selectedSummary.confidence * 100)}% Confidence
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* 1. What Happened */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-2">
                <div className="flex items-center gap-2 text-primary font-semibold text-xs uppercase tracking-wider">
                  <span>🔍</span>
                  <span>What Happened</span>
                </div>
                <p className="text-sm text-foreground/90 leading-relaxed break-words whitespace-pre-wrap">
                  {selectedSummary.what_happened}
                </p>
              </div>

              {/* 2. Root Cause Analysis */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-2">
                <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs uppercase tracking-wider">
                  <span>🎯</span>
                  <span>Root Cause Analysis (RCA)</span>
                </div>
                <p className="text-sm text-foreground/90 leading-relaxed break-words whitespace-pre-wrap">
                  {selectedSummary.why_it_happened}
                </p>
              </div>

              {/* 3. Recommended Fix */}
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs uppercase tracking-wider">
                  <span>🛠️</span>
                  <span>Recommended Remediation</span>
                </div>
                <div className="text-sm text-foreground/95 leading-relaxed break-words whitespace-pre-wrap font-sans">
                  {selectedSummary.recommended_fix}
                </div>
              </div>

              {/* 4. Suggested Terminal Commands */}
              {selectedSummary.suggested_commands && selectedSummary.suggested_commands.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-cyan-400 font-semibold text-xs uppercase tracking-wider">
                      <Terminal className="size-4" />
                      <span>Suggested Terminal Commands</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">Click command to copy or run</span>
                  </div>

                  <div className="space-y-2">
                    {selectedSummary.suggested_commands.map((cmd, i) => {
                      const isCopied = copiedCmd === cmd
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-black/40 px-3.5 py-2.5 font-mono text-xs hover:border-primary/50 transition-colors group"
                        >
                          <span className="text-cyan-400 select-none">$</span>
                          <span className="flex-1 select-all break-all text-foreground/90">{cmd}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            {onSelectCommand && (
                              <button
                                onClick={() => {
                                  onSelectCommand(cmd)
                                  setSelectedErrorId(null)
                                }}
                                className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-primary hover:bg-primary/10 transition-colors"
                                title="Load command into terminal input"
                              >
                                <Terminal className="size-3" />
                                <span>Load</span>
                              </button>
                            )}
                            <button
                              onClick={() => copyToClipboard(cmd)}
                              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                              title="Copy to clipboard"
                            >
                              {isCopied ? (
                                <>
                                  <Check className="size-3 text-emerald-400" />
                                  <span className="text-emerald-400">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="size-3" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border px-6 py-3.5 bg-card shrink-0">
              <span className="text-xs text-muted-foreground">
                Press <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd> to close
              </span>
              <button
                onClick={() => setSelectedErrorId(null)}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          </aside>
        </>
      )}
    </div>
  )
}
