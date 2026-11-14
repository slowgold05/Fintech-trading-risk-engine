from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, String, Text, func

from app.core.database import Base


class SarDraft(Base):
    __tablename__ = "sar_drafts"
    __table_args__ = (
        CheckConstraint("case_kind IN ('surveillance', 'aml')", name="ck_sar_drafts_kind"),
    )

    id = Column(Integer, primary_key=True)
    case_kind = Column(String(16), nullable=False)
    case_id = Column(Integer, nullable=False)
    event_ids = Column(Text, nullable=False)
    narrative = Column(Text, nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
