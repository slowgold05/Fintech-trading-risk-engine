"""Watchlist migration proofs on an allowlisted disposable PostgreSQL instance.

Skipped unless AUDIT_DATABASE_URL is set. A set URL is refused, before any
connection or role change, unless the existing preview guard accepts it.
Fresh and upgrade are separate cases. This file does not claim a production backup.
"""

import hashlib
import json
import os
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi import Response
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from app.models.market_bar_daily import MarketBarDaily
from app.models.market_symbol import MarketSymbol
from app.models.price_history_daily import PriceHistoryDaily
from app.models.user import User
from app.routers.watchlists import (
    add_symbol,
    create_watchlist,
    delete_symbol,
    delete_watchlist,
    patch_watchlist,
)
from app.schemas.watchlist import WatchlistCreate, WatchlistPatch, WatchlistSymbolCreate
from app.scripts.configure_postgres_role import configure
from app.services.ledger_service import ensure_opening
from tests.test_order_preview_postgres import _disposable_url

pytestmark = pytest.mark.skipif(not os.environ.get("AUDIT_DATABASE_URL"), reason="AUDIT_DATABASE_URL is not set")

BASELINE = "a21c9e7d4b60"
# The watchlist migration's own revision, not necessarily the current repo
# head — this module proves that migration is additive/reversible in
# isolation, independent of whatever has been layered on top of it since.
WATCHLIST_REVISION = "b73e2d9f6a10"
_PREFIX = "p3b_watchlist_schema_"
_NEW_TABLES = frozenset({"watchlists", "watchlist_items"})
_HEX = frozenset("0123456789abcdef")
_SKIP_DIGEST = frozenset({"alembic_version"})


def _safe_database_name(name: str) -> bool:
    suffix = name[len(_PREFIX):] if name.startswith(_PREFIX) else ""
    return len(suffix) == 32 and _HEX.issuperset(suffix)


@pytest.fixture
def isolated_watchlist_database(monkeypatch):
    """Allowlist the audit URL, then create one database on that same instance."""
    raw = _disposable_url()
    owner = make_url(raw)
    name = _PREFIX + uuid4().hex
    assert _safe_database_name(name)
    admin = create_engine(owner, isolation_level="AUTOCOMMIT", poolclass=NullPool)
    engine = None
    try:
        with admin.connect() as db:
            db.exec_driver_sql(f'CREATE DATABASE "{name}"')
        target = owner.set(database=name)
        monkeypatch.setenv("MIGRATION_DATABASE_URL", target.render_as_string(hide_password=False))
        engine = create_engine(target, poolclass=NullPool)
        with engine.connect() as db:
            assert db.execute(text("SELECT current_database()")).scalar_one() == name
        yield engine, target
    finally:
        if engine is not None:
            engine.dispose()
        if _safe_database_name(name):
            with admin.connect() as db:
                db.exec_driver_sql(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = %(name)s AND pid <> pg_backend_pid()",
                    {"name": name},
                )
                db.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}"')
        admin.dispose()


def _digests(engine, only=None):
    result = {}
    with engine.connect() as db:
        for table in inspect(db).get_table_names():
            if table in _SKIP_DIGEST or (only is not None and table not in only):
                continue
            quoted = db.dialect.identifier_preparer.quote(table)
            rows = db.exec_driver_sql(f"SELECT * FROM {quoted}").all()
            encoded = sorted(json.dumps(list(row), default=str) for row in rows)
            result[table] = hashlib.sha256("\n".join(encoded).encode()).hexdigest()
    return result


def _seed(engine):
    with Session(engine) as db:
        user = User(
            email=f"watchlist-migration-{uuid4().hex}@example.com",
            password_hash="fixture",
            cash_balance=Decimal("100000.00"),
            role="trader",
        )
        db.add(user)
        db.add_all([
            MarketSymbol(symbol="P3BWA", company_name="Fixture A", exchange="NASDAQ", is_active=True),
            MarketSymbol(symbol="P3BWB", company_name="Fixture B", exchange="NASDAQ", is_active=True),
        ])
        db.flush()
        ensure_opening(db, user)
        db.add(PriceHistoryDaily(
            symbol="P3BWA",
            date=date(2026, 11, 4),
            open=Decimal("10"),
            high=Decimal("12"),
            low=Decimal("9"),
            close=Decimal("11"),
            volume=100,
            source="legacy-fixture",
        ))
        db.add(MarketBarDaily(
            symbol="P3BWA",
            session_date=date(2026, 11, 4),
            provider="fixture",
            adjustment_type="raw",
            open=Decimal("10"),
            high=Decimal("12"),
            low=Decimal("9"),
            close=Decimal("11"),
            volume=100,
            fetched_at=datetime(2026, 11, 4, 21, 0, tzinfo=timezone.utc),
            quality_status="valid",
        ))
        db.commit()
        return int(user.id)


