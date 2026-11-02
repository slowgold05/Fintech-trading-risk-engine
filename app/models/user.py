from sqlalchemy import CheckConstraint, Column, Integer, String, DateTime, Numeric, func, text
from app.core.database import Base


ROLES = ("trader", "analyst", "compliance_officer", "admin", "auditor")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("cash_balance >= 0", name="ck_users_cash_nonnegative"),
        CheckConstraint("role IN ('trader', 'analyst', 'compliance_officer', 'admin', 'auditor')", name="ck_users_role_valid"),
    )

    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(24), nullable=False, server_default=text("'trader'"))
    cash_balance = Column(Numeric(18, 2), nullable=False, default=100000)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
