"""Watchlist row-lock races on isolated CI PostgreSQL.

Skipped unless AUDIT_DATABASE_URL is set. A set URL is refused, before any
connection, unless the preview helper accepts it as disposable. Schema upgrade
runs once per session. These proofs call the watchlist route handlers.
"""

from decimal import Decimal
import os
import re
import threading
import time
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException, Response
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.models.ledger_entry import LedgerEntry
from app.models.market_symbol import MarketSymbol
from app.models.user import User
from app.models.watchlist import Watchlist, WatchlistItem
from app.routers.watchlists import add_symbol, create_watchlist, delete_watchlist
from app.schemas.watchlist import WatchlistCreate, WatchlistSymbolCreate
from app.services.ledger_service import ensure_opening
import tests.test_order_preview_postgres as h


pytestmark = pytest.mark.skipif(
    not os.environ.get("AUDIT_DATABASE_URL"),
    reason="AUDIT_DATABASE_URL is not set",
)

_CASH = Decimal("100000.00")
_USERS = "users"
_LISTS = "watchlists"


@pytest.fixture(scope="session")
def _watchlist_schema():
    h._upgrade(h._disposable_url())


def _engine_and_sessions():
    url = h._disposable_url()
    engine = create_engine(url, poolclass=NullPool, future=True)
    sessions = sessionmaker(bind=engine, autoflush=False, future=True)
    return engine, sessions


def _symbols(count: int) -> list[str]:
    prefix = uuid4().hex[:6].upper()
    return [f"{prefix}{index:02d}" for index in range(count)]


def _seed(sessions, list_count: int, members: list[str], extra_symbols: list[str]) -> dict:
    token = uuid4().hex[:8]
    names = [f"n{token}-{index:02d}" for index in range(list_count)]
    with sessions() as db:
        user = User(
            email=f"wl-{uuid4().hex}@example.com",
            password_hash="fixture",
            cash_balance=_CASH,
        )
        db.add(user)
        db.flush()
        ensure_opening(db, user)
        for symbol in [*members, *extra_symbols]:
            db.add(MarketSymbol(symbol=symbol, company_name=symbol, exchange="NASDAQ", is_active=True))
        db.flush()
        list_ids = []
        for name in names:
            row = Watchlist(user_id=user.id, name=name)
            db.add(row)
            db.flush()
            list_ids.append(int(row.id))
        if members:
            target = list_ids[-1]
            for position, symbol in enumerate(members, start=1):
                db.add(WatchlistItem(watchlist_id=target, symbol=symbol, position=position))
        user_id = int(user.id)
        ledger = int(
            db.scalar(select(func.count()).select_from(LedgerEntry).where(LedgerEntry.user_id == user_id))
        )
        db.commit()
    return {
        "user_id": user_id,
        "owner": SimpleNamespace(id=user_id),
        "list_ids": list_ids,
        "names": names,
        "ledger": ledger,
    }


def _sql_text(statement) -> str:
    if isinstance(statement, str):
        return statement
    if isinstance(statement, (bytes, bytearray)):
        return statement.decode("utf-8", "replace")
    return ""


def _lock_relation(statement) -> str | None:
    folded = _sql_text(statement).lower()
    if "for update" not in folded:
        return None
    if re.search(r"\busers\b", folded):
        return _USERS
    if re.search(r"\bwatchlists\b", folded):
        return _LISTS
    return None


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