def _preserved_counts(engine):
    with engine.connect() as db:
        return {
            "users": db.execute(text("SELECT count(*) FROM users")).scalar_one(),
            "ledger_entries": db.execute(text("SELECT count(*) FROM ledger_entries")).scalar_one(),
            "market_symbols": db.execute(text("SELECT count(*) FROM market_symbols")).scalar_one(),
            "price_history_daily": db.execute(text("SELECT count(*) FROM price_history_daily")).scalar_one(),
            "market_bars_daily": db.execute(text("SELECT count(*) FROM market_bars_daily")).scalar_one(),
        }


def _user_proof(engine, user_id):
    with engine.connect() as db:
        row = db.execute(
            text(
                "SELECT id, email, password_hash, full_name, role, cash_balance, created_at "
                "FROM users WHERE id = :id"
            ),
            {"id": user_id},
        ).one()
    encoded = json.dumps(list(row), default=str)
    return row.cash_balance, row.role, hashlib.sha256(encoded.encode()).hexdigest()


def _assert_watchlist_schema(engine):
    info = inspect(engine)
    assert _NEW_TABLES <= set(info.get_table_names())
    list_columns = {column["name"]: column for column in info.get_columns("watchlists")}
    item_columns = {column["name"]: column for column in info.get_columns("watchlist_items")}
    assert set(list_columns) == {"id", "user_id", "name"}
    assert list_columns["name"]["nullable"] is False
    assert getattr(list_columns["name"]["type"], "length", None) == 40
    assert set(item_columns) == {"watchlist_id", "symbol", "position"}
    assert item_columns["position"]["nullable"] is False
    assert info.get_pk_constraint("watchlists")["constrained_columns"] == ["id"]
    assert info.get_pk_constraint("watchlist_items")["constrained_columns"] == ["watchlist_id", "symbol"]
    unique = {item["name"]: item["column_names"] for item in info.get_unique_constraints("watchlists")}
    assert unique["uq_watchlists_user_name"] == ["user_id", "name"]
    list_checks = {item["name"] for item in info.get_check_constraints("watchlists")}
    item_checks = {item["name"] for item in info.get_check_constraints("watchlist_items")}
    assert "ck_watchlists_name_length" in list_checks
    assert "ck_watchlist_items_position_positive" in item_checks
    indexes = {item["name"] for item in info.get_indexes("watchlists")}
    assert "ix_watchlists_user_id" in indexes

    def _fk(table, column):
        matches = [fk for fk in info.get_foreign_keys(table) if fk["constrained_columns"] == [column]]
        assert len(matches) == 1
        return matches[0]

    user_fk = _fk("watchlists", "user_id")
    list_fk = _fk("watchlist_items", "watchlist_id")
    symbol_fk = _fk("watchlist_items", "symbol")
    assert user_fk["referred_table"] == "users" and user_fk["referred_columns"] == ["id"]
    assert (user_fk.get("options") or {}).get("ondelete") == "CASCADE"
    assert list_fk["referred_table"] == "watchlists" and list_fk["referred_columns"] == ["id"]
    assert (list_fk.get("options") or {}).get("ondelete") == "CASCADE"
    assert symbol_fk["referred_table"] == "market_symbols" and symbol_fk["referred_columns"] == ["symbol"]
    assert (symbol_fk.get("options") or {}).get("ondelete") == "RESTRICT"


def _expect_constraint_failure(engine, statement, params):
    with pytest.raises(DBAPIError):
        with engine.begin() as db:
            db.execute(text(statement), params)
    with engine.connect() as db:
        assert db.execute(text("SELECT 1")).scalar_one() == 1


