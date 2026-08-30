# Frontend architecture

The runnable Next.js frontend currently lives at the repository root (`app/`, `components/`, and `lib/`) so the Vercel preview continues to work without a nested build configuration.

This directory mirrors the target production layout from the architecture plan. UI modules can be moved here when the project is split into independent frontend and backend packages.

- `app/` — route groups and page entrypoints
- `components/` — layout, dashboard, incidents, agents, repositories, deployments, logs, fixes, approvals, integrations, and UI primitives
- `hooks/` — client data and interaction hooks
- `lib/` — API clients, formatting, permissions, and shared utilities
- `types/` — domain types
- `tests/` — component, hook, and page tests
