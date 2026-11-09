"""SQLite checks for research and forecast job admission.

Pending means queued or running. Validation stays outside the owner lock.
A file-database lock timeout is a retryable 503 and writes nothing.
"""

import threading

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import Base, get_db
from app.main import app
from app.models.forecast_job import ForecastJob
from app.models.ledger_entry import LedgerEntry
from app.models.market_symbol import MarketSymbol
from app.models.research_job import ResearchJob
from app.models.user import User
from app.services.job_admission import BUSY_DETAIL

_RESEARCH_CAP = "Too many pending research jobs. Cancel one before creating another."
_FORECAST_CAP = "Too many pending forecast jobs. Cancel one before creating another."
_UNKNOWN = "Unknown or inactive stock symbol"


def _seed(db: Session, symbol: str, *, active: bool = True) -> None:
    db.add(MarketSymbol(symbol=symbol, company_name=symbol, exchange="NASDAQ", is_active=active))
    db.commit()


def _user_id(db: Session, email: str) -> int:
    return int(db.scalar(select(User.id).where(User.email == email)))


def _forecast_body(symbol: str = "AAPL") -> dict:
    return {
        "symbol": symbol,
        "provider": "yahoo",
        "adjustment_type": "raw",
        "lookback": 100,
        "horizon": 10,
        "sample_count": 1,
    }


def _pending(db: Session, model, user_id: int) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(model)
            .where(model.user_id == user_id, model.status.in_(("queued", "running")))
        )
    )


def test_research_rejects_unknown_symbol_without_a_job(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "DEAD", active=False)
    headers = auth_headers("admit-research-unknown@example.com")
    user_id = _user_id(db_session, "admit-research-unknown@example.com")
    response = client.post("/research/jobs", headers=headers, json={"symbol": "NOPE"})
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == _UNKNOWN
    assert _pending(db_session, ResearchJob, user_id) == 0


def test_research_cap_counts_running_and_ignores_terminal(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    headers = auth_headers("admit-research-cap@example.com")
    user_id = _user_id(db_session, "admit-research-cap@example.com")
    db_session.add(ResearchJob(user_id=user_id, symbol="AAPL", status="running"))
    db_session.add(ResearchJob(user_id=user_id, symbol="AAPL", status="completed"))
    db_session.add(ResearchJob(user_id=user_id, symbol="AAPL", status="cancelled"))
    db_session.commit()
    created = [client.post("/research/jobs", headers=headers, json={"symbol": "AAPL"}) for _ in range(9)]
    assert [item.status_code for item in created] == [201] * 9
    blocked = client.post("/research/jobs", headers=headers, json={"symbol": "AAPL"})
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["detail"] == _RESEARCH_CAP
    assert _pending(db_session, ResearchJob, user_id) == 10


def test_research_cap_is_per_owner(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    full = auth_headers("admit-research-full@example.com")
    other = auth_headers("admit-research-other@example.com")
    assert [client.post("/research/jobs", headers=full, json={"symbol": "AAPL"}).status_code for _ in range(10)] == [201] * 10
    allowed = client.post("/research/jobs", headers=other, json={"symbol": "AAPL"})
    assert allowed.status_code == 201, allowed.text
    blocked = client.post("/research/jobs", headers=full, json={"symbol": "AAPL"})
    assert blocked.status_code == 409, blocked.text


def test_forecast_rejects_unknown_symbol_without_a_job(client: TestClient, auth_headers, db_session: Session) -> None:
    headers = auth_headers("admit-forecast-unknown@example.com")
    user_id = _user_id(db_session, "admit-forecast-unknown@example.com")
    response = client.post("/forecasts/jobs", headers=headers, json=_forecast_body("NOPE"))
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == _UNKNOWN
    assert _pending(db_session, ForecastJob, user_id) == 0


def test_forecast_cap_counts_running_and_ignores_terminal(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    headers = auth_headers("admit-forecast-cap@example.com")
    user_id = _user_id(db_session, "admit-forecast-cap@example.com")
    db_session.add(ForecastJob(
        user_id=user_id, symbol="AAPL", provider="yahoo", adjustment_type="raw",
        lookback=100, horizon=10, sample_count=1, status="running",
    ))
    db_session.add(ForecastJob(
        user_id=user_id, symbol="AAPL", provider="yahoo", adjustment_type="raw",
        lookback=100, horizon=10, sample_count=1, status="failed",
    ))
    db_session.commit()
    created = [client.post("/forecasts/jobs", headers=headers, json=_forecast_body()) for _ in range(4)]
    assert [item.status_code for item in created] == [201] * 4
    blocked = client.post("/forecasts/jobs", headers=headers, json=_forecast_body())
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["detail"] == _FORECAST_CAP
    assert _pending(db_session, ForecastJob, user_id) == 5


def test_sqlite_research_lock_timeout_is_retryable_503(tmp_path) -> None:
    database = (tmp_path / "jobs.db").as_posix()
    engine = create_engine(
        f"sqlite:///{database}",
        connect_args={"check_same_thread": False, "timeout": 0.2},
        future=True,
    )
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
    Base.metadata.create_all(bind=engine)
    saved = dict(app.dependency_overrides)

    def override_get_db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides.clear()
    app.dependency_overrides[get_db] = override_get_db
    left = TestClient(app)
    right = TestClient(app)
    held = threading.Event()
    release = threading.Event()
    armed = {"on": False}
    outcome: dict[str, tuple[int, dict]] = {}
    threads: list[threading.Thread] = []

    def after(conn, cursor, statement, parameters, context, executemany) -> None:
        if not armed["on"] or "insert into research_jobs" not in statement.lower() or held.is_set():
            return
        held.set()
        assert release.wait(5), "busy holder was not released"

    event.listen(engine, "after_cursor_execute", after)
    try:
        assert left.post(
            "/auth/register",
            json={"email": "admit-busy@example.com", "password": "password123"},
        ).status_code == 200
        token = left.post("/auth/login", data={"username": "admit-busy@example.com", "password": "password123"})
        assert token.status_code == 200, token.text
        headers = {"Authorization": f"Bearer {token.json()['access_token']}"}
        with factory() as session:
            user_id = _user_id(session, "admit-busy@example.com")
            session.add(MarketSymbol(symbol="AAPL", company_name="AAPL", exchange="NASDAQ", is_active=True))
            session.commit()
            ledger_before = int(
                session.scalar(select(func.count()).select_from(LedgerEntry).where(LedgerEntry.user_id == user_id))
            )
        armed["on"] = True

        def create(client: TestClient, slot: str) -> None:
            response = client.post("/research/jobs", headers=headers, json={"symbol": "AAPL"})
            outcome[slot] = (response.status_code, response.json())

        first = threading.Thread(target=create, args=(left, "first"), daemon=True)
        second = threading.Thread(target=create, args=(right, "second"), daemon=True)
        threads.extend((first, second))
        first.start()
        assert held.wait(5)
        second.start()
        second.join(5)
        assert not second.is_alive()
        assert outcome["second"] == (503, {"detail": BUSY_DETAIL})
        release.set()
        first.join(5)
        assert outcome["first"][0] == 201
        with factory() as session:
            assert _pending(session, ResearchJob, user_id) == 1
            ledger_after = int(
                session.scalar(select(func.count()).select_from(LedgerEntry).where(LedgerEntry.user_id == user_id))
            )
            assert ledger_after == ledger_before
    finally:
        event.remove(engine, "after_cursor_execute", after)
        release.set()
        for thread in threads:
            if thread.ident is not None:
                thread.join(5)
        left.close()
        right.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(saved)
        engine.dispose()