def _assert_constraint_errors(owner_engine, app_engine, user_id):
    _expect_constraint_failure(
        app_engine,
        "INSERT INTO watchlists (user_id, name) VALUES (:user_id, :name)",
        {"user_id": user_id, "name": ""},
    )
    _expect_constraint_failure(
        app_engine,
        "INSERT INTO watchlists (user_id, name) VALUES (:user_id, :name)",
        {"user_id": user_id, "name": "x" * 41},
    )
    with app_engine.begin() as db:
        db.execute(
            text("INSERT INTO watchlists (user_id, name) VALUES (:user_id, 'Owned')"),
            {"user_id": user_id},
        )
    _expect_constraint_failure(
        app_engine,
        "INSERT INTO watchlists (user_id, name) VALUES (:user_id, 'Owned')",
        {"user_id": user_id},
    )
    _expect_constraint_failure(
        app_engine,
        "INSERT INTO watchlists (user_id, name) VALUES (:user_id, 'Missing owner')",
        {"user_id": -1},
    )
    with app_engine.connect() as db:
        watchlist_id = db.execute(text("SELECT id FROM watchlists WHERE name = 'Owned'")).scalar_one()
    _expect_constraint_failure(
        app_engine,
        "INSERT INTO watchlist_items (watchlist_id, symbol, position) VALUES (:watchlist_id, 'P3BWA', 0)",
        {"watchlist_id": watchlist_id},
    )
    _expect_constraint_failure(
        app_engine,
        "INSERT INTO watchlist_items (watchlist_id, symbol, position) VALUES (:watchlist_id, 'MISSING', 1)",
        {"watchlist_id": watchlist_id},
    )
    with app_engine.begin() as db:
        db.execute(
            text(
                "INSERT INTO watchlist_items (watchlist_id, symbol, position) "
                "VALUES (:watchlist_id, 'P3BWA', 1)"
            ),
            {"watchlist_id": watchlist_id},
        )
    _expect_constraint_failure(
        app_engine,
        "INSERT INTO watchlist_items (watchlist_id, symbol, position) VALUES (:watchlist_id, 'P3BWA', 2)",
        {"watchlist_id": watchlist_id},
    )

    with app_engine.connect() as db:
        outer = db.begin()
        try:
            db.execute(
                text("INSERT INTO watchlists (user_id, name) VALUES (:user_id, 'Cascade list')"),
                {"user_id": user_id},
            )
            child_id = db.execute(text("SELECT id FROM watchlists WHERE name = 'Cascade list'")).scalar_one()
            db.execute(
                text(
                    "INSERT INTO watchlist_items (watchlist_id, symbol, position) "
                    "VALUES (:watchlist_id, 'P3BWB', 1)"
                ),
                {"watchlist_id": child_id},
            )
            db.execute(text("DELETE FROM watchlists WHERE id = :id"), {"id": child_id})
            remaining = db.execute(
                text("SELECT count(*) FROM watchlist_items WHERE watchlist_id = :id"),
                {"id": child_id},
            ).scalar_one()
            assert remaining == 0
        finally:
            outer.rollback()

    with owner_engine.connect() as db:
        outer = db.begin()
        try:
            db.execute(
                text(
                    "INSERT INTO users (email, password_hash, cash_balance, role) "
                    "VALUES (:email, 'fixture', 1, 'trader')"
                ),
                {"email": f"watchlist-cascade-{uuid4().hex}@example.com"},
            )
            extra_id = db.execute(text("SELECT id FROM users ORDER BY id DESC LIMIT 1")).scalar_one()
            db.execute(
                text("INSERT INTO watchlists (user_id, name) VALUES (:user_id, 'User cascade')"),
                {"user_id": extra_id},
            )
            db.execute(text("DELETE FROM users WHERE id = :id"), {"id": extra_id})
            remaining = db.execute(
                text("SELECT count(*) FROM watchlists WHERE user_id = :id"),
                {"id": extra_id},
            ).scalar_one()
            assert remaining == 0
        finally:
            outer.rollback()
        symbol_delete = db.begin()
        try:
            with pytest.raises(DBAPIError):
                db.execute(text("DELETE FROM market_symbols WHERE symbol = 'P3BWA'"))
        finally:
            symbol_delete.rollback()

    with app_engine.begin() as db:
        db.execute(text("DELETE FROM watchlist_items WHERE watchlist_id = :id"), {"id": watchlist_id})
        db.execute(text("DELETE FROM watchlists WHERE id = :id"), {"id": watchlist_id})


