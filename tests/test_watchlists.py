"""Watchlist HTTP contract. Money rows are observed, never rewritten as a lock."""

from __future__ import annotations

import threading

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import Base, get_db
from app.core.security import get_current_user
from app.main import app
from app.models.ledger_entry import LedgerEntry
from app.models.market_symbol import MarketSymbol
from app.models.user import User
from app.services.ledger_service import ensure_opening

_NOT_FOUND = {"detail": "Watchlist not found"}
_NAME_EXISTS = {"detail": "Watchlist name already exists"}
_LIST_CAP = {"detail": "A user cannot have more than 20 watchlists"}
_MEMBER_CAP = {"detail": "A watchlist cannot have more than 50 symbols"}
_UNKNOWN = {"detail": "Unknown or inactive stock symbol"}
_SYMBOL_MISSING = {"detail": "Symbol not found on watchlist"}
_ORDER = {"detail": "symbol_order must list the current symbols exactly"}
_BUSY = {"detail": "Watchlist update is temporarily unavailable. Retry."}
_USER_COLUMNS = [column.key for column in User.__table__.columns]
_LEDGER_COLUMNS = [column.key for column in LedgerEntry.__table__.columns]


def _seed_symbols(db: Session, symbols: list[str], *, active: bool = True) -> None:
    for symbol in symbols:
        db.add(MarketSymbol(
            symbol=symbol,
            company_name=symbol,
            exchange="NASDAQ",
            is_active=active,
        ))
    db.commit()


def _user(db: Session, email: str) -> User:
    user = db.execute(select(User).where(User.email == email)).scalar_one()
    ensure_opening(db, user)
    db.commit()
    return user


def _money(db: Session) -> tuple[list[tuple], list[tuple]]:
    db.expire_all()
    users = [
        tuple(getattr(row, column) for column in _USER_COLUMNS)
        for row in db.execute(select(User).order_by(User.id)).scalars()
    ]
    ledger = [
        tuple(getattr(row, column) for column in _LEDGER_COLUMNS)
        for row in db.execute(select(LedgerEntry).order_by(LedgerEntry.id)).scalars()
    ]
    return users, ledger


def _assert_list(body: dict, name: str, symbols: list[tuple[str, int]]) -> int:
    assert set(body) == {"id", "name", "symbols"}
    assert isinstance(body["id"], int) and body["id"] > 0
    assert body["name"] == name
    assert body["symbols"] == [{"symbol": symbol, "position": position} for symbol, position in symbols]
    assert "user_id" not in body
    return body["id"]


def test_unauthenticated_watchlists_are_401(client: TestClient) -> None:
    app.dependency_overrides.pop(get_current_user, None)
    calls = (
        ("GET", "/watchlists", {}),
        ("POST", "/watchlists", {"json": {"name": "Core"}}),
        ("PATCH", "/watchlists/1", {"json": {"name": "Core"}}),
        ("DELETE", "/watchlists/1", {}),
        ("POST", "/watchlists/1/symbols", {"json": {"symbol": "AAPL"}}),
        ("DELETE", "/watchlists/1/symbols/AAPL", {}),
    )
    for method, path, kwargs in calls:
        response = client.request(method, path, **kwargs)
        assert response.status_code == 401, response.text
        assert "user_id" not in response.text


