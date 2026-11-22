from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, ForeignKeyConstraint, Index, Integer, JSON, Text, UniqueConstraint, func

from app.core.database import Base
from app.models.order import Order


# The receipt-owner key lets PostgreSQL enforce ownership on the journal FK.
Order.__table__.append_constraint(UniqueConstraint("id", "user_id", name="uq_orders_night_journal_owner"))


class NightJournalEntry(Base):
    __tablename__ = "night_journal_entries"
    __table_args__ = (
        ForeignKeyConstraint(
            ["order_id", "user_id"], ["orders.id", "orders.user_id"],
            ondelete="CASCADE", name="fk_night_journal_owned_order",
        ),
        UniqueConstraint("user_id", "order_id", name="uq_night_journal_owned_order"),
        CheckConstraint("length(note) BETWEEN 1 AND 2000", name="ck_night_journal_note"),
        CheckConstraint("json_array_length(tags) <= 5", name="ck_night_journal_tags"),
        Index("ix_night_journal_owner_page", "user_id", "id"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    order_id = Column(Integer, nullable=False)
    note = Column(Text, nullable=False)
    tags = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
