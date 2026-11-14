from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, String, Text, func, null, text

from app.core.database import Base


class SurveillanceActivation(Base):
    __tablename__ = "surveillance_activations"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'active', 'rejected', 'retired')", name="ck_surveillance_activations_status"),
        CheckConstraint("approved_by_user_id IS NULL OR approved_by_user_id <> requested_by_user_id",
                        name="ck_surveillance_activations_separate_approver"),
    )

    id = Column(Integer, primary_key=True)
    rule_id = Column(String(32), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    reason = Column(String(255), nullable=False)
    requested_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    approved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, server_default=null())
    status = Column(String(12), nullable=False, server_default=text("'pending'"))
    requested_at = Column(DateTime, nullable=False, server_default=func.now())
    approved_at = Column(DateTime, nullable=True, server_default=null())


class SurveillanceCase(Base):
    __tablename__ = "surveillance_cases"
    __table_args__ = (
        CheckConstraint("status IN ('open', 'closed')", name="ck_surveillance_cases_status"),
        CheckConstraint("disposition IS NULL OR disposition IN ('true_positive', 'false_positive', 'inconclusive')",
                        name="ck_surveillance_cases_disposition"),
        CheckConstraint("closed_by_user_id IS NULL OR closed_by_user_id <> subject_user_id",
                        name="ck_surveillance_cases_no_self_close"),
    )

    id = Column(Integer, primary_key=True)
    rule_id = Column(String(32), nullable=False, index=True)
    rule_version = Column(Integer, nullable=False)
    subject_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    symbol = Column(String(20), nullable=False)
    event_ids = Column(Text, nullable=False)
    summary = Column(String(255), nullable=False)
    status = Column(String(12), nullable=False, server_default=text("'open'"))
    disposition = Column(String(20), nullable=True, server_default=null())
    close_reason = Column(String(255), nullable=True, server_default=null())
    opened_at = Column(DateTime, nullable=False, server_default=func.now())
    due_at = Column(DateTime, nullable=False)
    closed_at = Column(DateTime, nullable=True, server_default=null())
    closed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, server_default=null())