def test_owner_crud_isolation_and_case_sensitive_names(client: TestClient, auth_headers, db_session: Session) -> None:
    owner_headers = auth_headers("owner-lists@example.com")
    other_headers = auth_headers("other-lists@example.com")
    admin_headers = auth_headers("admin-lists@example.com")
    compliance_headers = auth_headers("compliance-lists@example.com")
    _user(db_session, "owner-lists@example.com")
    _user(db_session, "other-lists@example.com")
    admin = _user(db_session, "admin-lists@example.com")
    compliance = _user(db_session, "compliance-lists@example.com")
    admin.role = "admin"
    compliance.role = "compliance_officer"
    db_session.commit()
    before = _money(db_session)

    created = client.post("/watchlists", headers=owner_headers, json={"name": "  Alpha  "})
    assert created.status_code == 201, created.text
    alpha_id = _assert_list(created.json(), "Alpha", [])
    lower = client.post("/watchlists", headers=owner_headers, json={"name": "alpha"})
    assert lower.status_code == 201, lower.text
    alpha_lower_id = _assert_list(lower.json(), "alpha", [])
    assert alpha_lower_id != alpha_id
    duplicate = client.post("/watchlists", headers=owner_headers, json={"name": " Alpha "})
    assert duplicate.status_code == 409
    assert duplicate.json() == _NAME_EXISTS

    other_same = client.post("/watchlists", headers=other_headers, json={"name": "Alpha"})
    assert other_same.status_code == 201, other_same.text
    other_id = _assert_list(other_same.json(), "Alpha", [])
    assert client.post("/watchlists", headers=admin_headers, json={"name": "Admin book"}).status_code == 201
    assert client.post(
        "/watchlists", headers=compliance_headers, json={"name": "Compliance book"},
    ).status_code == 201

    renamed = client.patch(f"/watchlists/{alpha_id}", headers=owner_headers, json={"name": "  Core  "})
    assert renamed.status_code == 200, renamed.text
    _assert_list(renamed.json(), "Core", [])
    missing_id = 888_888_888
    for method, path, kwargs in (
        ("PATCH", f"/watchlists/{other_id}", {"json": {"name": "Stolen"}}),
        ("PATCH", f"/watchlists/{missing_id}", {"json": {"name": "Missing"}}),
        ("DELETE", f"/watchlists/{other_id}", {}),
        ("DELETE", f"/watchlists/{missing_id}", {}),
        ("POST", f"/watchlists/{other_id}/symbols", {"json": {"symbol": "AAPL"}}),
        ("POST", f"/watchlists/{missing_id}/symbols", {"json": {"symbol": "AAPL"}}),
        ("DELETE", f"/watchlists/{other_id}/symbols/AAPL", {}),
        ("DELETE", f"/watchlists/{missing_id}/symbols/AAPL", {}),
    ):
        response = client.request(method, path, headers=owner_headers, **kwargs)
        assert response.status_code == 404, response.text
        assert response.json() == _NOT_FOUND

    collection = client.get("/watchlists", headers=owner_headers)
    assert collection.status_code == 200, collection.text
    payload = collection.json()
    assert set(payload) == {"watchlists"}
    assert [row["id"] for row in payload["watchlists"]] == [alpha_id, alpha_lower_id]
    assert [row["name"] for row in payload["watchlists"]] == ["Core", "alpha"]
    assert all(row["symbols"] == [] and "user_id" not in row for row in payload["watchlists"])
    assert "user_id" not in collection.text
    assert "Admin book" not in collection.text and "Compliance book" not in collection.text
    assert other_id not in {row["id"] for row in payload["watchlists"]}

    removed = client.delete(f"/watchlists/{alpha_lower_id}", headers=owner_headers)
    assert removed.status_code == 204 and removed.content == b""
    kept = client.get("/watchlists", headers=owner_headers).json()["watchlists"]
    assert [row["id"] for row in kept] == [alpha_id]
    assert client.get("/watchlists", headers=other_headers).json()["watchlists"][0]["id"] == other_id
    for bad in (0, -1):
        assert client.patch(f"/watchlists/{bad}", headers=owner_headers, json={"name": "Z"}).status_code == 422
        assert client.delete(f"/watchlists/{bad}", headers=owner_headers).status_code == 422
        assert client.post(f"/watchlists/{bad}/symbols", headers=owner_headers, json={"symbol": "AAPL"}).status_code == 422
    assert _money(db_session) == before


