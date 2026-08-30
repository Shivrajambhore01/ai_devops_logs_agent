/**
 * Auto-connects to all running Docker containers on mount.
 * Performs a single fast request to connect and start log streams.
 * Renders container panels instantly without waiting for error history.
 */
'use client'
import { useState, useEffect } from 'react'
import {
  autoConnectContainers,
  fetchDockerErrors,
  DockerContainer,
} from '@/lib/docker-api'
import { useDockerErrorStore, LiveDockerError } from '@/store/dockerErrorStore'

export interface ConnectedContainer extends DockerContainer {
  sessionId: string
}

export function useDockerAutoConnect() {
  const [containers, setContainers] = useState<ConnectedContainer[]>([])
  const [allContainers, setAllContainers] = useState<DockerContainer[]>([])
  const [isConnecting, setIsConnecting] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { loadHistory } = useDockerErrorStore()

  useEffect(() => {
    let mounted = true

    ;(async () => {
      try {
        setIsConnecting(true)
        setError(null)

        // Single instant request: gets running containers and session IDs
        const res = await autoConnectContainers()
        if (!mounted) return

        const allC = res.containers || []
        const sessionMap = res.sessions || {}

        setAllContainers(allC)

        const connected: ConnectedContainer[] = allC
          .filter((c) => c.status === 'running' && sessionMap[c.id])
          .map((c) => ({ ...c, sessionId: sessionMap[c.id] }))

        setContainers(connected)
        setIsConnecting(false) // Render containers instantly!

        // Load error history asynchronously in background
        fetchDockerErrors({ limit: 100 })
          .then((history) => {
            if (!mounted) return
            const entries: LiveDockerError[] = history.map((h) => ({
              error_id:       h.error.id,
              container_id:   h.error.container_id,
              container_name: h.error.container_name,
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
          })
          .catch(() => {})
      } catch (err: any) {
        if (mounted) {
          setError(err.message || 'Failed to connect to Docker')
          setIsConnecting(false)
        }
      }
    })()

    return () => {
      mounted = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { containers, allContainers, isConnecting, error }
}
