/**
 * WebSocket hook for Docker container stream sessions.
 * Handles connection lifecycle, heartbeat, auto-reconnect, and sequence resume.
 * Emits: onLine (log line), onErrorDetected (structured error), onAISummary (AI analysis complete)
 */
'use client'
import { useEffect, useRef, useCallback } from 'react'
import { buildStreamWsUrl } from '@/lib/docker-api'

export interface DockerLogLine {
  id: string
  session_id: string
  seq?: number
  timestamp: string
  container?: string
  level: 'INFO' | 'WARN' | 'ERROR' | 'AI' | 'DEBUG'
  message: string
  event_type: string
}

export interface DockerErrorEvent {
  id: string
  error_id: string
  session_id: string
  container_id: string
  container_name: string
  language?: string
  error_type?: string
  error_message: string
  file_path?: string
  line_number?: number
  raw_stack_trace?: string
  severity: string
  timestamp: string
}

export interface DockerAIEvent {
  error_id: string
  title: string
  what_happened: string
  why_it_happened: string
  recommended_fix: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  confidence: number
  suggested_commands: string[]
  timestamp: string
}

interface UseDockerStreamOptions {
  sessionId?: string
  onLine: (line: DockerLogLine) => void
  onErrorDetected?: (error: DockerErrorEvent) => void
  onAISummary: (summary: DockerAIEvent) => void
  onStatusChange?: (status: string) => void
}

export function useDockerStream({
  sessionId,
  onLine,
  onErrorDetected,
  onAISummary,
  onStatusChange,
}: UseDockerStreamOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const lastSeqRef = useRef<number | null>(null)
  const MAX_RECONNECTS = 5
  const closedRef = useRef(false)

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
  }, [])

  const connect = useCallback(() => {
    if (closedRef.current) return
    const url = buildStreamWsUrl(sessionId, lastSeqRef.current)
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      reconnectAttemptsRef.current = 0
      onStatusChange?.('CONNECTED')
      // Heartbeat every 20s
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping')
      }, 20_000)
    }

    ws.onmessage = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data as string)
        if (typeof data.seq === 'number') {
          lastSeqRef.current = data.seq
        }

        if (data.event_type === 'AI_ANALYSIS_COMPLETED' && data.ai_summary) {
          onAISummary(data.ai_summary as DockerAIEvent)
        } else if (data.event_type === 'ERROR_DETECTED' && data.error) {
          onErrorDetected?.(data.error as DockerErrorEvent)
        } else if (data.event_type !== 'HEARTBEAT') {
          onLine(data as DockerLogLine)
        }
      } catch {
        // Non-JSON ping messages
      }
    }

    ws.onerror = () => onStatusChange?.('ERROR')

    ws.onclose = () => {
      stopHeartbeat()
      if (!closedRef.current && reconnectAttemptsRef.current < MAX_RECONNECTS) {
        reconnectAttemptsRef.current++
        const delay = 1500 * reconnectAttemptsRef.current
        onStatusChange?.(`RECONNECTING (${reconnectAttemptsRef.current}/${MAX_RECONNECTS})`)
        setTimeout(connect, delay)
      } else {
        onStatusChange?.('DISCONNECTED')
      }
    }
  }, [sessionId, onLine, onErrorDetected, onAISummary, onStatusChange, stopHeartbeat])

  useEffect(() => {
    closedRef.current = false
    connect()
    return () => {
      closedRef.current = true
      stopHeartbeat()
      wsRef.current?.close()
    }
  }, [connect, stopHeartbeat])
}
