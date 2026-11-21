from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, Text

from app.core.database import Base


class NightHoldingNote(Base):
    __tablename__ = "night_holding_notes"
    __table_args__ = (
        CheckConstraint("length(text) BETWEEN 1 AND 2000", name="ck_night_holding_note_text_length"),
    )

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), primary_key=True)
    text = Column(Text, nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)
