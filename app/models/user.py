from sqlalchemy import CheckConstraint, Column, DateTime, Index, Integer, JSON, Numeric, String, func, null, text
from app.core.database import Base


ROLES = ("trader", "analyst", "compliance_officer", "admin", "auditor")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("cash_balance >= 0", name="ck_users_cash_nonnegative"),
        CheckConstraint("role IN ('trader', 'analyst', 'compliance_officer', 'admin', 'auditor')", name="ck_users_role_valid"),
        CheckConstraint("demo_seed IS NULL OR role = 'trader'", name="ck_users_demo_trader"),
        CheckConstraint("demo_archived_at IS NULL OR demo_seed IS NOT NULL", name="ck_users_demo_archive"),
        Index("ix_users_demo_created_at", "created_at", postgresql_where=text("demo_seed IS NOT NULL")),
    )

    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    role = Column(String(24), nullable=False, server_default=text("'trader'"))
    cash_balance = Column(Numeric(18, 2), nullable=False, default=100000)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    demo_seed = Column(JSON(none_as_null=True), nullable=True)
    demo_archived_at = Column(DateTime, nullable=True, server_default=null())

    @property
    def is_demo(self) -> bool:
        return self.demo_seed is not None

    @property
    def display_name(self) -> str | None:
        return self.demo_seed["display_name"] if self.is_demo else None

    @property
    def demo_seed_mode(self) -> str | None:
        return self.demo_seed["mode"] if self.is_demo else None