def test_strict_bodies_reject_null_blank_extra_and_overlong(client: TestClient, auth_headers, db_session: Session) -> None:
    headers = auth_headers("strict-lists@example.com")
    _user(db_session, "strict-lists@example.com")
    before = _money(db_session)
    valid = client.post("/watchlists", headers=headers, json={"name": "Kept"})
    assert valid.status_code == 201, valid.text
    list_id = valid.json()["id"]
    for body in (
        {"name": None},
        {"name": "   "},
        {"name": "x" * 41},
        {"name": 1},
        {"name": "Ok", "extra": 1},
        {},
    ):
        assert client.post("/watchlists", headers=headers, json=body).status_code == 422
    for body in (
        {},
        {"name": None},
        {"symbol_order": None},
        {"name": "   "},
        {"name": "y" * 41},
        {"name": "Ok", "unknown": True},
        {"symbol_order": "AAPL"},
        {"symbol_order": [None]},
    ):
        assert client.patch(f"/watchlists/{list_id}", headers=headers, json=body).status_code == 422
    for body in (
        {"symbol": None},
        {"symbol": "   "},
        {"symbol": "z" * 21},
        {"symbol": 1},
        {"symbol": "AAPL", "note": "no"},
        {},
    ):
        assert client.post(f"/watchlists/{list_id}/symbols", headers=headers, json=body).status_code == 422
    assert client.delete(f"/watchlists/{list_id}/symbols/{'z' * 21}", headers=headers).status_code == 422
    assert client.get("/watchlists", headers=headers).json()["watchlists"] == [
        {"id": list_id, "name": "Kept", "symbols": []},
    ]
    assert _money(db_session) == before


def test_membership_activity_reorder_and_caps(client: TestClient, auth_headers, db_session: Session) -> None:
    headers = auth_headers("members@example.com")
    other_headers = auth_headers("members-other@example.com")
    _user(db_session, "members@example.com")
    _user(db_session, "members-other@example.com")
    active = [f"S{index:02d}" for index in range(1, 51)]
    _seed_symbols(db_session, active + ["DEAD", "MSFT"])
    dead = db_session.get(MarketSymbol, "DEAD")
    assert dead is not None
    dead.is_active = False
    db_session.commit()
    before = _money(db_session)

    first = client.post("/watchlists", headers=headers, json={"name": "Book"})
    second = client.post("/watchlists", headers=headers, json={"name": "Other"})
    assert first.status_code == second.status_code == 201
    book_id = first.json()["id"]
    other_book = second.json()["id"]
    assert book_id < other_book

    added = client.post(f"/watchlists/{book_id}/symbols", headers=headers, json={"symbol": "  msft "})
    assert added.status_code == 201, added.text
    _assert_list(added.json(), "Book", [("MSFT", 1)])
    again = client.post(f"/watchlists/{book_id}/symbols", headers=headers, json={"symbol": "msft"})
    assert again.status_code == 200, again.text
    _assert_list(again.json(), "Book", [("MSFT", 1)])
    assert client.post(f"/watchlists/{book_id}/symbols", headers=headers, json={"symbol": "s02"}).status_code == 201
    third = client.post(f"/watchlists/{book_id}/symbols", headers=headers, json={"symbol": "s01"})
    assert third.status_code == 201, third.text
    _assert_list(third.json(), "Book", [("MSFT", 1), ("S02", 2), ("S01", 3)])

    inactive_new = client.post(f"/watchlists/{book_id}/symbols", headers=headers, json={"symbol": "dead"})
    unknown = client.post(f"/watchlists/{book_id}/symbols", headers=headers, json={"symbol": "nope"})
    assert inactive_new.status_code == unknown.status_code == 400
    assert inactive_new.json() == unknown.json() == _UNKNOWN
    msft = db_session.get(MarketSymbol, "MSFT")
    assert msft is not None
    msft.is_active = False
    db_session.commit()
    still = client.post(f"/watchlists/{book_id}/symbols", headers=headers, json={"symbol": "msft"})
    assert still.status_code == 200, still.text
    _assert_list(still.json(), "Book", [("MSFT", 1), ("S02", 2), ("S01", 3)])

    for body in (
        {"name": "Renamed", "symbol_order": ["S01"]},
        {"name": "Renamed", "symbol_order": []},
        {"name": "Renamed", "symbol_order": ["MSFT", "MSFT", "S01"]},
        {"name": "Renamed", "symbol_order": ["MSFT", "S02", "S01", "S03"]},
    ):
        rejected = client.patch(f"/watchlists/{book_id}", headers=headers, json=body)
        assert rejected.status_code == 422, rejected.text
    assert client.get("/watchlists", headers=headers).json()["watchlists"][0]["name"] == "Book"
    assert [
        (row["symbol"], row["position"])
        for row in client.get("/watchlists", headers=headers).json()["watchlists"][0]["symbols"]
    ] == [("MSFT", 1), ("S02", 2), ("S01", 3)]
    exact = client.patch(
        f"/watchlists/{book_id}",
        headers=headers,
        json={"name": "Renamed", "symbol_order": ["MSFT", "S02", "S01", "S03"]},
    )
    assert exact.status_code == 422 and exact.json() == _ORDER

    ordered = client.patch(
        f"/watchlists/{book_id}",
        headers=headers,
        json={"name": "Sorted", "symbol_order": [" s01 ", "msft", "S02"]},
    )
    assert ordered.status_code == 200, ordered.text
    _assert_list(ordered.json(), "Sorted", [("S01", 1), ("MSFT", 2), ("S02", 3)])
    assert client.delete(f"/watchlists/{book_id}/symbols/msft", headers=headers).status_code == 204
    missing_symbol = client.delete(f"/watchlists/{book_id}/symbols/S03", headers=headers)
    assert missing_symbol.status_code == 404 and missing_symbol.json() == _SYMBOL_MISSING
    follow = client.get("/watchlists", headers=headers)
    assert follow.json()["watchlists"] == [
        {"id": book_id, "name": "Sorted", "symbols": [
            {"symbol": "S01", "position": 1},
            {"symbol": "S02", "position": 3},
        ]},
        {"id": other_book, "name": "Other", "symbols": []},
    ]
    assert client.delete(f"/watchlists/{book_id}", headers=headers).status_code == 204
    assert [row["id"] for row in client.get("/watchlists", headers=headers).json()["watchlists"]] == [other_book]
    assert client.get("/watchlists", headers=other_headers).json()["watchlists"] == []

    capped = client.post("/watchlists", headers=headers, json={"name": "Cap"})
    assert capped.status_code == 201, capped.text
    cap_id = capped.json()["id"]
    for symbol in active:
        created = client.post(f"/watchlists/{cap_id}/symbols", headers=headers, json={"symbol": symbol})
        assert created.status_code == 201, created.text
    duplicate_at_cap = client.post(f"/watchlists/{cap_id}/symbols", headers=headers, json={"symbol": "S01"})
    assert duplicate_at_cap.status_code == 200, duplicate_at_cap.text
    assert len(duplicate_at_cap.json()["symbols"]) == 50
    blocked = client.post(f"/watchlists/{cap_id}/symbols", headers=headers, json={"symbol": "MSFT"})
    assert blocked.status_code == 409 and blocked.json() == _MEMBER_CAP
    # Other + Cap are 2. Eighteen more names reach the 20-list cap.
    for index in range(3, 21):
        created = client.post("/watchlists", headers=headers, json={"name": f"List {index:02d}"})
        assert created.status_code == 201, created.text
    too_many = client.post("/watchlists", headers=headers, json={"name": "List 21"})
    assert too_many.status_code == 409 and too_many.json() == _LIST_CAP
    names = [row["name"] for row in client.get("/watchlists", headers=headers).json()["watchlists"]]
    assert len(names) == 20 and "List 21" not in names
    assert _money(db_session) == before


