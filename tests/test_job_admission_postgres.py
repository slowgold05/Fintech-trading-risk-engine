"""Job admission races on isolated CI PostgreSQL.

Skipped unless AUDIT_DATABASE_URL is set. A set URL is refused, before any
connection, unless the preview helper accepts it as disposable. Two sessions
race one owner from cap-1. The waiter must show up in pg_blocking_pids.
A second owner is admitted while the first owner lock is still held.
"""

import os
import re
import secrets
import threading
import time
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.models.forecast_job import ForecastJob
from app.models.ledger_entry import LedgerEntry
from app.models.market_symbol import MarketSymbol
from app.models.research_job import ResearchJob
from app.models.user import User
from app.routers.forecasts import create_forecast_job
from app.routers.research import create_research_job
from app.schemas.forecast_job import ForecastJobCreate
from app.schemas.research_job import ResearchJobCreate
import tests.test_order_preview_postgres as h


pytestmark = pytest.mark.skipif(
    not os.environ.get("AUDIT_DATABASE_URL"),
    reason="AUDIT_DATABASE_URL is not set",
)

_RESEARCH_CAP = 10
_FORECAST_CAP = 5


@pytest.fixture(scope="session")
def _job_schema():
    h._upgrade(h._disposable_url())


def _sessions():
    engine = create_engine(h._disposable_url(), poolclass=NullPool, future=True)
    return engine, sessionmaker(bind=engine, autoflush=False, future=True)


def _symbol() -> str:
    return uuid4().hex[:8].upper()


def _seed(sessions, symbol: str, pending: int, kind: str) -> dict:
    with sessions() as db:
        user = User(email=f"job-{uuid4().hex}@example.com", password_hash="fixture", full_name="Job Admit")
        other = User(email=f"job-{uuid4().hex}@example.com", password_hash="fixture", full_name="Job Other")
        db.add_all([user, other])
        db.flush()
        db.add(MarketSymbol(symbol=symbol, company_name=symbol, exchange="NASDAQ", is_active=True))
        db.flush()
        for _ in range(pending):
            if kind == "research":
                db.add(ResearchJob(user_id=user.id, symbol=symbol, status="queued"))
            else:
                db.add(ForecastJob(
                    user_id=user.id, symbol=symbol, provider="yahoo", adjustment_type="raw",
                    lookback=100, horizon=10, sample_count=1, status="queued",
                ))
        user_id = int(user.id)
        other_id = int(other.id)
        cash = user.cash_balance
        ledger = int(db.scalar(select(func.count()).select_from(LedgerEntry).where(LedgerEntry.user_id == user_id)))
        db.commit()
    return {"user_id": user_id, "other_id": other_id, "cash": cash, "ledger": ledger, "symbol": symbol}


def _research_payload(symbol: str) -> ResearchJobCreate:
    return ResearchJobCreate(symbol=symbol)


def _forecast_payload(symbol: str) -> ForecastJobCreate:
    return ForecastJobCreate(
        symbol=symbol, provider="yahoo", adjustment_type="raw", lookback=100, horizon=10, sample_count=1,
    )


def _call(kind: str, db, symbol: str, user_id: int):
    owner = SimpleNamespace(id=user_id)
    if kind == "research":
        return create_research_job(_research_payload(symbol), db, owner)
    return create_forecast_job(_forecast_payload(symbol), db, owner)


def _model(kind: str):
    return ResearchJob if kind == "research" else ForecastJob


def _pending(db, kind: str, user_id: int) -> int:
    model = _model(kind)
    return int(
        db.scalar(
            select(func.count()).select_from(model).where(
                model.user_id == user_id, model.status.in_(("queued", "running"))
            )
        )
    )


def _sql_text(statement) -> str:
    if isinstance(statement, str):
        return statement
    if isinstance(statement, (bytes, bytearray)):
        return statement.decode("utf-8", "replace")
    return ""


def _locks_user(statement) -> bool:
    folded = _sql_text(statement).lower()
    return "for update" in folded and re.search(r"\busers\b", folded) is not None


def _backend_pid(connection) -> int:
    raw = connection.connection.driver_connection
    info = getattr(raw, "info", None)
    backend_pid = getattr(info, "backend_pid", None)
    if backend_pid:
        return int(backend_pid)
    getter = getattr(raw, "get_backend_pid", None)
    if getter is not None:
        return int(getter())
    return int(connection.execute(text("SELECT pg_backend_pid()")).scalar_one())


