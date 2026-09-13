'use client'

import { useState, useEffect } from 'react'
import { Sparkles, Cpu, Shield, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { fetchAIProvider, type AIProviderInfo } from '@/lib/ai-provider-api'

// ── Icon mapping ───────────────────────────────────────────────────────────────

function ProviderIcon({ icon, size = 'size-3' }: { icon: string; size?: string }) {
  if (icon === 'cpu') return <Cpu className={size} />
  if (icon === 'sparkles') return <Sparkles className={size} />
  return <Shield className={size} />
}

// ── Compact inline badge (shown next to "AI ANALYSIS" heading) ─────────────────

export function AIProviderBadge({ className = '' }: { className?: string }) {
  const [info, setInfo] = useState<AIProviderInfo | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    fetchAIProvider().then(setInfo).catch(() => {})
  }, [])

  if (!info) return null

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold transition-all hover:opacity-80"
        style={{
          color: info.color,
          borderColor: `${info.color}40`,
          backgroundColor: `${info.color}12`,
        }}
        title={`AI Provider: ${info.display_name} — click for details`}
      >
        <ProviderIcon icon={info.icon} />
        {info.model_display}
        {expanded ? <ChevronUp className="size-2.5" /> : <ChevronDown className="size-2.5" />}
      </button>

      {expanded && (
        <div className="absolute right-0 top-full mt-2 z-50 w-72 rounded-xl border border-white/10 bg-[#0d0f14] shadow-2xl shadow-black/50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/10"
            style={{ background: `${info.color}10` }}>
            <span className="grid size-8 place-items-center rounded-lg border"
              style={{ color: info.color, borderColor: `${info.color}30`, background: `${info.color}15` }}>
              <ProviderIcon icon={info.icon} size="size-4" />
            </span>
            <div>
              <p className="text-xs font-bold text-foreground">{info.display_name}</p>
              <p className="text-[10px] text-muted-foreground capitalize">{info.type} inference</p>
            </div>
            <span className={`ml-auto text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${
              info.type === 'cloud'
                ? 'text-[#61afef] bg-[#61afef]/10 border-[#61afef]/30'
                : 'text-[#e5c07b] bg-[#e5c07b]/10 border-[#e5c07b]/30'
            }`}>
              {info.type}
            </span>
          </div>

          {/* Details */}
          <div className="px-4 py-3 space-y-2.5">
            <Row label="Provider" value={info.provider.toUpperCase()} />
            <Row label="Model" value={info.model_display} />
            <Row label="Description" value={info.description} />

            {info.base_url && (
              <Row
                label="Endpoint"
                value={
                  <span className="flex items-center gap-1 font-mono truncate max-w-[160px]">
                    {info.base_url}
                    <ExternalLink className="size-2.5 flex-shrink-0 opacity-60" />
                  </span>
                }
              />
            )}

            {/* Fallback chain */}
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
                Fallback Chain
              </p>
              <div className="flex flex-wrap gap-1">
                {info.fallback_chain.map((step, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded-md border border-white/10 bg-white/5 text-muted-foreground"
                  >
                    <span className="text-muted-foreground/40">{i + 1}.</span>
                    {step}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-white/10 bg-white/3">
            <p className="text-[9px] text-muted-foreground/60">
              Configure via <code className="font-mono text-muted-foreground">LLM_PROVIDER</code> in{' '}
              <code className="font-mono text-muted-foreground">.env</code>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helper ────────────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[10px] text-muted-foreground flex-shrink-0">{label}</span>
      <span className="text-[10px] text-foreground font-medium text-right leading-relaxed">{value}</span>
    </div>
  )
}