def test_collection_read_is_one_outer_join(client: TestClient, auth_headers, db_session: Session) -> None:
    headers = auth_headers("join@example.com")
    _user(db_session, "join@example.com")
    _seed_symbols(db_session, ["AAPL", "MSFT", "NVDA"])
    before = _money(db_session)
    empty = client.post("/watchlists", headers=headers, json={"name": "Empty"})
    filled = client.post("/watchlists", headers=headers, json={"name": "Filled"})
    assert empty.status_code == filled.status_code == 201
    filled_id = filled.json()["id"]
    for symbol in ("NVDA", "AAPL", "MSFT"):
        assert client.post(
            f"/watchlists/{filled_id}/symbols", headers=headers, json={"symbol": symbol},
        ).status_code == 201
    engine = db_session.get_bind()
    statements: list[str] = []
    selects: list[str] = []

    def capture(conn, cursor, statement, parameters, context, executemany) -> None:
        sql = " ".join(statement.split())
        statements.append(sql)
        if sql[:6].upper() == "SELECT" and "watchlist" in sql.lower():
            selects.append(sql)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        listed = client.get("/watchlists", headers=headers)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert listed.status_code == 200, listed.text
    rows = listed.json()["watchlists"]
    assert [row["name"] for row in rows] == ["Empty", "Filled"]
    assert rows[0]["symbols"] == []
    assert [(item["symbol"], item["position"]) for item in rows[1]["symbols"]] == [
        ("NVDA", 1), ("AAPL", 2), ("MSFT", 3),
    ]
    assert len(selects) == 1
    sql = selects[0].lower()
    assert "watchlists" in sql and "watchlist_items" in sql
    assert "left" in sql and "join" in sql
    assert "order by" in sql and "position" in sql and "symbol" in sql
    assert not any(item.lstrip().upper().startswith("BEGIN IMMEDIATE") for item in statements)
    assert _money(db_session) == before


