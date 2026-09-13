/**
 * AI Provider Audit API
 * Fetches which LLM (Gemini / Ollama-Qwen / Fallback) is powering analyses.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8090'

export interface AIProviderInfo {
  provider: 'gemini' | 'ollama' | 'fallback'
  display_name: string
  model: string
  model_display: string
  type: 'cloud' | 'local'
  icon: 'sparkles' | 'cpu' | 'shield'
  color: string
  base_url: string | null
  description: string
  fallback_chain: string[]
}

let _cached: AIProviderInfo | null = null

export async function fetchAIProvider(): Promise<AIProviderInfo> {
  if (_cached) return _cached
  const res = await fetch(`${API_BASE}/api/v1/ai-provider`, { cache: 'no-store' })
  if (!res.ok) throw new Error('Could not fetch AI provider info')
  _cached = await res.json()
  return _cached!
}

/** Clear the cache so next call re-fetches (useful after .env changes) */
export function clearAIProviderCache() {
  _cached = null
}
