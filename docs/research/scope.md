# Project Scope & Boundaries — AI DevOps Incident Resolution Agent

## 1. System Scope (In-Scope)

### 1.1 Supported Infrastructure & Platforms
- **Version Control**: Git local repositories and GitHub API integration.
- **CI/CD Pipelines**: GitHub Actions workflow runs, jobs, and step log parsing.
- **Containers**: Docker Engine, Docker CLI, Docker Compose services.
- **Application Stack**: Web applications (Python FastAPI, Node.js/Next.js, Go, Java).
- **Databases**: PostgreSQL (system platform DB + RAG vector store) & Redis (caching/locks).
- **AI Models**: Local Ollama (`qwen2.5-coder`, `llama3.2`) and Cloud APIs (Gemini, OpenAI).

### 1.2 Supported Incident Scenarios
1. **Missing / Misconfigured Environment Variables** (e.g., `DATABASE_URL` missing after deploy).
2. **Dependency Conflicts & Incompatibilities** (e.g., broken package version in `requirements.txt` or `package.json`).
3. **Unhandled Application Runtime Exceptions** (e.g., `NullPointerException`, `KeyError`, DB connection failure).
4. **Docker Container & Build Failures** (e.g., missing dependency in `Dockerfile`, entrypoint script crash, exit code 1).
5. **Regression & Failed Unit Tests** (e.g., breaking API contract introduced in recent commit).

---

## 2. Out-of-Scope (Deferred / Excluded for MVP)

To ensure high-quality delivery within project constraints, the following components are explicitly **out of scope** for the initial version:

- **Kubernetes / Helm / Cloud Clusters**: Initial scope focuses on Docker and Docker Compose.
- **Jenkins / GitLab CI Pipelines**: Initial scope focuses on GitHub Actions.
- **Direct Production Auto-Deployment**: Fixes must be submitted as Pull Requests requiring explicit human approval; direct production auto-deployment without approval is prohibited.
- **Unrestricted Shell Execution**: The AI agent will not be given arbitrary `os.system` execution privileges.
- **Paid SaaS Vector Databases**: RAG implementation will use `pgvector` inside the local PostgreSQL instance.

---

## 3. Assumptions & Dependencies

1. **Development Environment**: Developer machine running Windows / Linux / macOS with Docker Desktop installed.
2. **Repository Access**: Read access to target repository via GitHub Personal Access Token (PAT) or local Git clone.
3. **Local Tooling**: Python 3.12, Node.js 22, Git, and Docker available in system PATH.