def _race(engine, sessions, holder_name: str, waiter_name: str, relation: str, holder_work, waiter_work) -> dict:
    """Pause the holder after the named FOR UPDATE. Prove the waiter with pg_blocking_pids."""
    holder_ready = threading.Event()
    release = threading.Event()
    paused = {"done": False}
    pids: dict[str, int] = {}
    pid_lock = threading.Lock()
    seen = {"relation": None}
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
        locked = _lock_relation(statement)
        if locked is None:
            return
        name = threading.current_thread().name
        if name not in {holder_name, waiter_name}:
            return
        with pid_lock:
            pids[name] = _backend_pid(conn)
            if name == holder_name and seen["relation"] is None:
                seen["relation"] = locked

    def _after_cursor(conn, cursor, statement, parameters, context, executemany):
        if threading.current_thread().name != holder_name or paused["done"]:
            return
        if _lock_relation(statement) != relation:
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
            raise AssertionError(f"holder did not acquire {relation} FOR UPDATE")
        waiter.start()
        observer = sessions()
        try:
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                with pid_lock:
                    waiter_pid = pids.get(waiter_name)
                    holder_pid = pids.get(holder_name)
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
    return {"blocked": blocked, "relation": seen["relation"], "outcomes": outcomes}


def _status(error: BaseException | None) -> int | None:
    if isinstance(error, HTTPException):
        return error.status_code
    return None


def _membership(db, user_id: int, watchlist_id: int | None) -> tuple:
    cash = db.scalar(select(User.cash_balance).where(User.id == user_id))
    ledger = int(db.scalar(select(func.count()).select_from(LedgerEntry).where(LedgerEntry.user_id == user_id)))
    names = list(
        db.execute(
            select(Watchlist.name).where(Watchlist.user_id == user_id).order_by(Watchlist.id)
        ).scalars()
    )
    present = False
    items: list[tuple[str, int]] = []
    if watchlist_id is not None:
        present = db.get(Watchlist, watchlist_id) is not None
        rows = db.execute(
            select(WatchlistItem.symbol, WatchlistItem.position)
            .where(WatchlistItem.watchlist_id == watchlist_id)
            .order_by(WatchlistItem.position, WatchlistItem.symbol)
        )
        items = [(symbol, int(position)) for symbol, position in rows]
    return cash, ledger, names, present, items


def _assert_money(seed: dict, cash, ledger: int) -> None:
    assert cash == _CASH
    assert ledger == seed["ledger"]


def test_create_nineteenth_plus_two_second_waits_on_user(_watchlist_schema) -> None:
    engine, sessions = _engine_and_sessions()
    try:
        seed = _seed(sessions, 19, [], [])
        owner = seed["owner"]
        holder_name = f"cap-{uuid4().hex[:8]}"
        waiter_name = f"over-{uuid4().hex[:8]}"

        def hold(db):
            return create_watchlist(WatchlistCreate(name=holder_name), db, owner)

        def wait(db):
            return create_watchlist(WatchlistCreate(name=waiter_name), db, owner)

        result = _race(engine, sessions, "create-holder", "create-waiter", _USERS, hold, wait)
        with sessions() as db:
            cash, ledger, names, _present, _items = _membership(db, seed["user_id"], None)
    finally:
        engine.dispose()

    assert result["blocked"] is True
    assert result["relation"] == _USERS
    held = result["outcomes"]["create-holder"]
    waited = result["outcomes"]["create-waiter"]
    assert held["error"] is None
    assert held["value"].name == holder_name
    assert _status(waited["error"]) == 409
    assert waited["error"].detail == "A user cannot have more than 20 watchlists"
    assert len(names) == 20
    assert holder_name in names
    assert waiter_name not in names
    _assert_money(seed, cash, ledger)


