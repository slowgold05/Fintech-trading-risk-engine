"""PostgreSQL proof that a worker claim survives source-session commit and rollback.

Skipped unless AUDIT_DATABASE_URL is set. The disposable-database guard is
``tests.test_order_preview_postgres._disposable_url``. Each test's sessions
only load the job ids that test seeded. Other queued rows stay in the database.
SQLite StaticPool still uses one connection; these tests do not describe it.

Inference is stubbed at ``_load_predictor``. History reads and SEC commits are real.
"""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import os
import threading
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.orm import sessionmaker, with_loader_criteria
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.models.forecast_job import ForecastJob
from app.models.forecast_result import ForecastResult
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_fundamentals_cache import MarketFundamentalsCache
from app.models.market_symbol import MarketSymbol
from app.models.research_job import ResearchJob
from app.models.research_report import ResearchReport
from app.models.user import User
from app.services.exchange_calendar import is_nyse_trading_day
from app.services.forecast_worker import process_one_job as process_forecast_job
from app.services.research_worker import process_one_job as process_research_job
from tests.test_order_preview_postgres import _disposable_url, _upgrade


pytestmark = pytest.mark.skipif(
    not os.environ.get("AUDIT_DATABASE_URL"),
    reason="AUDIT_DATABASE_URL is not set",
)


def _engine_and_sessions():
    """Engine plus sessions that can claim only this test's job ids.

    Loader criteria hide other queued rows left in the shared disposable
    database. Nothing is deleted. ``_claim_job`` itself is unchanged, and the
    source session the worker opens is a different object, so history rollback
    and SEC commit still run on that connection.
    """
    url = _disposable_url()
    _upgrade(url)
    engine = create_engine(url, poolclass=NullPool, future=True)
    sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    forecast_ids: set[int] = set()
    research_ids: set[int] = set()

    @event.listens_for(sessions, "do_orm_execute")
    def _only_seeded_jobs(state):
        if not state.is_select or state.is_column_load or state.is_relationship_load:
            return
        forecast = tuple(sorted(forecast_ids)) or (-1,)
        research = tuple(sorted(research_ids)) or (-1,)
        state.statement = state.statement.options(
            with_loader_criteria(
                ForecastJob,
                ForecastJob.id.in_(forecast),
                include_aliases=True,
            ),
            with_loader_criteria(
                ResearchJob,
                ResearchJob.id.in_(research),
                include_aliases=True,
            ),
        )

    return engine, sessions, forecast_ids, research_ids


def _backend_pid(connection) -> int:
    dbapi = connection.connection.driver_connection
    info = getattr(dbapi, "info", None)
    pid = getattr(info, "backend_pid", None)
    if pid:
        return int(pid)
    return int(connection.execute(text("SELECT pg_backend_pid()")).scalar_one())


def _seed_symbol(sessions) -> tuple[int, str]:
    symbol = f"W{uuid4().hex[:8].upper()}"
    email = f"worker-{uuid4().hex}@example.com"
    with sessions() as seed:
        user = User(email=email, password_hash="fixture", cash_balance=Decimal("1000.00"))
        seed.add(user)
        seed.add(MarketSymbol(
            symbol=symbol,
            company_name="Worker",
            exchange="NASDAQ",
            is_etf=False,
            is_test=False,
            is_active=True,
        ))
        seed.commit()
        return int(user.id), symbol


def _past_trading_days(clock: datetime, count: int) -> list[date]:
    if clock.tzinfo is not None:
        day = clock.astimezone(timezone.utc).date()
    else:
        day = clock.date()
    found = []
    day -= timedelta(days=1)
    while len(found) < count:
        if is_nyse_trading_day(day):
            found.append(day)
        day -= timedelta(days=1)
    found.reverse()
    return found


