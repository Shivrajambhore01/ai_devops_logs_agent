export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved'

export type EvidenceItem = {
  id: string
  source: string
  label: string
  detail: string
}

export type Incident = {
  id: string
  title: string
  service: string
  repository: string
  severity: Severity
  status: IncidentStatus
  age: string
  confidence: number
  description: string
  rootCause: string
  deployment: string
  commitSha: string
  assignee: string
  evidenceItems: EvidenceItem[]
}

export type NavKey = 'overview' | 'incidents' | 'repositories' | 'deployments' | 'agent' | 'logs' | 'terminal' | 'docker' | 'settings'

export type Activity = {
  time: string
  label: string
  detail: string
  type: 'success' | 'active' | 'neutral' | 'warning'
}

export type Deployment = {
  id: string
  repo: string
  branch: string
  status: 'passed' | 'failed' | 'running'
  duration: string
  commit: string
  time: string
  actor: string
}

export type LogLine = {
  time: string
  level: 'INFO' | 'WARN' | 'ERROR'
  service: string
  message: string
}

export type Repository = {
  name: string
  language: string
  branch: string
  commit: string
  status: 'healthy' | 'degraded'
  deploys: number
  lastDeploy: string
}

export type FixState = 'pending' | 'approved' | 'rejected'
