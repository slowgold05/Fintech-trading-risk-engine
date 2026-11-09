from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.asset import Asset
from app.models.holding import Holding
from app.models.research_brief import ResearchBrief
from app.models.research_report import ResearchReport


def _held_symbols(db: Session, user_id: int) -> list[str]:
    rows = db.execute(
        select(Asset.symbol)
        .join(Holding, Holding.asset_id == Asset.id)
        .where(Holding.user_id == user_id, Holding.quantity > 0)
        .distinct()
    ).scalars().all()
    return sorted(rows)


def _latest_report_id(db: Session, user_id: int, symbol: str) -> int | None:
    return db.execute(
        select(ResearchReport.id)
        .where(ResearchReport.user_id == user_id, ResearchReport.symbol == symbol)
        .order_by(ResearchReport.id.desc())
        .limit(1)
    ).scalar_one_or_none()


def build_daily_brief(db: Session, user_id: int, as_of_date: date) -> ResearchBrief:
    existing = db.execute(
        select(ResearchBrief).where(
            ResearchBrief.user_id == user_id, ResearchBrief.brief_date == as_of_date
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    symbols = _held_symbols(db, user_id)
    entries = [
        {"symbol": symbol, "report_id": _latest_report_id(db, user_id, symbol)}
        for symbol in symbols
    ]
    brief = ResearchBrief(user_id=user_id, brief_date=as_of_date, entries=entries)
    db.add(brief)
    db.commit()
    return brief


def build_daily_briefs(db: Session, max_users: int, as_of_date: date | None = None) -> list[ResearchBrief]:
    as_of_date = as_of_date or datetime.now(timezone.utc).date()
    already_briefed = select(ResearchBrief.user_id).where(ResearchBrief.brief_date == as_of_date)
    eligible = db.execute(
        select(Holding.user_id)
        .where(Holding.quantity > 0, Holding.user_id.not_in(already_briefed))
        .distinct()
        .order_by(Holding.user_id.asc())
        .limit(max_users)
    ).scalars().all()
    return [build_daily_brief(db, user_id, as_of_date) for user_id in eligible]