def _seed_bars(sessions, symbol: str) -> None:
    with sessions() as seed:
        clock = seed.execute(text("SELECT current_timestamp")).scalar_one()
        if not isinstance(clock, datetime):
            raise RuntimeError("database clock was not a timestamp")
        if clock.tzinfo is None:
            clock = clock.replace(tzinfo=timezone.utc)
        fetched = clock - timedelta(days=3)
        for index, session_date in enumerate(_past_trading_days(clock, 2)):
            price = Decimal("100.250000") + Decimal(index)
            seed.add(MarketBarDaily(
                symbol=symbol,
                session_date=session_date,
                provider="yahoo",
                adjustment_type="raw",
                open=price,
                high=price + Decimal("1.000000"),
                low=price - Decimal("1.000000"),
                close=price + Decimal("0.250000"),
                volume=1000 + index,
                fetched_at=fetched,
                quality_status="valid",
            ))
        seed.commit()


def _queue_forecast(sessions, user_id: int, symbol: str, allowed: set[int]) -> int:
    with sessions() as seed:
        job = ForecastJob(
            user_id=user_id,
            symbol=symbol,
            provider="yahoo",
            adjustment_type="raw",
            lookback=2,
            horizon=1,
            sample_count=1,
            status="queued",
        )
        seed.add(job)
        seed.commit()
        job_id = int(job.id)
    allowed.add(job_id)
    return job_id


def _queue_research(sessions, user_id: int, symbol: str, allowed: set[int]) -> int:
    with sessions() as seed:
        job = ResearchJob(user_id=user_id, symbol=symbol, status="queued")
        seed.add(job)
        seed.commit()
        job_id = int(job.id)
    allowed.add(job_id)
    return job_id


def _lock_timeout(exc: BaseException) -> bool:
    return "lock timeout" in str(exc).lower()


class _Predictor:
    def __init__(self, frame, on_predict):
        self.frame = frame
        self.on_predict = on_predict
        self.calls = 0

    def predict(self, **kwargs):
        self.calls += 1
        self.on_predict(self.calls)
        return self.frame


def _frame(pandas):
    return pandas.DataFrame({
        "open": [10.0],
        "high": [11.0],
        "low": [9.0],
        "close": [10.5],
        "volume": [100.0],
    })


def _run(sessions, worker, sink: list) -> threading.Thread:
    def target():
        try:
            with sessions() as db:
                result = worker(db)
                sink.append(None if result is None else result.status)
        except Exception as exc:
            sink.append(exc)

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    return thread


