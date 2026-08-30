from datetime import datetime
from sqlalchemy import String, DateTime, Integer, Text, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

class Evidence(Base):
    __tablename__ = "evidence"

    id: Mapped[str] = mapped_column(String(50), primary_key=True, index=True)  # EV-101
    incident_id: Mapped[str] = mapped_column(String(50), ForeignKey("incidents.id"), nullable=False)
    
    source: Mapped[str] = mapped_column(String(50), nullable=False)  # github, docker, logs, ci, git
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[dict] = mapped_column(JSON, default={})
    
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    incident = relationship("Incident", back_populates="evidence_items")
