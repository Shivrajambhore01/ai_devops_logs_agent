/**
 * WebSocket client wrapper for terminal streaming.
 * Manages persistent connection lifecycle with auto-reconnect.
 */

export interface TerminalLine {
  id: string
  session_id: string
  timestamp: string
  source: 'local' | 'docker'
  container?: string
  stream: 'stdout' | 'stderr'
  level: 'INFO' | 'WARN' | 'ERROR' | 'AI' | 'DEBUG'
  message: string
  event_type: string
  metadata?: Record<string, unknown>
}

export interface AIErrorSummary {
  error_id: string
  session_id: string
  title: string
  what_happened: string
  why_it_happened: string
  recommended_fix: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  confidence: number
  suggested_commands: string[]
  timestamp: string
}

export interface TerminalSession {
  session_id: string
  status: 'STARTING' | 'RUNNING' | 'EXITED' | 'STOPPED' | 'ERROR' | 'STREAMING'
  command?: string
  working_dir?: string
}

export type TerminalEventHandler = (line: TerminalLine) => void
export type AIAnalysisHandler = (summary: AIErrorSummary) => void

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || 'ws://127.0.0.1:8090'

export class TerminalWebSocketClient {
  private ws: WebSocket | null = null
  private sessionId: string
  private onLine: TerminalEventHandler
  private onAISummary: AIAnalysisHandler
  private onStatusChange?: (status: string) => void
  private reconnectAttempts = 0
  private maxReconnects = 5
  private reconnectDelay = 2000
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private closed = false

  constructor(
    sessionId: string,
    onLine: TerminalEventHandler,
    onAISummary: AIAnalysisHandler,
    onStatusChange?: (status: string) => void,
  ) {
    this.sessionId = sessionId
    this.onLine = onLine
    this.onAISummary = onAISummary
    this.onStatusChange = onStatusChange
  }

  connect(): void {
    if (this.closed) return
    const url = `${WS_BASE}/api/v1/terminal/ws/${this.sessionId}`
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      this.onStatusChange?.('CONNECTED')
      this._startHeartbeat()
    }

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        if (data.event_type === 'AI_ANALYSIS_COMPLETED' && data.ai_summary) {
          this.onAISummary(data.ai_summary as AIErrorSummary)
        } else if (data.event_type !== 'HEARTBEAT') {
          this.onLine(data as TerminalLine)
        }
      } catch {
        // Non-JSON ping response ignored
      }
    }

    this.ws.onerror = () => {
      this.onStatusChange?.('ERROR')
    }

    this.ws.onclose = () => {
      this._stopHeartbeat()
      if (!this.closed && this.reconnectAttempts < this.maxReconnects) {
        this.reconnectAttempts++
        this.onStatusChange?.(`RECONNECTING (${this.reconnectAttempts}/${this.maxReconnects})`)
        setTimeout(() => this.connect(), this.reconnectDelay * this.reconnectAttempts)
      } else {
        this.onStatusChange?.('DISCONNECTED')
      }
    }
  }

  private _startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('ping')
      }
    }, 20000)
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  disconnect(): void {
    this.closed = true
    this._stopHeartbeat()
    this.ws?.close()
    this.ws = null
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}
