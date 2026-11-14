from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.access_review import AccessReview
from app.models.role_change import RoleChange
from app.models.user import User


def current_review_period(now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    return f"{now.year}-Q{(now.month - 1) // 3 + 1}"


def check_access_reviews(db: Session, now: datetime | None = None) -> dict:
    period = current_review_period(now)
    users = db.execute(select(User).order_by(User.id)).scalars().all()
    role_versions = dict(db.execute(select(RoleChange.user_id, func.max(RoleChange.id)).group_by(RoleChange.user_id)).all())
    reviews = db.execute(select(AccessReview).where(AccessReview.period == period).order_by(AccessReview.id.desc())).scalars().all()
    latest = {review.user_id: review for review in reversed(reviews)}
    violations = []
    for user in users:
        review = latest.get(user.id)
        if (review is None or review.observed_role != user.role
                or review.observed_change_id != role_versions.get(user.id)
                or review.reviewer_user_id == user.id):
            violations.append(user.id)
    return {"checked": len(users), "period": period, "violation_count": len(violations),
            "unreviewed_user_ids": violations[:20]}
