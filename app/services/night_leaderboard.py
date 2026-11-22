from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.read_snapshot import consistent_read, snapshot_clock
from app.models.night_leaderboard import NightLeaderboardEntry
from app.models.user import User
from app.schemas.night_leaderboard import LeaderboardMe, LeaderboardOut, LeaderboardPreference, LeaderboardRow
from app.services.exchange_calendar import expected_session_dates
from app.services.night_notebook import as_utc, constraint_name, notebook_error, owner_write
from app.services.performance_service import TWR_UNIT, _performance


_MARKET_TIME = ZoneInfo("America/New_York")
_WINDOW_INTERVALS = 20


def _require_demo(user: User) -> None:
    if not user.is_demo:
        raise notebook_error(403, "demo_required", "A demo trader account is required.")


def set_preference(db: Session, user_id: int, payload: LeaderboardPreference) -> LeaderboardMe:
    with owner_write(db, user_id) as user:
        _require_demo(user)
        entry = db.get(NightLeaderboardEntry, user_id)
        if not payload.enabled:
            if entry is not None:
                db.delete(entry)
            return LeaderboardMe(enabled=False, alias=None)
        if entry is None:
            db.add(NightLeaderboardEntry(user_id=user_id, alias=payload.alias))
        else:
            entry.alias = payload.alias
        try:
            db.flush()
        except IntegrityError as exc:
            if constraint_name(exc) == "uq_night_leaderboard_alias":
                raise notebook_error(409, "alias_in_use", "This alias is already in use.") from None
            raise
        return LeaderboardMe(enabled=True, alias=payload.alias)


def _window(clock: datetime):
    through = as_utc(clock).astimezone(_MARKET_TIME).date() - timedelta(days=1)
    dates = expected_session_dates(through - timedelta(days=45), through)
    return dates[-1 - _WINDOW_INTERVALS], dates[-1]


def _growth_ratio(start_point, end_point) -> Decimal | None:
    if not all(p and p["status"] == "available" and p["twr_index"] is not None for p in (start_point, end_point)):
        return None
    opening = Decimal(start_point["twr_index"])
    closing = Decimal(end_point["twr_index"])
    if opening <= 0 or closing < 0:
        return None
    return (closing / opening - 1).quantize(TWR_UNIT, rounding=ROUND_HALF_UP)


def read_leaderboard(db: Session, viewer: User) -> LeaderboardOut:
    _require_demo(viewer)
    viewer_id = viewer.id
    with consistent_read(db):
        clock = snapshot_clock(db)
        start, end = _window(clock)
        first, last = start.isoformat(), end.isoformat()
        cohort = db.execute(
            select(NightLeaderboardEntry.user_id, NightLeaderboardEntry.alias, User.email)
            .join(User, User.id == NightLeaderboardEntry.user_id)
            .where(User.is_demo, User.role == "trader", User.demo_archived_at.is_(None))
        ).all()
        my_alias = None
        candidates = []
        has_gaps = False
        for user_id, alias, email in cohort:
            if user_id == viewer_id:
                my_alias = alias
            performance = _performance(db, user_id, email, "1y", clock=clock)
            window = {point["session_date"]: point for point in performance["series"]
                      if first <= point["session_date"] <= last}
            ratio = _growth_ratio(window.get(first), window.get(last))
            if ratio is not None:
                candidates.append((alias, ratio))
                has_gaps |= any(point["status"] != "available" for point in window.values())

        excluded = len(cohort) - len(candidates)
        items = []
        coverage = "missing"
        if len(candidates) >= 2:
            candidates.sort(key=lambda item: (-item[1], item[0].lower()))
            items = [LeaderboardRow(rank=rank, alias=alias, return_ratio=ratio)
                     for rank, (alias, ratio) in enumerate(candidates, start=1)]
            coverage = "partial" if excluded or has_gaps else "available"
        return LeaderboardOut(
            start=start, end=end, coverage=coverage, excluded_count=excluded, items=items,
            my_entry=LeaderboardMe(enabled=my_alias is not None, alias=my_alias),
        )
