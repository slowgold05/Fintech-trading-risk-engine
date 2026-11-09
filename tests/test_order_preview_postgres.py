"""PostgreSQL proofs for read-only order preview.

Skipped unless AUDIT_DATABASE_URL is set. A set URL is refused, before any
connection, unless it is a local disposable database.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import os
import re
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

import app.services.order_preview as order_preview
from app.models.asset import Asset
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.order import Order
from app.models.trading_halt import TradingHaltState
from app.models.user import User
from app.schemas.order import OrderCreate


pytestmark = pytest.mark.skipif(
    not os.environ.get("AUDIT_DATABASE_URL"),
    reason="AUDIT_DATABASE_URL is not set",
)

_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_MUTATION = re.compile(r"\b(INSERT|UPDATE|DELETE|FOR\s+UPDATE)\b", re.IGNORECASE)
_PREVIEW_KEYS = (
    "symbol",
    "side",
    "order_type",
    "quantity",
    "limit_price",
    "read_at",
    "quote_observed_at",
    "status",
    "reason",
    "step_up_required",
    "buying_power",
    "sell_available",
    "initial_reservation",
    "estimated_fill_quantity",
    "estimated_fill_notional",
    "unfilled_quantity",
)


def _disposable_url() -> str:
    raw = os.environ.get("AUDIT_DATABASE_URL")
    if not raw:
        pytest.skip("AUDIT_DATABASE_URL is not set")
    try:
        parsed = make_url(raw)
    except Exception:
        raise RuntimeError("AUDIT_DATABASE_URL could not be parsed") from None
    issues = []
    if parsed.drivername.split("+", 1)[0] != "postgresql":
        issues.append("dialect")
    if (parsed.host or "").lower() not in {"127.0.0.1", "localhost"}:
        issues.append("host")
    if (parsed.database or "") not in {"ci_audit", "p3b_preview"}:
        issues.append("database")
    if (parsed.username or "") not in {"ci_audit", "p3b_preview"}:
        issues.append("username")
    if issues:
        raise RuntimeError("refusing non-disposable database target: " + ",".join(issues))
    return raw


def _upgrade(url: str) -> None:
    """Migrate the allowlisted URL. env.py rewrites sqlalchemy.url from the process variable."""
    from alembic import command
    from alembic.config import Config

    previous = os.environ.get("MIGRATION_DATABASE_URL")
    os.environ["MIGRATION_DATABASE_URL"] = url
    try:
        config = Config("alembic.ini")
        config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
        command.upgrade(config, "head")
    finally:
        if previous is None:
            os.environ.pop("MIGRATION_DATABASE_URL", None)
        else:
            os.environ["MIGRATION_DATABASE_URL"] = previous


def _quote_ident(name: str) -> str:
    if not _IDENTIFIER.fullmatch(name):
        raise RuntimeError("refusing unexpected database identifier")
    return '"' + name + '"'


def _public_relations(db, relkind: str) -> list[str]:
    rows = db.execute(
        text(
            "SELECT c.relname FROM pg_class AS c "
            "JOIN pg_namespace AS n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind = :relkind "
            "ORDER BY c.relname"
        ),
        {"relkind": relkind},
    ).scalars()
    return list(rows)


def _sequence_state(db) -> tuple:
    """Read last_value and is_called from each sequence. This does not call nextval."""
    direct = []
    for name in _public_relations(db, "S"):
        quoted = _quote_ident(name)
        row = db.execute(text(f"SELECT last_value, is_called FROM public.{quoted}")).one()
        direct.append((name, row.last_value, bool(row.is_called)))
    return tuple(direct)


def _table_counts(db) -> tuple:
    counts = []
    for name in _public_relations(db, "r"):
        quoted = _quote_ident(name)
        count = db.execute(text(f"SELECT count(*) FROM public.{quoted}")).scalar_one()
        counts.append((name, int(count)))
    return tuple(counts)


def _order(symbol: str) -> OrderCreate:
    return OrderCreate(
        symbol=symbol,
        side="buy",
        order_type="limit",
        quantity=Decimal("0.1"),
        limit_price=Decimal("100"),
    )


def _z(value: datetime) -> str:
    return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def _without_read_at(body: dict) -> dict:
    return {key: item for key, item in body.items() if key != "read_at"}


def _assert_eligible(body: dict, symbol: str, quote_at: str, buying_power: str) -> None:
    assert [key for key in _PREVIEW_KEYS if key not in body] == []
    assert body["status"] == "eligible"
    assert body["reason"] is None
    assert body["symbol"] == symbol
    assert body["side"] == "buy"
    assert body["order_type"] == "limit"
    assert body["quantity"] == "0.100000"
    assert body["limit_price"] == "100.000000"
    assert body["quote_observed_at"] == quote_at
    assert isinstance(body["read_at"], str) and body["read_at"].endswith("Z")
    assert body["read_at"] != quote_at
    assert body["step_up_required"] is False
    assert body["buying_power"] == buying_power
    assert body["sell_available"] == "0.000000"
    assert body["initial_reservation"] == "10.00"
    assert body["estimated_fill_quantity"] == "0.000000"
    assert body["estimated_fill_notional"] == "0.00"
    assert body["unfilled_quantity"] == "0.100000"


def _patch_snapshot_clock(monkeypatch, observations: list) -> None:
    real = order_preview.snapshot_clock

    def wrapped(db):
        isolation = db.execute(text("SHOW transaction_isolation")).scalar_one()
        read_only = db.execute(text("SHOW transaction_read_only")).scalar_one()
        observations.append((str(isolation).strip().lower(), str(read_only).strip().lower()))
        return real(db)

    monkeypatch.setattr(order_preview, "snapshot_clock", wrapped)


def _sql_text(statement) -> str:
    if isinstance(statement, bytes):
        return statement.decode("utf-8", "replace")
    if isinstance(statement, str):
        return statement
    return ""


def _engine_and_sessions():
    url = _disposable_url()
    _upgrade(url)
    engine = create_engine(url, poolclass=NullPool, future=True)
    sessions = sessionmaker(bind=engine, autoflush=False, future=True)
    return engine, sessions


def _seed(sessions):
    symbol = f"P3B{uuid4().hex[:10].upper()}"
    missing_symbol = f"P3M{uuid4().hex[:10].upper()}"
    email = f"preview-{uuid4().hex}@example.com"
    observed = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1)
    with sessions() as seed:
        if seed.get(TradingHaltState, 1) is None:
            seed.add(TradingHaltState(id=1, halted=False, reason="Initial trading state"))
        user = User(email=email, password_hash="fixture", cash_balance=Decimal("1000.00"))
        asset = Asset(symbol=symbol, asset_type="stock", name="Preview", is_active=True)
        seed.add_all([
            user,
            asset,
            MarketSymbol(symbol=symbol, company_name="Preview", exchange="NASDAQ", is_active=True),
            MarketSymbol(symbol=missing_symbol, company_name="Preview missing", exchange="NASDAQ", is_active=True),
        ])
        seed.flush()
        user_id = int(user.id)
        asset_id = int(asset.id)
        seed.add_all([
            MarketQuoteCache(
                symbol=symbol, price=Decimal("100"), source="yahoo", quote_at=observed, fetched_at=observed,
            ),
            MarketQuoteCache(
                symbol=missing_symbol, price=Decimal("100"), source="yahoo", quote_at=observed, fetched_at=observed,
            ),
        ])
        seed.commit()
    return user_id, asset_id, symbol, missing_symbol, observed


def test_preview_is_repeatable_read_only_without_side_effects(monkeypatch):
    engine, sessions = _engine_and_sessions()
    try:
        user_id, _asset_id, symbol, missing_symbol, observed = _seed(sessions)
        quote_at = _z(observed)
        with sessions() as look:
            before_sequences = _sequence_state(look)
            before_counts = _table_counts(look)
        observations = []
        _patch_snapshot_clock(monkeypatch, observations)
        writes = {"mutating": False, "count": 0}

        def guard(_conn, _cursor, statement, _parameters, _context, _executemany):
            if _MUTATION.search(_sql_text(statement)):
                writes["mutating"] = True
                writes["count"] += 1
                raise RuntimeError("preview attempted a mutating statement")

        event.listen(engine, "before_cursor_execute", guard)
        try:
            with sessions() as reader:
                # consistent_read rollbacks this session first, so nothing is staged here.
                first = order_preview.preview_order(reader, user_id, _order(symbol))
                second = order_preview.preview_order(reader, user_id, _order(symbol))
                missing = order_preview.preview_order(reader, user_id, _order(missing_symbol))
        finally:
            event.remove(engine, "before_cursor_execute", guard)

        assert writes == {"mutating": False, "count": 0}
        assert observations
        assert observations == [("repeatable read", "on")] * len(observations)
        _assert_eligible(first, symbol, quote_at, "1000.00")
        _assert_eligible(second, symbol, quote_at, "1000.00")
        assert _without_read_at(first) == _without_read_at(second)
        _assert_eligible(missing, missing_symbol, quote_at, "1000.00")
        with sessions() as look:
            assert _sequence_state(look) == before_sequences
            assert _table_counts(look) == before_counts
            missing_assets = look.execute(
                select(func.count()).select_from(Asset).where(Asset.symbol == missing_symbol)
            ).scalar_one()
        assert missing_assets == 0
    finally:
        engine.dispose()


def test_preview_hides_a_commit_that_lands_during_the_read():
    engine, sessions = _engine_and_sessions()
    try:
        user_id, asset_id, symbol, _missing_symbol, _observed = _seed(sessions)
        fired = False

        def on_quote(_conn, _cursor, statement, _parameters, _context, _executemany):
            nonlocal fired
            sql = _sql_text(statement).lower()
            if fired or "market_quote_cache" not in sql or not re.search(r"\bselect\b", sql):
                return
            fired = True
            with sessions() as writer:
                writer.execute(text("SET lock_timeout = '2s'"))
                account = writer.get(User, user_id)
                account.cash_balance = Decimal("500.00")
                writer.add(Order(
                    user_id=user_id,
                    asset_id=asset_id,
                    side="buy",
                    order_type="limit",
                    quantity=Decimal("1"),
                    remaining_quantity=Decimal("1"),
                    limit_price=Decimal("100"),
                    status="open",
                ))
                writer.commit()

        event.listen(engine, "after_cursor_execute", on_quote)
        try:
            with sessions() as reader:
                during = order_preview.preview_order(reader, user_id, _order(symbol))
        finally:
            event.remove(engine, "after_cursor_execute", on_quote)
        assert fired is True
        assert during["buying_power"] == "1000.00"
        assert during["status"] == "eligible"
        with sessions() as later:
            follow = order_preview.preview_order(later, user_id, _order(symbol))
        assert follow["buying_power"] == "400.00"
        assert follow["status"] == "eligible"
    finally:
        engine.dispose()