def _prove_app_role(owner_engine, owner_url, user_id, baseline, counts):
    password = uuid4().hex
    configure(owner_url.render_as_string(hide_password=False), password)
    app_engine = create_engine(
        owner_url.set(username="fintech_app", password=password),
        poolclass=NullPool,
    )
    try:
        before_user = _user_proof(app_engine, user_id)
        before_ledger = _digests(app_engine, only={"ledger_entries"})
        with Session(app_engine) as db:
            locked = db.execute(select(User.id).where(User.id == user_id).with_for_update()).scalar_one()
            assert locked == user_id
            db.rollback()
            current_user = SimpleNamespace(id=user_id)
            created = create_watchlist(WatchlistCreate(name="Alpha"), db, current_user)
            renamed = patch_watchlist(WatchlistPatch(name="Beta"), int(created.id), db, current_user)
            assert renamed.name == "Beta"
            first = Response()
            added = add_symbol(
                WatchlistSymbolCreate(symbol="p3bwa"),
                first,
                int(renamed.id),
                db,
                current_user,
            )
            assert first.status_code == 201
            assert [item.symbol for item in added.symbols] == ["P3BWA"]
            second = Response()
            add_symbol(
                WatchlistSymbolCreate(symbol="P3BWB"),
                second,
                int(renamed.id),
                db,
                current_user,
            )
            assert second.status_code == 201
            ordered = patch_watchlist(
                WatchlistPatch(symbol_order=["P3BWB", "P3BWA"]),
                int(renamed.id),
                db,
                current_user,
            )
            assert [(item.symbol, item.position) for item in ordered.symbols] == [("P3BWB", 1), ("P3BWA", 2)]
            delete_symbol("p3bwa", int(renamed.id), db, current_user)
            delete_watchlist(int(renamed.id), db, current_user)

        with app_engine.begin() as db:
            db.execute(
                text("INSERT INTO watchlists (user_id, name) VALUES (:user_id, 'Raw')"),
                {"user_id": user_id},
            )
            raw_id = db.execute(text("SELECT id FROM watchlists WHERE name = 'Raw'")).scalar_one()
            db.execute(text("UPDATE watchlists SET name = 'Raw two' WHERE id = :id"), {"id": raw_id})
            db.execute(
                text(
                    "INSERT INTO watchlist_items (watchlist_id, symbol, position) "
                    "VALUES (:watchlist_id, 'P3BWB', 1)"
                ),
                {"watchlist_id": raw_id},
            )
            db.execute(
                text("UPDATE watchlist_items SET position = 2 WHERE watchlist_id = :id"),
                {"id": raw_id},
            )
            db.execute(text("DELETE FROM watchlist_items WHERE watchlist_id = :id"), {"id": raw_id})
            db.execute(text("DELETE FROM watchlists WHERE id = :id"), {"id": raw_id})

        assert _user_proof(app_engine, user_id) == before_user
        assert _digests(app_engine, only={"ledger_entries"}) == before_ledger
        assert _digests(owner_engine, only=set(baseline)) == baseline
        assert _preserved_counts(owner_engine) == counts

        with pytest.raises(DBAPIError):
            with app_engine.begin() as db:
                db.execute(text("UPDATE users SET role = 'admin'"))
        with pytest.raises(DBAPIError):
            with app_engine.begin() as db:
                db.execute(text("UPDATE ledger_entries SET amount = 0"))
        with pytest.raises(DBAPIError):
            with app_engine.begin() as db:
                db.execute(text("DELETE FROM ledger_entries"))
        assert _user_proof(app_engine, user_id) == before_user
        assert _digests(app_engine, only={"ledger_entries"}) == before_ledger

        _assert_constraint_errors(owner_engine, app_engine, user_id)
        assert _user_proof(owner_engine, user_id) == before_user
        assert _digests(owner_engine, only=set(baseline)) == baseline
        assert _preserved_counts(owner_engine) == counts
    finally:
        app_engine.dispose()


@pytest.mark.parametrize("mode", ["fresh", "upgrade"])
def test_watchlist_migration_preserves_baseline_and_app_grants(isolated_watchlist_database, mode):
    engine, owner_url = isolated_watchlist_database
    config = Config("alembic.ini")
    if mode == "upgrade":
        command.upgrade(config, BASELINE)
        with engine.connect() as db:
            assert db.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == BASELINE
        user_id = _seed(engine)
        before_names = set(inspect(engine).get_table_names())
        baseline = _digests(engine)
        counts = _preserved_counts(engine)
        command.upgrade(config, WATCHLIST_REVISION)
        with engine.connect() as db:
            assert db.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == WATCHLIST_REVISION
        after_names = set(inspect(engine).get_table_names())
        assert after_names - before_names == set(_NEW_TABLES)
        assert _NEW_TABLES.isdisjoint(before_names)
        assert _digests(engine, only=set(baseline)) == baseline
    elif mode == "fresh":
        command.upgrade(config, WATCHLIST_REVISION)
        with engine.connect() as db:
            assert db.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == WATCHLIST_REVISION
            assert db.execute(text("SELECT count(*) FROM watchlists")).scalar_one() == 0
            assert db.execute(text("SELECT count(*) FROM watchlist_items")).scalar_one() == 0
        _assert_watchlist_schema(engine)
        user_id = _seed(engine)
        baseline = {
            table: digest
            for table, digest in _digests(engine).items()
            if table not in _NEW_TABLES
        }
        counts = _preserved_counts(engine)
    else:
        raise AssertionError("unknown migration case")

    assert counts == {
        "users": 1,
        "ledger_entries": 2,
        "market_symbols": 2,
        "price_history_daily": 1,
        "market_bars_daily": 1,
    }
    _prove_app_role(engine, owner_url, user_id, baseline, counts)

    command.downgrade(config, BASELINE)
    names = set(inspect(engine).get_table_names())
    assert _NEW_TABLES.isdisjoint(names)
    with engine.connect() as db:
        assert db.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == BASELINE
    assert _digests(engine) == baseline
    assert _preserved_counts(engine) == counts
