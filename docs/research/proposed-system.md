# Proposed System Architecture Overview — AI DevOps Incident Resolution Agent

## 1. High-Level System Concept

The **AI DevOps Incident Resolution Agent** operates as an autonomous operational partner. When an incident occurs, the platform automatically initiates an investigation workflow, aggregates diagnostic data across tools, identifies the root cause, generates a unified patch, runs tests in a sandbox environment, and presents a comprehensive fix package to engineers for approval.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          1. TRIGGER & INGESTION                             │
│ GitHub Webhook (CI Failure) / Manual Incident Creation → FastAPI Ingestion │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       2. LANGGRAPH AGENT ORCHESTRATION                      │
│                                                                             │
│   Planner Agent ──► Investigator Agent ──► Evidence Correlation Engine      │
│                            │                         │                      │
│                            ▼                         ▼                      │
│                    Controlled Tools          Root Cause Analyzer            │
│                     (Git, Docker,                    │                      │
│                      Logs, CI/CD)                    ▼                      │
│                                              Fix Generator Node             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       3. SANDBOX VALIDATION & AUDIT                         │
│ Isolated Docker Container ──► Apply Patch ──► Run Tests ──► Audit Log Entry │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       4. HUMAN APPROVAL & PR MERGE                          │
│ Next.js Dashboard Diff View ──► Engineer Approves ──► Create GitHub PR       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Design Summary

### 2.1 Web Dashboard (Next.js 16)
- **Command Center Dashboard**: Overview of system health, active incidents, recent deployments, and agent confidence metrics.
- **Incident Investigation Page**: Live activity stream showing real-time agent tool invocations, evidence items with citations, root cause summary, and affected service status.
- **Fix & Diff Viewer**: Side-by-side Git diff viewer with automated test verification status and one-click `Approve` / `Reject` actions.

### 2.2 API & Control Server (FastAPI)
- **REST Endpoints**: Secure management of incidents, repositories, agent runs, fixes, and user authentication.
- **Webhook Handlers**: Async processing of GitHub Actions pipeline events.
- **WebSocket Gateway**: Streaming agent reasoning logs and tool invocation events to the web UI.

### 2.3 Agent Orchestration Engine (LangGraph)
- **State Graph Architecture**: Manages context, evidence history, execution plan, hypotheses, fix patches, and test outcomes.
- **Controlled Tool Registry**: Permissioned wrappers around Git, GitHub API, Docker CLI, and Log Parser.

### 2.4 Data & Knowledge Storage (PostgreSQL + pgvector)
- Relational schema for incidents, agent runs, tool logs, fixes, and audit trails.
- Vector storage for operational runbooks and repository documentation using `pgvector`.

---

## 3. Phase 1 Deliverables Summary

With Phase 1 complete, the project definition, objectives, quantitative metrics, system boundaries, and architectural concept are fully frozen in the repository under `docs/research/`:

1. [`docs/research/problem-statement.md`](file:///c:/Users/Shivraj/Downloads/ai-dev-ops-agent/docs/research/problem-statement.md)
2. [`docs/research/objectives.md`](file:///c:/Users/Shivraj/Downloads/ai-dev-ops-agent/docs/research/objectives.md)
3. [`docs/research/scope.md`](file:///c:/Users/Shivraj/Downloads/ai-dev-ops-agent/docs/research/scope.md)
4. [`docs/research/proposed-system.md`](file:///c:/Users/Shivraj/Downloads/ai-dev-ops-agent/docs/research/proposed-system.md)