def test_forecast_claim_stays_locked_across_history_rollback(monkeypatch):
    pandas = pytest.importorskip("pandas")
    engine, sessions, forecast_ids, _research_ids = _engine_and_sessions()
    ready = threading.Event()
    release = threading.Event()
    claim_pids: list[int] = []
    rollback_pids: list[int] = []
    reader_pids: list[int] = []
    after_read = {}

    def on_rollback(connection):
        rollback_pids.append(_backend_pid(connection))

    def after_execute(connection, _cursor, statement, _parameters, _context, _executemany):
        sql = " ".join(str(statement).lower().split())
        if "update forecast_jobs" in sql:
            claim_pids.append(_backend_pid(connection))
        elif "market_bars_daily" in sql and "select" in sql:
            reader_pids.append(_backend_pid(connection))

    event.listen(engine, "rollback", on_rollback)
    event.listen(engine, "after_cursor_execute", after_execute)
    try:
        monkeypatch.setattr(settings, "forecast_kronos_enabled", True)
        user_id, symbol = _seed_symbol(sessions)
        _seed_bars(sessions, symbol)
        job_id = _queue_forecast(sessions, user_id, symbol, forecast_ids)

        import app.services.forecast_kronos as kronos

        real_read = kronos.read_symbol_history

        def read_history(db, **kwargs):
            history = real_read(db, **kwargs)
            after_read["in_transaction"] = db.in_transaction()
            after_read["bars"] = len(history["bars"])
            return history

        def hold(_call):
            ready.set()
            assert release.wait(30)

        predictor = _Predictor(_frame(pandas), hold)
        monkeypatch.setattr(kronos, "read_symbol_history", read_history)
        monkeypatch.setattr(kronos, "_load_predictor", lambda: predictor)

        holder_out: list = []
        holder = _run(sessions, process_forecast_job, holder_out)
        assert ready.wait(15), holder_out
        assert after_read["in_transaction"] is False
        assert after_read["bars"] >= 2
        assert claim_pids
        assert reader_pids
        assert claim_pids[0] not in rollback_pids
        assert reader_pids[-1] != claim_pids[0]
        assert reader_pids[-1] in rollback_pids

        with sessions() as look:
            visible = look.get(ForecastJob, job_id)
            assert visible.status == "queued"
            waiting = look.execute(text(
                "SELECT count(*) FROM pg_locks "
                "WHERE relation = 'forecast_jobs'::regclass AND granted AND pid = :pid"
            ), {"pid": claim_pids[0]}).scalar_one()
            assert int(waiting) >= 1

        challenger_out: list = []

        def challenge(db):
            db.execute(text("SET lock_timeout = '2s'"))
            return process_forecast_job(db)

        challenger = _run(sessions, challenge, challenger_out)
        challenger.join(8)
        assert not challenger.is_alive()
        assert len(challenger_out) == 1
        assert _lock_timeout(challenger_out[0])
        assert predictor.calls == 1

        release.set()
        holder.join(10)
        assert not holder.is_alive()
        assert holder_out == ["completed"]

        with sessions() as look:
            job = look.get(ForecastJob, job_id)
            results = look.execute(
                select(ForecastResult).where(ForecastResult.job_id == job_id)
            ).scalars().all()
            assert job.status == "completed"
            assert job.error_message is None
            assert len(results) == 1
            assert predictor.calls == 1
    finally:
        release.set()
        event.remove(engine, "rollback", on_rollback)
        event.remove(engine, "after_cursor_execute", after_execute)
        engine.dispose()


def test_failed_forecast_is_recorded_and_a_later_job_runs(monkeypatch):
    pandas = pytest.importorskip("pandas")
    engine, sessions, forecast_ids, _research_ids = _engine_and_sessions()
    try:
        monkeypatch.setattr(settings, "forecast_kronos_enabled", True)
        user_id, symbol = _seed_symbol(sessions)
        _seed_bars(sessions, symbol)
        failed_id = _queue_forecast(sessions, user_id, symbol, forecast_ids)
        calls = {"count": 0}

        def on_predict(count):
            calls["count"] = count
            if count == 1:
                raise RuntimeError("inference failed")

        predictor = _Predictor(_frame(pandas), on_predict)
        monkeypatch.setattr("app.services.forecast_kronos._load_predictor", lambda: predictor)

        with sessions() as db:
            first = process_forecast_job(db)
            assert first is not None
            assert first.id == failed_id
            assert first.status == "failed"
            assert first.error_message == "inference failed"

        with sessions() as look:
            stored = look.get(ForecastJob, failed_id)
            assert stored.status == "failed"
            assert stored.error_message == "inference failed"
            assert look.execute(
                select(ForecastResult).where(ForecastResult.job_id == failed_id)
            ).scalars().all() == []

        later_id = _queue_forecast(sessions, user_id, symbol, forecast_ids)
        with sessions() as db:
            second = process_forecast_job(db)
            assert second is not None
            assert second.id == later_id
            assert second.status == "completed"
        assert calls["count"] == 2
        with sessions() as look:
            assert look.get(ForecastJob, failed_id).status == "failed"
            assert look.get(ForecastJob, later_id).status == "completed"
            ours = look.execute(
                select(ForecastResult).where(ForecastResult.job_id.in_((failed_id, later_id)))
            ).scalars().all()
            assert [row.job_id for row in ours] == [later_id]
    finally:
        engine.dispose()