def test_slash_symbol_round_trip(client: TestClient, auth_headers, db_session: Session) -> None:
    headers = auth_headers("slash-symbol@example.com")
    _seed_symbols(db_session, ["SHARE/A"])
    created = client.post("/watchlists", headers=headers, json={"name": "Slash"})
    assert created.status_code == 201, created.text
    list_id = created.json()["id"]
    added = client.post(f"/watchlists/{list_id}/symbols", headers=headers, json={"symbol": "share/a"})
    assert added.status_code == 201, added.text
    _assert_list(added.json(), "Slash", [("SHARE/A", 1)])
    removed = client.delete(f"/watchlists/{list_id}/symbols/SHARE%2FA", headers=headers)
    assert removed.status_code == 204 and removed.content == b""
    listed = client.get("/watchlists", headers=headers)
    assert listed.status_code == 200, listed.text
    assert listed.json()["watchlists"] == [{"id": list_id, "name": "Slash", "symbols": []}]


def _file_clients(tmp_path, *, timeout: float):
    database = (tmp_path / "watchlists.db").as_posix()
    engine = create_engine(
        f"sqlite:///{database}",
        connect_args={"check_same_thread": False, "timeout": timeout},
        future=True,
    )
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
    Base.metadata.create_all(bind=engine)
    saved = dict(app.dependency_overrides)

    def override_get_db():
        session = TestingSession()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides.clear()
    app.dependency_overrides[get_db] = override_get_db
    clients = [TestClient(app), TestClient(app)]

    def restore() -> None:
        for item in clients:
            item.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(saved)
        engine.dispose()

    return TestingSession, clients, engine, restore


def _finish_writers(threads: list[threading.Thread], release: threading.Event) -> None:
    release.set()
    for thread in threads:
        if thread.ident is not None:
            thread.join(5)
    assert not any(thread.is_alive() for thread in threads)


