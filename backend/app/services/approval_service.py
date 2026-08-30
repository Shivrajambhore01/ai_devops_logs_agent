from typing import Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.fix import Fix
from app.models.incident import Incident
from app.models.approval import Approval
from app.models.audit_log import AuditLog
from app.tools.github import create_pull_request

class ApprovalWorkflowService:
    """Handles human approval workflow, audit logging, and PR creation."""

    async def process_decision(
        self,
        db: AsyncSession,
        fix_id: str,
        decision: str,  # APPROVED or REJECTED
        user_id: int = 1,
        user_email: str = "maya@acme.com",
        user_token: Optional[str] = None,
        comments: Optional[str] = None
    ) -> Dict[str, Any]:
        # 1. Fetch Fix
        result = await db.execute(select(Fix).where(Fix.id == fix_id))
        fix = result.scalar_one_or_none()
        if not fix:
            raise ValueError(f"Fix {fix_id} not found.")

        # 2. Update Fix status
        fix.status = "APPROVED" if decision == "APPROVED" else "REJECTED"
        
        # 3. Create Approval record
        approval = Approval(
            fix_id=fix.id,
            user_id=user_id,
            decision=decision,
            comments=comments
        )
        db.add(approval)

        # 4. If approved, create Pull Request & resolve incident
        pr_url = None
        if decision == "APPROVED":
            pr_res = create_pull_request(
                owner="acme",
                repo_name="checkout-api",
                title=f"[AI-FIX] {fix.title}",
                body=f"Automated Fix for Incident {fix.incident_id}\n\n{fix.description}\n\nTests: {fix.passed_tests}/{fix.total_tests} PASS",
                head_branch=f"fix/{fix.id.lower()}",
                token=user_token
            )
            pr_url = pr_res.get("pr_url")
            fix.pull_request_url = pr_url

            # Update Incident to RESOLVED
            inc_result = await db.execute(select(Incident).where(Incident.id == fix.incident_id))
            inc = inc_result.scalar_one_or_none()
            if inc:
                inc.status = "RESOLVED"

        # 5. Create Audit Log entry
        audit = AuditLog(
            user_id=user_id,
            actor=user_email,
            action=f"FIX_{decision}",
            target_type="fix",
            target_id=fix.id,
            details_json={"comments": comments, "pr_url": pr_url}
        )
        db.add(audit)

        await db.commit()
        await db.refresh(fix)

        return {
            "fix_id": fix.id,
            "decision": decision,
            "status": fix.status,
            "pull_request_url": pr_url,
            "incident_status": "RESOLVED" if decision == "APPROVED" else "INVESTIGATING"
        }

approval_service = ApprovalWorkflowService()
