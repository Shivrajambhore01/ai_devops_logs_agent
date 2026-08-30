from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Integer, Text, ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

class Fix(Base):
    __tablename__ = "fixes"

    id: Mapped[str] = mapped_column(String(50), primary_key=True, index=True)  # FIX-8f2a
    incident_id: Mapped[str] = mapped_column(String(50), ForeignKey("incidents.id"), nullable=False)
    
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    patch_diff: Mapped[str] = mapped_column(Text, nullable=False)
    
    # Sandbox Validation
    tests_passed: Mapped[bool] = mapped_column(Boolean, default=False)
    total_tests: Mapped[int] = mapped_column(Integer, default=0)
    passed_tests: Mapped[int] = mapped_column(Integer, default=0)
    test_output_log: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    risk_level: Mapped[str] = mapped_column(String(20), default="LOW")  # LOW, MEDIUM, HIGH
    
    status: Mapped[str] = mapped_column(String(50), default="PENDING")  # PENDING, APPROVED, REJECTED, APPLIED
    pull_request_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    incident = relationship("Incident", back_populates="fixes")
    approval = relationship("Approval", back_populates="fix", uselist=False)
