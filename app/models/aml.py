from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, Numeric, String, Text, func, null, text

from app.core.database import Base


class SanctionsScreen(Base):
    __tablename__ = "sanctions_screens"
    __table_args__ = (
        CheckConstraint("context IN ('onboarding', 'payout')", name="ck_sanctions_screens_context"),
        CheckConstraint("decision IN ('clear', 'blocked', 'provider_error')", name="ck_sanctions_screens_decision"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    subject_name = Column(String(255), nullable=False)
    context = Column(String(16), nullable=False)
    decision = Column(String(16), nullable=False)
    source = Column(String(16), nullable=False)
    matched_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class CashMovement(Base):
    __tablename__ = "cash_movements"
    __table_args__ = (
        CheckConstraint("kind IN ('deposit', 'withdrawal')", name="ck_cash_movements_kind"),
        CheckConstraint("amount > 0", name="ck_cash_movements_amount"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    kind = Column(String(16), nullable=False)
    amount = Column(Numeric(18, 2), nullable=False)
    screening_id = Column(Integer, ForeignKey("sanctions_screens.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class AmlActivation(Base):
    __tablename__ = "aml_activations"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'active', 'rejected', 'retired')", name="ck_aml_activations_status"),
        CheckConstraint("approved_by_user_id IS NULL OR approved_by_user_id <> requested_by_user_id",
                        name="ck_aml_activations_separate_approver"),
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


class AmlCase(Base):
    __tablename__ = "aml_cases"
    __table_args__ = (
        CheckConstraint("status IN ('open', 'closed')", name="ck_aml_cases_status"),
        CheckConstraint("disposition IS NULL OR disposition IN ('true_positive', 'false_positive', 'inconclusive')",
                        name="ck_aml_cases_disposition"),
        CheckConstraint("closed_by_user_id IS NULL OR closed_by_user_id <> subject_user_id",
                        name="ck_aml_cases_no_self_close"),
    )

    id = Column(Integer, primary_key=True)
    rule_id = Column(String(32), nullable=False, index=True)
    rule_version = Column(Integer, nullable=False)
    subject_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    event_ids = Column(Text, nullable=False)
    summary = Column(String(255), nullable=False)
    status = Column(String(12), nullable=False, server_default=text("'open'"))
    disposition = Column(String(20), nullable=True, server_default=null())
    close_reason = Column(String(255), nullable=True, server_default=null())
    opened_at = Column(DateTime, nullable=False, server_default=func.now())
    due_at = Column(DateTime, nullable=False)
    closed_at = Column(DateTime, nullable=True, server_default=null())
    closed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, server_default=null())


class Incident(Base):
    __tablename__ = "incidents"
    __table_args__ = (
        CheckConstraint("severity IN ('low', 'moderate', 'high')", name="ck_incidents_severity"),
        CheckConstraint("status IN ('open', 'closed')", name="ck_incidents_status"),
        CheckConstraint("notified_by_user_id IS NULL OR notified_by_user_id <> opened_by_user_id",
                        name="ck_incidents_separate_notice"),
        CheckConstraint("closed_by_user_id IS NULL OR closed_by_user_id <> opened_by_user_id",
                        name="ck_incidents_separate_close"),
    )

    id = Column(Integer, primary_key=True)
    title = Column(String(255), nullable=False)
    severity = Column(String(16), nullable=False)
    status = Column(String(12), nullable=False, server_default=text("'open'"))
    summary = Column(String(255), nullable=False)
    discovered_at = Column(DateTime, nullable=False)
    customer_notice_due_at = Column(DateTime, nullable=False)
    customer_notified_at = Column(DateTime, nullable=True, server_default=null())
    opened_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    notified_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, server_default=null())
    closed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, server_default=null())
    closed_at = Column(DateTime, nullable=True, server_default=null())