def _race(engine, sessions, holder_work, waiter_work, release_when=None) -> dict:
    """Pause the holder after users FOR UPDATE. Prove the waiter with pg_blocking_pids."""
    holder_name, waiter_name = "holder", "waiter"
    holder_ready = threading.Event()
    release = threading.Event()
    paused = {"done": False}
    pids: dict[str, int] = {}
    pid_lock = threading.Lock()
    outcomes = {
        holder_name: {"value": None, "error": None},
        waiter_name: {"value": None, "error": None},
    }

    def _after_begin(session, transaction, connection):
        if threading.current_thread().name not in {holder_name, waiter_name}:
            return
        connection.execute(text("SET LOCAL lock_timeout = '8s'"))
        connection.execute(text("SET LOCAL statement_timeout = '12s'"))

    def _before_cursor(conn, cursor, statement, parameters, context, executemany):
        if not _locks_user(statement):
            return
        name = threading.current_thread().name
        if name not in {holder_name, waiter_name}:
            return
        with pid_lock:
            pids[name] = _backend_pid(conn)

    def _after_cursor(conn, cursor, statement, parameters, context, executemany):
        if threading.current_thread().name != holder_name or paused["done"]:
            return
        if not _locks_user(statement):
            return
        paused["done"] = True
        holder_ready.set()
        if not release.wait(12):
            raise AssertionError("holder was not released within 12s; refusing to continue the proof")

    def _worker(name: str, work):
        session = sessions()
        try:
            outcomes[name]["value"] = work(session)
        except Exception as exc:
            session.rollback()
            outcomes[name]["error"] = exc
        finally:
            session.close()

    hooked = False
    threads: list[threading.Thread] = []
    blocked = False
    try:
        event.listen(Session, "after_begin", _after_begin)
        event.listen(engine, "before_cursor_execute", _before_cursor)
        event.listen(engine, "after_cursor_execute", _after_cursor)
        hooked = True
        holder = threading.Thread(target=_worker, name=holder_name, args=(holder_name, holder_work), daemon=True)
        waiter = threading.Thread(target=_worker, name=waiter_name, args=(waiter_name, waiter_work), daemon=True)
        threads = [holder, waiter]
        holder.start()
        if not holder_ready.wait(8):
            raise AssertionError("holder did not acquire users FOR UPDATE")
        waiter.start()
        observer = sessions()
        try:
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                with pid_lock:
                    waiter_pid = pids.get(waiter_name)
                    holder_pid = pids.get(holder_name)
                if release_when is not None and release_when.is_set():
                    break
                if waiter_pid is not None and holder_pid is not None:
                    blockers = observer.execute(
                        text("SELECT pg_blocking_pids(:pid)"),
                        {"pid": waiter_pid},
                    ).scalar_one()
                    if holder_pid in {int(item) for item in (blockers or [])}:
                        blocked = True
                        break
                time.sleep(0.05)
        finally:
            observer.rollback()
            observer.close()
    finally:
        release.set()
        holder_ready.set()
        for thread in threads:
            if thread.ident is not None:
                thread.join(20)
        if hooked:
            event.remove(Session, "after_begin", _after_begin)
            event.remove(engine, "before_cursor_execute", _before_cursor)
            event.remove(engine, "after_cursor_execute", _after_cursor)
    alive = [thread.name for thread in threads if thread.ident is not None and thread.is_alive()]
    if alive:
        raise AssertionError("worker still running: " + ",".join(alive))
    return {"blocked": blocked, "outcomes": outcomes}


def _status(error: BaseException | None) -> int | None:
    if isinstance(error, HTTPException):
        return error.status_code
    return None