def test_research_claim_stays_locked_across_source_commit(monkeypatch):
    engine, sessions, _forecast_ids, research_ids = _engine_and_sessions()
    ready = threading.Event()
    release = threading.Event()
    claim_pids: list[int] = []
    commit_pids: list[int] = []
    http_calls = {"count": 0}

    def on_commit(connection):
        commit_pids.append(_backend_pid(connection))

    def after_execute(connection, _cursor, statement, _parameters, _context, _executemany):
        sql = " ".join(str(statement).lower().split())
        if "update research_jobs" in sql:
            claim_pids.append(_backend_pid(connection))

    event.listen(engine, "commit", on_commit)
    event.listen(engine, "after_cursor_execute", after_execute)
    try:
        user_id, symbol = _seed_symbol(sessions)
        job_id = _queue_research(sessions, user_id, symbol, research_ids)
        # Same shape as company_tickers.json values: cik_str, ticker, title.
        monkeypatch.setattr(
            "app.services.sec_service._get_ticker_map",
            lambda: {symbol: {"cik_str": 12345, "ticker": symbol, "title": "Worker Co"}},
        )

        class Response:
            def raise_for_status(self):
                return None

            def json(self):
                return self.payload

        def fake_get(url, headers=None, timeout=None):
            http_calls["count"] += 1
            response = Response()
            if "companyfacts" in url:
                response.payload = {"entityName": "Worker Co", "facts": {}}
                return response
            if "submissions" not in url:
                raise AssertionError(f"unexpected SEC url {url}")
            ready.set()
            assert release.wait(30)
            response.payload = {
                "entityName": "Worker Co",
                "filings": {"recent": {
                    "form": ["10-K"],
                    "filingDate": ["2026-01-15"],
                    "reportDate": ["2025-12-31"],
                    "accessionNumber": ["0001234567-26-000001"],
                    "primaryDocument": ["form10k.htm"],
                }},
            }
            return response

        monkeypatch.setattr("app.services.sec_service.requests.get", fake_get)
        monkeypatch.setattr(settings, "research_synthesis_enabled", False)

        holder_out: list = []
        holder = _run(sessions, process_research_job, holder_out)
        assert ready.wait(15), holder_out
        assert claim_pids
        assert claim_pids[0] not in commit_pids
        assert commit_pids

        with sessions() as look:
            visible = look.get(ResearchJob, job_id)
            assert visible.status == "queued"
            cached = look.get(MarketFundamentalsCache, symbol)
            assert cached is not None
            assert cached.payload["name"] == "Worker Co"
            granted = look.execute(text(
                "SELECT count(*) FROM pg_locks "
                "WHERE relation = 'research_jobs'::regclass AND granted AND pid = :pid"
            ), {"pid": claim_pids[0]}).scalar_one()
            assert int(granted) >= 1

        challenger_out: list = []

        def challenge(db):
            db.execute(text("SET lock_timeout = '2s'"))
            return process_research_job(db)

        challenger = _run(sessions, challenge, challenger_out)
        challenger.join(8)
        assert not challenger.is_alive()
        assert len(challenger_out) == 1
        assert _lock_timeout(challenger_out[0])
        assert http_calls["count"] == 2

        release.set()
        holder.join(10)
        assert holder_out == ["completed"]
        with sessions() as look:
            job = look.get(ResearchJob, job_id)
            reports = look.execute(
                select(ResearchReport).where(ResearchReport.job_id == job_id)
            ).scalars().all()
            assert job.status == "completed"
            assert job.error_message is None
            assert len(reports) == 1
            assert [source["status"] for source in reports[0].sources] == ["ok", "ok"]
            assert http_calls["count"] == 2
    finally:
        release.set()
        event.remove(engine, "commit", on_commit)
        event.remove(engine, "after_cursor_execute", after_execute)
        engine.dispose()