def test_sqlite_file_create_at_19_blocks_until_commit(tmp_path) -> None:
    TestingSession, clients, engine, restore = _file_clients(tmp_path, timeout=5)
    held = threading.Event()
    release = threading.Event()
    second_begin = threading.Event()
    second_begin_done = threading.Event()
    state = {"armed": False, "holder": None}
    results: list[tuple[int, dict]] = []
    threads: list[threading.Thread] = []

    def before(conn, cursor, statement, parameters, context, executemany) -> None:
        if not statement.strip().upper().startswith("BEGIN IMMEDIATE"):
            return
        ident = id(conn.connection.dbapi_connection)
        if state["holder"] is not None and ident != state["holder"]:
            second_begin.set()

    def after(conn, cursor, statement, parameters, context, executemany) -> None:
        ident = id(conn.connection.dbapi_connection)
        if statement.strip().upper().startswith("BEGIN IMMEDIATE") and state["holder"] not in {None, ident}:
            second_begin_done.set()
            return
        if not state["armed"] or "insert into watchlists" not in statement.lower() or state["holder"] is not None:
            return
        state["holder"] = ident
        held.set()
        assert release.wait(5), "holder was not released"

    event.listen(engine, "before_cursor_execute", before)
    event.listen(engine, "after_cursor_execute", after)
    try:
        left, right = clients
        registered = left.post("/auth/register", json={"email": "race@example.com", "password": "password123"})
        assert registered.status_code == 200, registered.text
        token = left.post("/auth/login", data={"username": "race@example.com", "password": "password123"})
        assert token.status_code == 200, token.text
        headers = {"Authorization": f"Bearer {token.json()['access_token']}"}
        with TestingSession() as session:
            _user(session, "race@example.com")
            before_money = _money(session)
        for index in range(19):
            created = left.post("/watchlists", headers=headers, json={"name": f"Held {index:02d}"})
            assert created.status_code == 201, created.text
        state["armed"] = True

        def create(client: TestClient, name: str) -> None:
            response = client.post("/watchlists", headers=headers, json={"name": name})
            results.append((response.status_code, response.json()))

        first = threading.Thread(target=create, args=(left, "Race Left"), daemon=True)
        second = threading.Thread(target=create, args=(right, "Race Right"), daemon=True)
        threads.extend((first, second))
        first.start()
        assert held.wait(5), "first writer did not reach its watchlist insert"
        second.start()
        assert second_begin.wait(5), "second writer did not reach BEGIN IMMEDIATE"
        assert not second_begin_done.wait(0.2)
        release.set()
        first.join(5)
        second.join(5)
        assert not first.is_alive() and not second.is_alive()
        codes = [code for code, _body in results]
        assert sorted(codes) == [201, 409]
        assert results[codes.index(409)][1] == _LIST_CAP
        listed = left.get("/watchlists", headers=headers)
        assert listed.status_code == 200, listed.text
        body = listed.json()["watchlists"]
        assert len(body) == 20
        assert len({row["name"] for row in body}.intersection({"Race Left", "Race Right"})) == 1
        with TestingSession() as session:
            assert _money(session) == before_money
    finally:
        event.remove(engine, "before_cursor_execute", before)
        event.remove(engine, "after_cursor_execute", after)
        _finish_writers(threads, release)
        restore()


def test_sqlite_file_busy_timeout_is_retryable_503(tmp_path) -> None:
    TestingSession, clients, engine, restore = _file_clients(tmp_path, timeout=0.2)
    held = threading.Event()
    release = threading.Event()
    state = {"armed": False}
    outcome: dict[str, tuple[int, dict]] = {}
    threads: list[threading.Thread] = []

    def after(conn, cursor, statement, parameters, context, executemany) -> None:
        if not state["armed"] or "insert into watchlists" not in statement.lower() or held.is_set():
            return
        held.set()
        assert release.wait(5), "busy holder was not released"

    event.listen(engine, "after_cursor_execute", after)
    try:
        left, right = clients
        assert left.post(
            "/auth/register",
            json={"email": "busy@example.com", "password": "password123"},
        ).status_code == 200
        token = left.post("/auth/login", data={"username": "busy@example.com", "password": "password123"})
        assert token.status_code == 200, token.text
        headers = {"Authorization": f"Bearer {token.json()['access_token']}"}
        with TestingSession() as session:
            _user(session, "busy@example.com")
            before_money = _money(session)
        for index in range(19):
            assert left.post(
                "/watchlists", headers=headers, json={"name": f"Busy {index:02d}"},
            ).status_code == 201
        state["armed"] = True

        def create(client: TestClient, name: str, slot: str) -> None:
            response = client.post("/watchlists", headers=headers, json={"name": name})
            outcome[slot] = (response.status_code, response.json())

        first = threading.Thread(target=create, args=(left, "Busy Left", "first"), daemon=True)
        second = threading.Thread(target=create, args=(right, "Busy Right", "second"), daemon=True)
        threads.extend((first, second))
        first.start()
        assert held.wait(5)
        second.start()
        second.join(5)
        assert not second.is_alive()
        assert not release.is_set()
        assert outcome["second"] == (503, _BUSY)
        release.set()
        first.join(5)
        assert outcome["first"][0] == 201
        assert outcome["first"][1]["name"] == "Busy Left"
        listed = left.get("/watchlists", headers=headers).json()["watchlists"]
        assert len(listed) == 20
        assert "Busy Right" not in {row["name"] for row in listed}
        with TestingSession() as session:
            assert _money(session) == before_money
    finally:
        event.remove(engine, "after_cursor_execute", after)
        _finish_writers(threads, release)
        restore()