def test_add_fortyninth_plus_two_second_waits_on_list(_watchlist_schema) -> None:
    engine, sessions = _engine_and_sessions()
    try:
        symbols = _symbols(51)
        members, added = symbols[:49], symbols[49:]
        seed = _seed(sessions, 1, members, added)
        owner = seed["owner"]
        watchlist_id = seed["list_ids"][0]
        holder_response = Response()
        waiter_response = Response()

        def hold(db):
            return add_symbol(
                WatchlistSymbolCreate(symbol=added[0]),
                holder_response,
                watchlist_id,
                db,
                owner,
            )

        def wait(db):
            return add_symbol(
                WatchlistSymbolCreate(symbol=added[1]),
                waiter_response,
                watchlist_id,
                db,
                owner,
            )

        result = _race(engine, sessions, "add-holder", "add-waiter", _LISTS, hold, wait)
        with sessions() as db:
            cash, ledger, names, present, items = _membership(db, seed["user_id"], watchlist_id)
    finally:
        engine.dispose()

    assert result["blocked"] is True
    assert result["relation"] == _LISTS
    held = result["outcomes"]["add-holder"]
    waited = result["outcomes"]["add-waiter"]
    assert held["error"] is None
    assert holder_response.status_code == 201
    assert [item.symbol for item in held["value"].symbols] == [*members, added[0]]
    assert _status(waited["error"]) == 409
    assert waited["error"].detail == "A watchlist cannot have more than 50 symbols"
    assert len(names) == 1
    assert present is True
    expected = [(symbol, position) for position, symbol in enumerate(members, start=1)]
    expected.append((added[0], 50))
    assert items == expected
    assert added[1] not in {symbol for symbol, _position in items}
    _assert_money(seed, cash, ledger)


def test_duplicate_add_one_row_second_reads_existing(_watchlist_schema) -> None:
    engine, sessions = _engine_and_sessions()
    try:
        symbol = _symbols(1)[0]
        seed = _seed(sessions, 1, [], [symbol])
        owner = seed["owner"]
        watchlist_id = seed["list_ids"][0]
        holder_response = Response()
        waiter_response = Response()

        def hold(db):
            return add_symbol(WatchlistSymbolCreate(symbol=symbol), holder_response, watchlist_id, db, owner)

        def wait(db):
            return add_symbol(WatchlistSymbolCreate(symbol=symbol), waiter_response, watchlist_id, db, owner)

        result = _race(engine, sessions, "dup-holder", "dup-waiter", _LISTS, hold, wait)
        with sessions() as db:
            cash, ledger, _names, present, items = _membership(db, seed["user_id"], watchlist_id)
    finally:
        engine.dispose()

    assert result["blocked"] is True
    assert result["relation"] == _LISTS
    held = result["outcomes"]["dup-holder"]
    waited = result["outcomes"]["dup-waiter"]
    assert held["error"] is None
    assert waited["error"] is None
    assert holder_response.status_code == 201
    assert waiter_response.status_code == 200
    for body in (held["value"], waited["value"]):
        assert [(item.symbol, item.position) for item in body.symbols] == [(symbol, 1)]
    assert present is True
    assert items == [(symbol, 1)]
    _assert_money(seed, cash, ledger)


def test_delete_holds_list_and_add_finds_it_gone(_watchlist_schema) -> None:
    engine, sessions = _engine_and_sessions()
    try:
        symbol = _symbols(1)[0]
        seed = _seed(sessions, 1, [], [symbol])
        owner = seed["owner"]
        watchlist_id = seed["list_ids"][0]
        waiter_response = Response()

        def hold(db):
            return delete_watchlist(watchlist_id, db, owner)

        def wait(db):
            return add_symbol(
                WatchlistSymbolCreate(symbol=symbol),
                waiter_response,
                watchlist_id,
                db,
                owner,
            )

        result = _race(engine, sessions, "delete-holder", "add-waiter", _LISTS, hold, wait)
        with sessions() as db:
            cash, ledger, names, present, items = _membership(db, seed["user_id"], watchlist_id)
            orphans = int(
                db.scalar(
                    select(func.count()).select_from(WatchlistItem).where(WatchlistItem.watchlist_id == watchlist_id)
                )
            )
    finally:
        engine.dispose()

    assert result["blocked"] is True
    assert result["relation"] == _LISTS
    held = result["outcomes"]["delete-holder"]
    waited = result["outcomes"]["add-waiter"]
    assert held["error"] is None
    assert held["value"].status_code == 204
    assert _status(waited["error"]) == 404
    assert waited["error"].detail == "Watchlist not found"
    assert names == []
    assert present is False
    assert items == []
    assert orphans == 0
    _assert_money(seed, cash, ledger)
