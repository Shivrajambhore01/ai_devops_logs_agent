"use client"
import { useState } from "react"
import { AIErrorSummary } from "@/lib/websocket"

interface AIErrorSummaryPanelProps {
  summaries: AIErrorSummary[]
  onCreateIncident?: (summary: AIErrorSummary) => void
}

const SEVERITY_STYLES: Record<string, { border: string; bg: string; badge: string; text: string }> = {
  CRITICAL: { border: "border-[#e06c75]", bg: "bg-[#e06c75]/5", badge: "bg-[#e06c75]/20 text-[#e06c75]", text: "text-[#e06c75]" },
  HIGH:     { border: "border-[#e5984a]", bg: "bg-[#e5984a]/5", badge: "bg-[#e5984a]/20 text-[#e5984a]", text: "text-[#e5984a]" },
  MEDIUM:   { border: "border-[#e5c07b]", bg: "bg-[#e5c07b]/5", badge: "bg-[#e5c07b]/20 text-[#e5c07b]", text: "text-[#e5c07b]" },
  LOW:      { border: "border-[#98c379]", bg: "bg-[#98c379]/5", badge: "bg-[#98c379]/20 text-[#98c379]", text: "text-[#98c379]" },
}

export function AIErrorSummaryPanel({ summaries, onCreateIncident }: AIErrorSummaryPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (summaries.length === 0) {
    return (
      <div className="rounded-xl border border-[#2a2a3e] bg-[#0e0e1a] p-6 text-center">
        <div className="text-4xl mb-3">🤖</div>
        <p className="text-[#5c6370] text-sm">AI Error Analyzer is watching...</p>
        <p className="text-[#3d3d52] text-xs mt-1">Errors detected in the terminal will appear here with automatic root cause analysis.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[#abb2bf]">AI Error Analysis</span>
        <span className="text-xs font-mono text-[#5c6370]">{summaries.length} error{summaries.length !== 1 ? "s" : ""} detected</span>
      </div>

      {summaries.map(summary => {
        const sev = summary.severity || "HIGH"
        const style = SEVERITY_STYLES[sev] || SEVERITY_STYLES.HIGH
        const isExpanded = expanded === summary.error_id

        return (
          <div
            key={summary.error_id}
            className={`rounded-xl border ${style.border} ${style.bg} overflow-hidden transition-all`}
          >
            {/* Header */}
            <button
              onClick={() => setExpanded(isExpanded ? null : summary.error_id)}
              className="w-full flex items-start justify-between px-4 py-3 text-left"
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <span className="text-lg mt-0.5">⚠️</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{summary.title}</p>
                  <p className="text-xs text-[#5c6370] mt-0.5">
                    {new Date(summary.timestamp).toLocaleTimeString()} · {sev} · {Math.round(summary.confidence * 100)}% confidence
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-3 shrink-0">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${style.badge}`}>{sev}</span>
                <span className="text-[#5c6370] text-lg">{isExpanded ? "↑" : "↓"}</span>
              </div>
            </button>

            {/* Expanded body */}
            {isExpanded && (
              <div className="px-4 pb-4 space-y-4 border-t border-[#2a2a3e] pt-4">
                <Section icon="🔍" title="What Happened">
                  <p className="text-sm text-[#abb2bf] leading-relaxed">{summary.what_happened}</p>
                </Section>

                <Section icon="🎯" title="Root Cause">
                  <p className="text-sm text-[#abb2bf] leading-relaxed">{summary.why_it_happened}</p>
                </Section>

                <Section icon="🛠️" title="Recommended Fix">
                  <p className="text-sm text-[#98c379] leading-relaxed">{summary.recommended_fix}</p>
                </Section>

                {summary.suggested_commands.length > 0 && (
                  <Section icon="💻" title="Suggested Commands">
                    <div className="space-y-1.5">
                      {summary.suggested_commands.map((cmd, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 bg-[#0d0d1a] rounded-lg px-3 py-2 border border-[#2a2a3e]"
                        >
                          <span className="text-[#56b6c2] text-xs">$</span>
                          <code className="text-xs text-[#abb2bf] font-mono flex-1">{cmd}</code>
                          <button
                            onClick={() => navigator.clipboard.writeText(cmd)}
                            className="text-[10px] text-[#5c6370] hover:text-[#61afef] transition-colors"
                          >
                            COPY
                          </button>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Level 2 trigger button */}
                {onCreateIncident && (
                  <button
                    onClick={() => onCreateIncident(summary)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[#c678dd]/40 bg-[#c678dd]/10 text-[#c678dd] text-sm font-medium hover:bg-[#c678dd]/20 transition-all"
                  >
                    <span>🚀</span>
                    <span>Escalate to Full Incident Investigation</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-semibold text-[#5c6370] uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </div>
  )
}