def _assert_one_admit(kind: str, cap: int, _job_schema) -> None:
    engine, sessions = _sessions()
    try:
        seeded = _seed(sessions, _symbol(), cap - 1, kind)

        def work(user_id):
            def run(db):
                return _call(kind, db, seeded["symbol"], user_id)
            return run

        proof = _race(engine, sessions, work(seeded["user_id"]), work(seeded["user_id"]))
        assert proof["blocked"] is True
        codes = []
        for name in ("holder", "waiter"):
            item = proof["outcomes"][name]
            if item["error"] is None:
                assert item["value"]["status"] == "queued"
                assert item["value"]["symbol"] == seeded["symbol"]
                codes.append(201)
            else:
                codes.append(_status(item["error"]))
        assert sorted(codes) == [201, 409]
        with sessions() as db:
            assert _pending(db, kind, seeded["user_id"]) == cap
            cash = db.scalar(select(User.cash_balance).where(User.id == seeded["user_id"]))
            ledger = int(
                db.scalar(select(func.count()).select_from(LedgerEntry).where(LedgerEntry.user_id == seeded["user_id"]))
            )
            assert cash == seeded["cash"]
            assert ledger == seeded["ledger"]
    finally:
        engine.dispose()


def test_research_cap_race_admits_one_and_rejects_one(_job_schema) -> None:
    _assert_one_admit("research", _RESEARCH_CAP, _job_schema)


def test_forecast_cap_race_admits_one_and_rejects_one(_job_schema) -> None:
    _assert_one_admit("forecast", _FORECAST_CAP, _job_schema)


def test_other_owner_is_not_blocked_by_the_user_lock(_job_schema) -> None:
    engine, sessions = _sessions()
    try:
        seeded = _seed(sessions, _symbol(), 0, "research")
        done = threading.Event()
        waiter_box: dict = {}

        def holder_work(db):
            body = _call("research", db, seeded["symbol"], seeded["user_id"])
            assert done.wait(8), "other owner did not finish while this lock was held"
            return body

        def waiter_work(db):
            try:
                waiter_box["value"] = _call("forecast", db, seeded["symbol"], seeded["other_id"])
            except Exception as exc:
                waiter_box["error"] = exc
            finally:
                done.set()

        proof = _race(engine, sessions, holder_work, waiter_work, release_when=done)
        assert proof["blocked"] is False
        assert proof["outcomes"]["holder"]["error"] is None
        assert proof["outcomes"]["holder"]["value"]["status"] == "queued"
        assert waiter_box.get("error") is None
        assert waiter_box["value"]["status"] == "queued"
        with sessions() as db:
            assert _pending(db, "research", seeded["user_id"]) == 1
            assert _pending(db, "forecast", seeded["other_id"]) == 1
    finally:
        engine.dispose()


def test_app_role_can_lock_owner_and_insert_when_grants_exist(_job_schema) -> None:
    """Configure a disposable fintech_app role and prove column-scoped job writes."""
    from sqlalchemy.engine import make_url
    from sqlalchemy.exc import DBAPIError

    from app.scripts import configure_postgres_role

    owner_url = h._disposable_url()
    password = secrets.token_urlsafe(24)
    configure_postgres_role.configure(owner_url, password)
    engine, sessions = _sessions()
    app_engine = create_engine(
        make_url(owner_url).set(username="fintech_app", password=password),
        poolclass=NullPool,
        future=True,
    )
    try:
        app_sessions = sessionmaker(bind=app_engine, autoflush=False, future=True)
        symbol = _symbol()
        with sessions() as db:
            user = User(email=f"job-app-{uuid4().hex}@example.com", password_hash="fixture")
            db.add(user)
            db.flush()
            db.add(MarketSymbol(symbol=symbol, company_name=symbol, exchange="NASDAQ", is_active=True))
            user_id = int(user.id)
            db.commit()
        with app_sessions() as db:
            research = _call("research", db, symbol, user_id)
            assert research["status"] == "queued"
        with app_sessions() as db:
            forecast = _call("forecast", db, symbol, user_id)
            assert forecast["status"] == "queued"
        with sessions() as db:
            role_before = db.execute(text("SELECT role FROM users WHERE id = :id"), {"id": user_id}).scalar_one()
            assert _pending(db, "research", user_id) == 1
            assert _pending(db, "forecast", user_id) == 1
        with app_sessions() as db:
            with pytest.raises(DBAPIError) as denied:
                db.execute(text("UPDATE users SET role = role WHERE id = :id"), {"id": user_id})
                db.commit()
            db.rollback()
        assert "permission denied" in str(denied.value).lower()
        with sessions() as db:
            role_after = db.execute(text("SELECT role FROM users WHERE id = :id"), {"id": user_id}).scalar_one()
            assert role_after == role_before
    finally:
        app_engine.dispose()
        engine.dispose()
