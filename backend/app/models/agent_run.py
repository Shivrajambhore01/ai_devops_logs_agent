from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Integer, Text, ForeignKey, JSON, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

class AgentRun(Base):
    __tablename__ = "agent_runs"

    id: Mapped[str] = mapped_column(String(50), primary_key=True, index=True)  # AGT-7782
    incident_id: Mapped[str] = mapped_column(String(50), ForeignKey("incidents.id"), nullable=False)
    
    status: Mapped[str] = mapped_column(String(50), default="RUNNING")  # RUNNING, COMPLETED, FAILED
    current_step: Mapped[str] = mapped_column(String(100), default="planning")
    tools_called_count: Mapped[int] = mapped_column(Integer, default=0)
    evidence_count: Mapped[int] = mapped_column(Integer, default=0)
    confidence_score: Mapped[float] = mapped_column(Float, default=0.0)
    
    execution_plan: Mapped[dict] = mapped_column(JSON, default=[])
    reasoning_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    incident = relationship("Incident", back_populates="agent_runs")
    tool_calls = relationship("ToolCall", back_populates="agent_run")

class ToolCall(Base):
    __tablename__ = "tool_calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    agent_run_id: Mapped[str] = mapped_column(String(50), ForeignKey("agent_runs.id"), nullable=False)
    
    tool_name: Mapped[str] = mapped_column(String(100), nullable=False)
    arguments_json: Mapped[dict] = mapped_column(JSON, default={})
    output_summary: Mapped[str] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="SUCCESS")  # SUCCESS, FAILED
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    agent_run = relationship("AgentRun", back_populates="tool_calls")
