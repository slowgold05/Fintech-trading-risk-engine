"""Personalized daily briefs aggregate held symbols with existing reports."""

from datetime import datetime, timezone
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.market_symbol import MarketSymbol
from app.models.research_brief import ResearchBrief
from app.models.research_report import ResearchReport
from app.models.user import User
from app.services.research_briefs import build_daily_brief, build_daily_briefs
from app.services.research_worker import process_pending_research_jobs
from tests.test_portfolio_valuation import _add_position

_MISSING = {"detail": "Research brief not found"}


def _today():
    return datetime.now(timezone.utc).date()


def _seed_symbol(db: Session, symbol: str) -> None:
    db.add(MarketSymbol(symbol=symbol, company_name=symbol, exchange="NASDAQ", is_active=True))
    db.commit()


def _user(db: Session, email: str) -> User:
    return db.query(User).filter(User.email == email).one()


def _fundamentals(symbol, db):
    return {"name": "Apple Inc.", "symbol": symbol}


def _filings(symbol, db, forms=None, limit=10):
    return {"symbol": symbol, "filings": [{"form": "10-K"}, {"form": "10-Q"}]}


def _patch_sources(monkeypatch) -> None:
    monkeypatch.setattr("app.services.research_worker.get_sec_company_fundamentals", _fundamentals)
    monkeypatch.setattr("app.services.research_worker.get_sec_company_filings", _filings)


def _create_job(client: TestClient, headers: dict, symbol: str = "AAPL"):
    return client.post("/research/jobs", headers=headers, json={"symbol": symbol})


def test_build_daily_brief_pairs_held_symbols_with_their_latest_report(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    _seed_symbol(db_session, "AAPL")
    _patch_sources(monkeypatch)
    email = "briefs-pair@example.com"
    headers = auth_headers(email)
    user = _user(db_session, email)
    _add_position(db_session, user, "AAPL", "stock", Decimal("1"), Decimal("10"))
    db_session.commit()

    created = _create_job(client, headers)
    assert created.status_code == 201, created.text
    processed = process_pending_research_jobs(db_session, 5)
    assert len(processed) == 1

    report = db_session.execute(
        select(ResearchReport).where(ResearchReport.user_id == user.id)
    ).scalar_one()
    brief = build_daily_brief(db_session, user.id, _today())
    assert brief.entries == [{"symbol": "AAPL", "report_id": report.id}]


def test_held_symbol_with_no_report_yet_gets_a_null_report_id(
    auth_headers, db_session: Session
) -> None:
    email = "briefs-null@example.com"
    auth_headers(email)
    user = _user(db_session, email)
    _add_position(db_session, user, "AAPL", "stock", Decimal("2"), Decimal("10"))
    db_session.commit()

    brief = build_daily_brief(db_session, user.id, _today())
    assert brief.entries == [{"symbol": "AAPL", "report_id": None}]


def test_build_daily_brief_is_idempotent_and_does_not_rebuild(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    _seed_symbol(db_session, "AAPL")
    _patch_sources(monkeypatch)
    email = "briefs-idempotent@example.com"
    headers = auth_headers(email)
    user = _user(db_session, email)
    _add_position(db_session, user, "AAPL", "stock", Decimal("1"), Decimal("10"))
    db_session.commit()

    first_job = _create_job(client, headers)
    assert first_job.status_code == 201, first_job.text
    process_pending_research_jobs(db_session, 5)
    old_report = db_session.execute(
        select(ResearchReport).where(ResearchReport.user_id == user.id)
    ).scalar_one()

    first = build_daily_brief(db_session, user.id, _today())
    first_id = first.id
    first_entries = list(first.entries)

    second_job = _create_job(client, headers)
    assert second_job.status_code == 201, second_job.text
    process_pending_research_jobs(db_session, 5)
    reports = db_session.execute(
        select(ResearchReport)
        .where(ResearchReport.user_id == user.id)
        .order_by(ResearchReport.id.asc())
    ).scalars().all()
    assert len(reports) == 2
    assert reports[1].id != old_report.id

    second = build_daily_brief(db_session, user.id, _today())
    assert second.id == first_id
    assert second.entries == first_entries
    assert second.entries == [{"symbol": "AAPL", "report_id": old_report.id}]


def test_user_with_no_holdings_still_gets_an_empty_brief(auth_headers, db_session: Session) -> None:
    email = "briefs-empty@example.com"
    auth_headers(email)
    user = _user(db_session, email)

    brief = build_daily_brief(db_session, user.id, _today())
    assert brief.entries == []


def test_build_daily_briefs_never_exceeds_max_users(auth_headers, db_session: Session) -> None:
    today = _today()
    users = []
    for index, symbol in enumerate(("AAPL", "MSFT", "TSLA")):
        email = f"briefs-bound-{index}@example.com"
        auth_headers(email)
        user = _user(db_session, email)
        _add_position(db_session, user, symbol, "stock", Decimal("1"), Decimal("10"))
        users.append(user)
    db_session.commit()

    built = build_daily_briefs(db_session, 2, as_of_date=today)
    assert len(built) == 2

    rows = db_session.execute(
        select(ResearchBrief).where(ResearchBrief.brief_date == today)
    ).scalars().all()
    assert len(rows) == 2
    briefed_ids = {row.user_id for row in rows}
    assert len(briefed_ids) == 2
    unbriefed = [user for user in users if user.id not in briefed_ids]
    assert len(unbriefed) == 1


def test_get_brief_returns_404_for_another_user_s_brief(
    client: TestClient, auth_headers, db_session: Session
) -> None:
    owner = auth_headers("briefs-get-owner@example.com")
    other = auth_headers("briefs-get-other@example.com")
    owner_user = _user(db_session, "briefs-get-owner@example.com")
    brief = build_daily_brief(db_session, owner_user.id, _today())

    missing = client.get("/research/briefs/999999", headers=other)
    foreign = client.get(f"/research/briefs/{brief.id}", headers=other)
    assert missing.status_code == 404, missing.text
    assert foreign.status_code == 404, foreign.text
    assert foreign.json() == missing.json() == _MISSING
    owned = client.get(f"/research/briefs/{brief.id}", headers=owner)
    assert owned.status_code == 200, owned.text
    assert owned.json()["id"] == brief.id


def test_list_briefs_only_returns_the_caller_s_own_briefs(
    client: TestClient, auth_headers, db_session: Session
) -> None:
    owner = auth_headers("briefs-list-owner@example.com")
    other = auth_headers("briefs-list-other@example.com")
    owner_user = _user(db_session, "briefs-list-owner@example.com")
    other_user = _user(db_session, "briefs-list-other@example.com")
    own = build_daily_brief(db_session, owner_user.id, _today())
    theirs = build_daily_brief(db_session, other_user.id, _today())

    listed = client.get("/research/briefs", headers=owner)
    assert listed.status_code == 200, listed.text
    assert [item["id"] for item in listed.json()["briefs"]] == [own.id]
    other_listed = client.get("/research/briefs", headers=other)
    assert other_listed.status_code == 200, other_listed.text
    assert [item["id"] for item in other_listed.json()["briefs"]] == [theirs.id]


def test_requires_authentication(client: TestClient) -> None:
    calls = (
        ("GET", "/research/briefs", {}),
        ("GET", "/research/briefs/1", {}),
    )
    for method, path, kwargs in calls:
        response = client.request(method, path, **kwargs)
        assert response.status_code == 401, response.text
