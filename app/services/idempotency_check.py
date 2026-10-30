from sqlalchemy import func, inspect, select
from sqlalchemy.orm import Session

from app.models.order_request import OrderRequest


def check_idempotency_records(db: Session) -> dict:
    constraints = inspect(db.get_bind()).get_unique_constraints("order_requests")
    unique = any(set(item["column_names"]) == {"user_id", "idempotency_key"} for item in constraints)
    checked = db.execute(select(func.count()).select_from(OrderRequest)).scalar_one()
    incomplete = db.execute(select(func.count()).select_from(OrderRequest)
                            .where(OrderRequest.response.is_(None))).scalar_one()
    return {"checked": checked, "unique_constraint": unique,
            "violation_count": incomplete + (0 if unique else 1), "incomplete_count": incomplete}
