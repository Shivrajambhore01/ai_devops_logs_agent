/**
 * Global Zustand store for Docker Monitor.
 * Holds live errors detected across all containers with smart deduplication.
 * Completely separate from any GitHub or incident state.
 */
import { create } from 'zustand'

export interface LiveDockerError {
  error_id: string           // matches NormalizedError.id from backend (e.g. err_...)
  container_id: string
  container_name: string
  error_type?: string
  error_message?: string
  raw_message: string        // descriptive error message
  file_path?: string
  line_number?: number
  raw_stack_trace?: string
  timestamp: string
  last_seen?: string
  occurrences?: number       // count of duplicate occurrences
  summary?: {
    title: string
    what_happened: string
    why_it_happened: string
    recommended_fix: string
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    confidence: number
    suggested_commands: string[]
  }
}

interface DockerErrorStore {
  errors: LiveDockerError[]
  unseenCount: number

  /** Add a new error from live stream with fingerprint deduplication. */
  addError: (entry: LiveDockerError) => void

  /** Attach the AI summary to an existing error entry by error_id. */
  attachSummary: (
    error_id: string,
    summary: NonNullable<LiveDockerError['summary']>,
    meta?: { container_id?: string; container_name?: string }
  ) => void

  /** Load historical errors from the database (called on page mount). */
  loadHistory: (entries: LiveDockerError[]) => void

  /** Mark all as seen (resets the badge counter). */
  markSeen: () => void

  /** Remove all errors from store. */
  clear: () => void
}

function getErrorFingerprint(e: Partial<LiveDockerError>): string {
  const container = (e.container_name || e.container_id || 'unknown').toLowerCase()
  const errType = (e.error_type || 'error').toLowerCase()
  const msg = (e.error_message || e.raw_message || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 100)
    .trim()
  return `${container}|${errType}|${msg}`
}

export const useDockerErrorStore = create<DockerErrorStore>((set) => ({
  errors: [],
  unseenCount: 0,

  addError: (entry) =>
    set((state) => {
      const entryKey = getErrorFingerprint(entry)
      const existingIdx = state.errors.findIndex(
        (e) => e.error_id === entry.error_id || getErrorFingerprint(e) === entryKey
      )

      if (existingIdx !== -1) {
        // Repeat of existing error: increment count, update timestamp, keep list deduplicated
        const existing = state.errors[existingIdx]
        const updatedErrors = [...state.errors]
        updatedErrors[existingIdx] = {
          ...existing,
          last_seen: entry.timestamp || new Date().toISOString(),
          occurrences: (existing.occurrences || 1) + 1,
          raw_stack_trace: entry.raw_stack_trace || existing.raw_stack_trace,
          summary: existing.summary || entry.summary,
        }
        return {
          errors: updatedErrors,
          unseenCount: state.unseenCount + 1,
        }
      }

      // New unique error: add to top of list
      const newEntry: LiveDockerError = {
        ...entry,
        occurrences: 1,
        last_seen: entry.timestamp || new Date().toISOString(),
      }

      return {
        errors: [newEntry, ...state.errors].slice(0, 300),
        unseenCount: state.unseenCount + 1,
      }
    }),

  attachSummary: (error_id, summary, meta) =>
    set((state) => {
      // 1. Direct error_id match
      let matched = false
      let newErrors = state.errors.map((e) => {
        if (e.error_id === error_id) {
          matched = true
          return {
            ...e,
            summary,
            container_name: (meta?.container_name && meta.container_name !== 'container') ? meta.container_name : e.container_name,
            container_id: (meta?.container_id && meta.container_id !== 'container') ? meta.container_id : e.container_id,
          }
        }
        return e
      })

      // 2. If no direct match, match the most recent un-summarized error
      if (!matched && state.errors.length > 0) {
        const unsummarizedIdx = state.errors.findIndex((e) => !e.summary)
        if (unsummarizedIdx !== -1) {
          newErrors = [...state.errors]
          newErrors[unsummarizedIdx] = {
            ...newErrors[unsummarizedIdx],
            error_id,
            summary,
            container_name: (meta?.container_name && meta.container_name !== 'container') ? meta.container_name : newErrors[unsummarizedIdx].container_name,
            container_id: (meta?.container_id && meta.container_id !== 'container') ? meta.container_id : newErrors[unsummarizedIdx].container_id,
          }
          matched = true
        }
      }

      // 3. If still not matched, add a new error item with this summary
      if (!matched) {
        const fallbackEntry: LiveDockerError = {
          error_id,
          container_id: meta?.container_id || 'container',
          container_name: meta?.container_name || 'container',
          raw_message: summary.title,
          timestamp: new Date().toISOString(),
          occurrences: 1,
          summary,
        }
        newErrors = [fallbackEntry, ...state.errors].slice(0, 300)
      }

      return { errors: newErrors }
    }),

  loadHistory: (entries) =>
    set((state) => {
      const existingFingerprints = new Set(state.errors.map(getErrorFingerprint))
      const existingIds = new Set(state.errors.map((e) => e.error_id))

      const newEntries = entries.filter(
        (e) => !existingIds.has(e.error_id) && !existingFingerprints.has(getErrorFingerprint(e))
      )

      return {
        errors: [...state.errors, ...newEntries].slice(0, 300),
      }
    }),

  markSeen: () => set({ unseenCount: 0 }),
  clear: () => set({ errors: [], unseenCount: 0 }),
}))
