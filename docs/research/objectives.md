# Objectives & Goals — AI DevOps Incident Resolution Agent

## 1. Primary Objectives

The primary goal of this project is to build an autonomous, agentic AI-powered DevOps platform that reduces MTTD and MTTR by automating incident investigation, root cause analysis, fix generation, and sandbox testing, while maintaining strict human-in-the-loop governance.

---

## 2. Quantitative Targets

| Metric | Target Goal | Baseline Manual Process |
| :--- | :--- | :--- |
| **Investigation Time** | < 3 minutes | 15–45 minutes |
| **Root Cause Accuracy** | > 90% across standard scenarios | Variable by engineer expertise |
| **Fix Validation Rate** | 100% pre-approval sandbox verification | Manual local testing |
| **Human Governance** | 100% human-in-the-loop for write operations | N/A |
| **Zero Production Cost** | 100% runnable locally with free tools/models | High enterprise SaaS cost |

---

## 3. Key Milestones & Capabilities

### 3.1 Autonomous Multi-Source Data Collection
- Connect to GitHub API for commits, diffs, branches, pull requests, and workflow runs.
- Collect Docker container metrics, status codes, health checks, and log streams.
- Parse application log streams to isolate unhandled exceptions and stack traces.

### 3.2 Agentic Orchestration with LangGraph
- Implement a state-graph agent architecture featuring specialized roles:
  - **Planner Agent**: Formulates systematic investigation steps based on initial alert signals.
  - **Investigator Agent**: Dynamically invokes controlled data collection tools.
  - **Evidence Analyzer**: Synthesizes collected data into correlated evidence items.
  - **Root Cause Analyzer**: Formulates diagnostic hypothesis with confidence scoring.
  - **Fix Generator**: Produces unified Git patch diffs addressing the root cause.
  - **Test Agent**: Manages execution inside an isolated Docker sandbox container.
  - **Reviewer Agent**: Evaluates fix safety, risk score, and presents diff for human approval.

### 3.3 Strict Security & Controlled Execution
- Zero direct shell execution for the LLM; all external interactions occur through explicit Pydantic-validated tool schemas.
- Granular permission classification (`READ`, `WRITE`, `HIGH RISK`).
- Mandatory human approval before pushing code, opening pull requests, or deploying fixes.

### 3.4 Reproducible Demonstration Lab
- Provide 5 pre-packaged incident scenarios (missing environment variables, dependency conflicts, unhandled exceptions, Docker build failures, failed unit tests).
- Enable live demonstration without requiring paid cloud infrastructure or external SaaS API dependencies.
