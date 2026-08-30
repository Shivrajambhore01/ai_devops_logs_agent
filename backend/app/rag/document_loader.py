from typing import List, Dict, Any

RUNBOOKS = [
    {
        "title": "MongoDB & Database Connection Troubleshooting",
        "category": "database",
        "content": (
            "When a service fails with MongoServerSelectionError or missing database URI: "
            "1. Verify that MONGODB_URI or DATABASE_URL environment variable is set in deployment config. "
            "2. Ensure database container is running and healthy. "
            "3. Add missing environment variable to deployment pipeline configuration."
        )
    },
    {
        "title": "TypeScript TypeError & Null Address Guard Runbook",
        "category": "application_crash",
        "content": (
            "When encountering TypeError: Cannot read property of undefined in tax/address processing: "
            "1. Inspect recent commits to verify schema changes in user address objects. "
            "2. Add defensive null guards (if (!user || !user.address) return 0;) to prevent crash on legacy address data. "
            "3. Run unit tests src/tax/calculate.test.ts to verify fix."
        )
    },
    {
        "title": "Dependency Conflict & Build Failures",
        "category": "ci_cd",
        "content": (
            "When npm or pip dependencies fail during Docker build: "
            "1. Check package.json or requirements.txt for incompatible package versions in recent commit diff. "
            "2. Revert problematic package version or update package lockfile."
        )
    }
]

def load_default_runbooks() -> List[Dict[str, Any]]:
    """Return default operational runbooks."""
    return RUNBOOKS
